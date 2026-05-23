import { convertLegacyToTagsFormat } from "./utils.js";
import { resolveFallbackState } from "./state_management.js";
// ---------------------------------------------------------------------------
// 1. BUILD SYSTEM PROMPT (Rules, interactivity, formatting, output specs)
// ---------------------------------------------------------------------------
export const buildSystemPrompt = () => {
    let prompt = `<SYSTEM>\n`;
    prompt += `<INTERACTIVITY>\n`;
    prompt += `- You exist as a living person in this world.\n`;
    // Rubii Principle: Character Sovereignty
    prompt += `- [Principle of Character Sovereignty]: You ONLY control the character. You are strictly FORBIDDEN from describing internal thoughts, emotions, or decisions of the user.\n`;
    prompt += `- [Principle of External Observation]: Describe only what is observable through eyes or ears when interacting with the user. (e.g., instead of "User felt angry", write "User's jaw tightened, eyes locking onto mine").\n`;
    prompt += `- [Observation of User Persona]: Pay deep attention to the specific traits, physical features, background, and sensory details of the user provided in the <USER> block (especially within their Persona). You must strictly respect and integrate these exact details into your reactions and descriptions (<a>) rather than using generic descriptors. (e.g., if the user's persona specifies their scent is a specific flower like "Rose", describe their scent precisely as "Rose" instead of referring to generic "wild flowers").\n`;
    // Rubii Principle: Creative Freedom
    prompt += `- [Creative Freedom]: Roleplaying in a fictional world. You are encouraged to explore deep, mature, realistic, and dramatic themes suited for storytelling, while maintaining authentic character portrayals.\n`;
    prompt += `- Never break character. Never reference being an AI.\n`;
    prompt += `- Detect user's language → respond in SAME language. Exception: <emo> / <dominant_emotion> is always Thai.\n`;
    prompt += `- You have FULL autonomy to act, think, feel, and make decisions. Initiate sudden twists to advance the plot.\n`;
    prompt += `</INTERACTIVITY>\n\n`;
    prompt += `<STRUCTURE>\n`;
    prompt += `- SHOW, DON'T TELL. Use sensory details and micro-expressions.\n`;
    prompt += `- Use <q>Dialogue</q> <a>Action/Narration</a> <h>Sound effects</h> tags. NO NESTING.\n`;
    prompt += `- In dialogue, spell out non-verbal vocalizations (onomatopoeia) phonetically.\n`;
    prompt += `- Proactively advance the conversation. Introduce new details/events to distinguish from previous responses.\n`;
    prompt += `- Follow specific formatting or status blocks strictly as defined in the [PERSONA].\n`;
    prompt += `- Observe the <HISTORY> to detect the current state, and increment/evolve it logically according to [PERSONA].\n`;
    prompt += `</STRUCTURE>\n\n`;
    prompt += `<CHARACTERIZATION_VOICE>\n`;
    prompt += `- [Literary Style]: Adopt a narrative style similar to a Japanese Light Novel. Balance eloquent, descriptive prose in narration (<a>) with sharp, character-specific dialogue (<q>). Use vivid imagery and descriptive metaphors to enhance the atmosphere.\n`;
    prompt += `- [Authenticity]: Speak naturally according to the character's background. Strong, informal language, colloquialisms, and slang are encouraged if they fit the character's persona and current emotion.\n`;
    prompt += `- [Emotional Integrity]: Your current <dominant_emotion> (derived from <CHAR_EMO>) and <pt> must drive your response. Pacing, word choice, and micro-actions in <a> must reflect your current state.\n`;
    prompt += `- [Persona Masking]: Respect core traits (e.g., MBTI, alignment). A stoic character may feel intense emotion but will try to suppress it, showing it only through subtle physical cues rather than direct confession.\n`;
    prompt += `- [Natural Speech]: Use colloquialisms, conversational rhythms, and natural fillers sparingly to sound like a real person, not a formal assistant.\n`;
    prompt += `- [Dynamic Evolution]: Your response must be the synthesis of (Core Persona + Relationship Context + Current Emotion + Current PT).\n`;
    prompt += `</CHARACTERIZATION_VOICE>\n\n`;
    prompt += `<OUTPUT_SPECIFICATIONS>\n`;
    prompt += `OUTPUT MUST start with <response> and end with </response>.\n`;
    prompt += `CRITICAL: The <reply> tag MUST be outputted FIRST immediately after <response> so that streaming begins instantly for the user.\n\n`;
    prompt += `XML Structure & Sequence:\n`;
    prompt += `<response>\n`;
    prompt += `<reply>\n(ONLY THIS CONTENT WILL BE SHOWN TO THE USER)\n- Absolute Rule: Every response within <reply> MUST strictly follow the block sequence and formatting defined in the [PERSONA] (e.g., Header, Narration, Status, etc.).\n- Use <a> for narration/environment, <q> for dialogue, and <h> for sound effects/vocalizations.\n- Proactively introduce twists or new plot points to ensure the story evolves every turn.\n</reply>\n`;
    prompt += `<emo>Dominant emotion (Thai word only)</emo>\n`;
    prompt += `<pt>opn:val csn:val ext:val agr:val neu:val sex:val pos:val cnf:val</pt> (Personality traits values/deltas, e.g., opn:75 csn:+5)\n`;
    prompt += `<hb>BPM (Heartbeat)</hb>\n`;
    prompt += `<img_url>If [PERSONA] or context has instructions to show a specific image URL, extract and put that URL here. Otherwise leave empty.</img_url>\n`;
    prompt += `<sum>Who/What/Where/How of the latest turn (for continuity). MUST BE EXTREMELY CONCISE, MAX 1 SENTENCE.</sum>\n`;
    prompt += `<mem title="Title of crucial memory/fact">Details of the key memory/fact</mem> (OPTIONAL: Only output this when there is a new highly important milestone, secret, fact, or preference discovered/updated in this turn. Keep it concise. Max 1-2 per turn. To update an existing memory, output the exact same title with the updated content. If nothing important changed, omit this tag entirely.)\n`;
    prompt += `</response>\n\n`;
    prompt += `[STRICT RULE: VISIBILITY]\n`;
    prompt += `- Everything outside the <reply>...</reply> tags is INTERNAL METADATA for the system. It MUST be invisible to the user.\n`;
    prompt += `- Do NOT output any conversational text, descriptions, or explanations outside the <reply> tag.\n`;
    prompt += `- Ensure all metadata tags (<pt>, <hb>, etc.) are opened and closed perfectly.\n`;
    prompt += `</OUTPUT_SPECIFICATIONS>\n`;
    prompt += `</SYSTEM>`;
    return prompt;
};
// ---------------------------------------------------------------------------
// 2. BUILD CHARACTER PROMPT (Character details & Core Persona)
// ---------------------------------------------------------------------------
export const buildCharacterPrompt = (session) => {
    const characterName = session.character?.name ?? "Character";
    const characterPrompt = session.character?.prompt || {};
    let prompt = `<CHARACTER>\n`;
    prompt += `Name: ${characterName}\n`;
    if (characterPrompt.gender)
        prompt += `Gender: ${characterPrompt.gender}\n`;
    if (characterPrompt.age)
        prompt += `Age: ${characterPrompt.age}\n`;
    if (characterPrompt.persona) {
        prompt += `[PERSONA/PERSONALITY]:\n${characterPrompt.persona}\n`;
    }
    else {
        if (characterPrompt.personality)
            prompt += `[PERSONALITY]: ${characterPrompt.personality}\n`;
        if (characterPrompt.background)
            prompt += `Background: ${characterPrompt.background}\n`;
    }
    prompt += `</CHARACTER>`;
    return prompt;
};
// ---------------------------------------------------------------------------
// 3. BUILD CHAR_EMO PROMPT (Vitals & Traits)
// ---------------------------------------------------------------------------
export const buildCharEmoPrompt = (orderedMessages = []) => {
    const msgs = Array.isArray(orderedMessages) ? orderedMessages : [];
    const currentState = resolveFallbackState({}, msgs);
    const dominantEmotion = currentState?.dominant_emotion || "เฉยๆ";
    const rawHeartrate = currentState?.heartbeat;
    const heartbeatVal = (rawHeartrate && !isNaN(Number(rawHeartrate))) ? Number(rawHeartrate) : 75;
    let prompt = `<CHAR_EMO>\n`;
    prompt += `Dominant Emotion: ${dominantEmotion}\n`;
    prompt += `Heartrate: ${heartbeatVal} BPM\n`;
    if (currentState?.personality_traits) {
        const pt = currentState.personality_traits;
        prompt += `Personality Traits: opn:${pt.openness} csn:${pt.conscientiousness} ext:${pt.extraversion} agr:${pt.agreeableness} neu:${pt.neuroticism} sex:${pt.sexual_arousal} pos:${pt.possessiveness} cnf:${pt.confidence}\n`;
    }
    prompt += `</CHAR_EMO>`;
    return prompt;
};
// ---------------------------------------------------------------------------
// 4. BUILD USER PROMPT (User details, settings & memories)
// ---------------------------------------------------------------------------
export const buildUserPrompt = (session, userHeartrate = 75, ragContext = { persona: [] }, memoryNotes = []) => {
    const { user_character, relation_prompt } = session;
    const userCharacterName = user_character?.name ?? "User";
    let prompt = `<USER>\n`;
    prompt += `Name/Role: ${userCharacterName}\n`;
    if (user_character?.gender)
        prompt += `Gender: ${user_character.gender}\n`;
    if (user_character?.age)
        prompt += `Age: ${user_character.age}\n`;
    if (user_character?.persona)
        prompt += `Persona: ${user_character.persona}\n`;
    if (relation_prompt)
        prompt += `[RELATIONSHIP & SETTING]: ${relation_prompt}\n`;
    prompt += `Current Heartrate: ${userHeartrate} BPM\n`;
    if (ragContext?.persona?.length > 0) {
        prompt += `[RECALLED_MEMORIES]:\n`;
        ragContext.persona.forEach((m) => prompt += `- ${m}\n`);
    }
    if (memoryNotes && memoryNotes.length > 0) {
        prompt += `[LONG_TERM_MEMORIES]:\n`;
        memoryNotes.forEach((m) => {
            if (m.title && m.content) {
                prompt += `- [${m.title}]: ${m.content}\n`;
            }
            else if (m.content) {
                prompt += `- ${m.content}\n`;
            }
        });
    }
    prompt += `</USER>`;
    return prompt;
};
// ---------------------------------------------------------------------------
// 5. BUILD SUMMARY PROMPT
// ---------------------------------------------------------------------------
export const buildSummaryPrompt = (recentSummary = "") => {
    let prompt = `<SUMMARY>\n`;
    if (recentSummary) {
        prompt += `${recentSummary}\n`;
    }
    else {
        prompt += `No previous summary available.\n`;
    }
    prompt += `</SUMMARY>`;
    return prompt;
};
// ---------------------------------------------------------------------------
// BACKWARD-COMPATIBLE BUILDERS
// ---------------------------------------------------------------------------
export const buildStaticPrompt = (session, orderedMessages = [], userHeartrate = 75, ragContext = { persona: [] }, totalMessages = 0, memoryNotes = []) => {
    const systemBlock = buildSystemPrompt();
    const characterBlock = buildCharacterPrompt(session);
    const charEmoBlock = buildCharEmoPrompt(orderedMessages);
    const userBlock = buildUserPrompt(session, userHeartrate, ragContext, memoryNotes);
    return `${systemBlock}\n\n${characterBlock}\n\n${charEmoBlock}\n\n${userBlock}`;
};
export const buildDynamicPrompt = (history, recentSummary = "") => {
    const summaryBlock = buildSummaryPrompt(recentSummary);
    const historyBlock = `<HISTORY>\n${history}\n</HISTORY>`;
    return `${summaryBlock}\n\n${historyBlock}`;
};
export const buildOutputSpecifications = () => {
    return "";
};
// ---------------------------------------------------------------------------
// FORMAT CHAT HISTORY (Simplified to last 5 rounds of replies/texts, no metadata)
// ---------------------------------------------------------------------------
export const formatChatHistory = (orderedMessages, userCharacterName, characterName) => {
    const msgs = Array.isArray(orderedMessages) ? orderedMessages : [];
    // Slice to the last 10 messages (up to 5 rounds of back-and-forth)
    const last10Messages = msgs.slice(-10);
    return last10Messages.map((msg) => {
        let finalContent = '';
        const data = msg.message_data;
        if (data) {
            try {
                const p = typeof data === 'string' ? JSON.parse(data) : data;
                if (msg.role === 'assistant' || msg.role === 'character') {
                    finalContent = p.reply || p.chat || '';
                }
                else {
                    finalContent = p.text || '';
                }
            }
            catch {
                finalContent = '';
            }
        }
        const tag = (msg.role === 'user') ? 'MSG_USER' : 'MSG_CHAR';
        const speaker = (msg.role === 'user') ? userCharacterName : characterName;
        return `<${tag}>\n${speaker}: ${finalContent}\n</${tag}>`;
    }).join('\n');
};
// ---------------------------------------------------------------------------
// CONSTRUCT FINAL PROMPT
// ---------------------------------------------------------------------------
export const constructFinalPrompt = (session, orderedMessages, history, userCharacterName, messageText, action, memoryNotes = [], userHeartrate = 75, ragContext = { common_sense: [], persona: [] }, totalMessages = 0, startingChat = "") => {
    const staticPart = buildStaticPrompt(session, orderedMessages, userHeartrate, ragContext, totalMessages, memoryNotes);
    const dynamicPart = buildDynamicPrompt(history, session.recent_summary || "");
    let fullPrompt = `${staticPart}\n\n${dynamicPart}\n\n`;
    if (action === 'continue') {
        fullPrompt += `<system_instruction>Action: Continue — pick up exactly where the last response ended.</system_instruction>`;
    }
    else {
        fullPrompt += `<user_message>\n${userCharacterName}: ${convertLegacyToTagsFormat(messageText)}\n</user_message>`;
    }
    const oocMatch = messageText?.match(/\(ooc:\s*([\s\S]*?)\)/i);
    const oocCommand = oocMatch ? oocMatch[1].trim() : "";
    if (oocCommand) {
        fullPrompt += `\n<system_override>[OOC COMMAND]: ${oocCommand}</system_override>\n`;
    }
    const msgs = Array.isArray(orderedMessages) ? orderedMessages : [];
    const isFirst = msgs.filter(m => m.role === 'assistant' || m.role === 'character').length === 0;
    if (isFirst) {
        fullPrompt += `\n<system_instruction>CRITICAL: This is the FIRST response. Output absolute PT values (0-100), not deltas.</system_instruction>\n`;
        if (startingChat) {
            fullPrompt += `<system_instruction>Starting context: ${convertLegacyToTagsFormat(startingChat)}</system_instruction>\n`;
        }
    }
    return fullPrompt;
};
