import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import { VertexAI } from '@google-cloud/vertexai';
import { constructFinalPrompt, formatChatHistory } from './prompt_builder.js';
import { parseXMLOutput } from './xml_parser.js';
import { resolveFallbackState } from './state_management.js';
import { ChatMessage, SessionData } from './types.js';

// Fix missing native WebSocket in Node.js < 22 for Supabase Client
globalThis.WebSocket = ws as any;

dotenv.config();

const app = express();

// Custom CORS and Private Network Access (PNA) Middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
    } else {
        res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Headers", "Authorization, authorization, Content-Type, content-type, Accept, accept, Origin, origin, X-Requested-With, x-requested-with");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Private-Network", "true");
    res.header("Access-Control-Max-Age", "86400"); // Cache preflight for 24h

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCP_PROJECT = process.env.GCP_PROJECT;
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("CRITICAL ERROR: Supabase credentials are not fully configured in the environment variables!");
    process.exit(1);
}

// Initialize Supabase Clients
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Initialize Vertex AI with dynamic global endpoint support
const vertexAiOptions: any = {
    project: GCP_PROJECT || '',
    location: GCP_LOCATION || 'us-central1'
};

if (GCP_LOCATION === 'global') {
    vertexAiOptions.apiEndpoint = 'aiplatform.googleapis.com';
}

const vertexAI = new VertexAI(vertexAiOptions);

const sharedSafetySettings = [
    {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE'
    },
    {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE'
    },
    {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_NONE'
    },
    {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE'
    }
];

const generativeModel = vertexAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    safetySettings: sharedSafetySettings as any
});

// Extend Request interface to hold authenticated user
interface AuthenticatedRequest extends Request {
    user?: any;
}

// Middleware: Authenticate requests using Supabase JWT
const authenticateJWT = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.warn(`[Auth] Rejecting request: Missing or invalid Authorization header. Header value: "${authHeader}"`);
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.warn(`[Auth] Rejecting request: Invalid JWT token. Error details: "${error?.message || 'No user session found'}"`);
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

        req.user = user;
        next();
    } catch (err: any) {
        console.error("[Auth] Middleware Error:", err.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Expose root status check
app.get('/status', (req: Request, res: Response) => {
    res.json({ status: 'running', service: 'purrpaw-llm-vps', model: 'gemini-3.5-flash' });
});

// Primary Chat Endpoint
app.post('/chat', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
    const startTime = Date.now();
    const { sessionId, messageText, action = 'chat', fromMessageId, fromMessageIndex, user_heartbeat = 75 } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'Bad Request: sessionId is required' });
    }

    console.log(`[API] userId: ${req.user.id} | action: ${action} | session: ${sessionId}`);

    try {
        // 1. Fetch Session details securely on backend
        const { data: sessionData, error: sessionError } = await supabaseAdmin
            .from("chat_sessions")
            .select(`
                *,
                character:characters(*), 
                user_character:user_characters(*), 
                model:ai_models(*)
            `)
            .eq("id", sessionId)
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (sessionError || !sessionData) {
            console.error(`[API] Error fetching session ${sessionId}:`, sessionError);
            return res.status(404).json({ error: `Session ${sessionId} not found or access denied.` });
        }

        // 2. Fetch Chat History securely on backend
        let query = supabaseAdmin
            .from("chat_messages")
            .select("id, role, message_data, message_index")
            .eq("session_id", sessionId)
            .neq("is_active_response", false)
            .order("message_index", { ascending: false });

        let promptIdToReturn: string | null = null;

        // Calculate next message index and order constraints
        const { data: maxMsg } = await supabaseAdmin
            .from("chat_messages")
            .select("message_index")
            .eq("session_id", sessionId)
            .order("message_index", { ascending: false })
            .limit(1)
            .single();
        let nextMessageIndex = (maxMsg?.message_index || 0) + 1;

        if (action === 'resend' && fromMessageIndex) {
            query = query.lt('message_index', fromMessageIndex);
            promptIdToReturn = fromMessageId || null;
        } else if (action === 'chat' && fromMessageId) {
            promptIdToReturn = fromMessageId;
        } else if (action === 'continue') {
            // Securely insert a placeholder continue message internally
            const { data: insertedContinueMsg } = await supabaseAdmin.from("chat_messages").insert({
                session_id: sessionId,
                role: "user",
                message_data: { text: "<SYSTEM>CONTINUE</SYSTEM>" },
                is_active_response: true,
                message_index: nextMessageIndex++
            }).select().single();
            promptIdToReturn = insertedContinueMsg?.id || null;
        }

        const { data: recentMessages, error: historyError } = await query.limit(100);
        if (historyError) {
            console.error("[API] History fetch error:", historyError);
        }

        // Filter messages to avoid context overflow
        const totalCharLimit = 100000 + (sessionData.context_length || 0);
        let orderedMessages: ChatMessage[] = [];
        let accumulatedChars = 0;

        if (recentMessages) {
            for (const msg of recentMessages) {
                const data = msg.message_data;
                const p = typeof data === 'string' ? JSON.parse(data) : data;
                const text = p?.reply || p?.text || "";
                if (accumulatedChars + text.length > totalCharLimit) break;
                orderedMessages.push(msg as ChatMessage);
                accumulatedChars += text.length;
            }
        }
        orderedMessages.reverse();

        if (action === 'chat' && fromMessageId) {
            const idx = orderedMessages.findIndex(m => m.id === fromMessageId);
            if (idx !== -1) orderedMessages = orderedMessages.slice(0, idx);
        }

        // Consolidate memories securely on the backend
        const consolidatedMemories = new Map<string, string>();
        for (const msg of orderedMessages) {
            if (msg.role === 'assistant' || msg.role === 'character') {
                try {
                    const data = typeof msg.message_data === 'string' ? JSON.parse(msg.message_data) : msg.message_data;
                    if (data?.long_memories && Array.isArray(data.long_memories)) {
                        for (const mem of data.long_memories) {
                            if (mem.title && mem.content) {
                                consolidatedMemories.set(mem.title.trim(), mem.content.trim());
                            }
                        }
                    }
                } catch { }
            }
        }
        const memoryNotes = Array.from(consolidatedMemories.entries()).map(([title, content]) => ({ title, content }));

        // Identify history vs current message to avoid duplicates in logs
        let historyMessages = [...orderedMessages];
        const hasSlicedByFromId = (action === 'chat' || !action) && fromMessageId && orderedMessages.length > 0;
        if ((action === 'chat' || !action) && !hasSlicedByFromId && historyMessages.length > 0) {
            historyMessages = historyMessages.slice(0, -1);
        }

        // Fetch recent summary
        let recentSummary = "";
        for (let i = orderedMessages.length - 1; i >= 0; i--) {
            const m = orderedMessages[i];
            if (m.role === 'assistant' || m.role === 'character') {
                const data = m.message_data;
                const p = typeof data === 'string' ? JSON.parse(data) : data;
                if (p?.summary) {
                    recentSummary = p.summary;
                    break;
                }
            }
        }
        (sessionData as any).recent_summary = recentSummary;

        const historyStr = formatChatHistory(historyMessages, sessionData.user_character?.name || "User", sessionData.character?.name || "Character");
        const supabaseTime = Date.now();
        console.log(`[Timer] Phase 1 - Supabase data fetch & traits consolidation: ${((supabaseTime - startTime) / 1000).toFixed(3)}s`);

        // 3. Build prompt securely on backend
        let fullPrompt = constructFinalPrompt(
            sessionData as SessionData,
            orderedMessages,
            historyStr,
            sessionData.user_character?.name || "User",
            messageText || "",
            action,
            memoryNotes,
            user_heartbeat,
            { common_sense: [], persona: [] },
            orderedMessages.length,
            sessionData.character?.prompt?.starting_chat
        );

        // Sanitize names
        const safeUvcName = sessionData.user_character?.name || "User";
        const safeCharName = sessionData.character?.name || "Character";
        fullPrompt = fullPrompt.replace(/{{user}}/gi, safeUvcName).replace(/{{character}}/gi, safeCharName).replace(/{{char}}/gi, safeCharName);
        const promptTime = Date.now();
        console.log(`[Timer] Phase 2 - Prompt builder: ${((promptTime - supabaseTime) / 1000).toFixed(3)}s`);

        // 4. Initialize Vertex AI Streaming Connection
        console.log("[Vertex AI] Invoking gemini-3.5-flash...");
        const request: any = {
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            safetySettings: sharedSafetySettings
        };

        const startVertexCall = Date.now();
        const streamingResp = await generativeModel.generateContentStream(request);

        // Configure SSE Streaming Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullGeneratedText = "";
        let isFirstToken = true;
        let chunkCount = 0;

        // Stream parts word-by-word to client
        for await (const chunk of streamingResp.stream) {
            chunkCount++;
            if (chunkCount <= 5) {
                console.log(`[Vertex AI Chunk #${chunkCount}]:`, JSON.stringify(chunk));
            }

            const candidate = chunk.candidates?.[0];
            const finishReason = candidate?.finishReason;
            if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
                if (finishReason === 'SAFETY') {
                    console.warn(`[Vertex AI] Safety block triggered! Ratings:`, JSON.stringify(candidate.safetyRatings));
                    throw new Error("SAFETY_BLOCK: ขออภัยด้วยน้า คำตอบถูกบล็อกเนื่องจากนโยบายความปลอดภัย (Safety Filter)");
                } else {
                    console.warn(`[Vertex AI] Stream terminated with reason: ${finishReason}`);
                    throw new Error(`STREAM_BLOCKED: Stream terminated with reason: ${finishReason}`);
                }
            }

            const parts = candidate?.content?.parts || [];
            let text = "";
            for (const part of parts) {
                if (part.text) {
                    text += part.text;
                }
            }

            if (text) {
                if (isFirstToken) {
                    isFirstToken = false;
                    const firstTokenTime = Date.now();
                    console.log(`[Timer] Phase 3 - Time to First Token (TTFT): ${((firstTokenTime - startTime) / 1000).toFixed(3)}s (Vertex latency: ${((firstTokenTime - startVertexCall) / 1000).toFixed(3)}s)`);
                }
                fullGeneratedText += text;
                res.write(`data: ${JSON.stringify({ text, isStreaming: true, accumulated: null })}\n\n`);
            }
        }

        // Close stream
        res.write(`data: ${JSON.stringify({ text: "", isStreaming: false, isComplete: true })}\n\n`);

        const totalTime = Date.now();
        console.log(`[Timer] Phase 4 - Full response generated. Vertex stream duration: ${((totalTime - startVertexCall) / 1000).toFixed(3)}s. Total request duration: ${((totalTime - startTime) / 1000).toFixed(3)}s. Output Length: ${fullGeneratedText.length} chars.`);

        // 5. Parse output and commit to Supabase on backend
        const parsed = parseXMLOutput(fullGeneratedText);
        parsed.rawJson = resolveFallbackState(parsed.rawJson, orderedMessages);

        // Save transaction to DB
        const { data: insertedMsg, error: insertError } = await supabaseAdmin.from("chat_messages").insert({
            session_id: sessionData.id,
            role: "character",
            message_data: parsed.rawJson ? parsed.rawJson : null,
            message_index: nextMessageIndex,
            prompt_id: promptIdToReturn,
            debug: fullPrompt // Log prompt for transparency
        }).select().single();

        if (insertError) {
            console.error("[DB] Failed to insert AI response message:", insertError);
        }

        // Update session
        await supabaseAdmin.from("chat_sessions").update({
            last_text: parsed.chat.substring(0, 100),
            last_message_at: new Date().toISOString()
        }).eq("id", sessionData.id);

        // Send final metadata event so UI syncs seamlessly
        res.write(`event: meta\ndata: ${JSON.stringify({
            messageId: insertedMsg?.id || null,
            cost: 0,
            savedJsonString: parsed.rawJson ? JSON.stringify(parsed.rawJson) : null,
            savedReplyText: parsed.chat,
            heartbeat: parsed.heartbeat,
            sessionId: sessionData.id,
            text: parsed.chat
        })}\n\n`);

        res.end();

    } catch (err: any) {
        console.error("[API] Critical Failure:", err);
        // If SSE already started, send SSE error
        if (res.headersSent) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Run server
app.listen(PORT, () => {
    console.log(`[VPS Server] purrpaw-llm-vps is running on port ${PORT}`);
    console.log(`[VPS Server] Active Vertex AI model: gemini-3.5-flash`);
});
