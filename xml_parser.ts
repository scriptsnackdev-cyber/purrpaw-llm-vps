// ---------------------------------------------------------------------------
// XML PARSER — Two-Layer aware
//
// Layer 1 (Structured): thinking, analysis, pt, story_datetime, heartbeat,
//                        suggestions, scene_detail, new_memories — parsed strictly
// Layer 2 (Freeform):   <reply> — extracted as raw string, NOT sanitized.
//                        The persona template (HTML, emoji, <details>, etc.) lives here.
// ---------------------------------------------------------------------------

export const parseNestedXML = (xmlString: string, keys: string[]) => {
    if (!xmlString) return null;
    const result: any = {};
    let hasData = false;
    keys.forEach(key => {
        const match = xmlString.match(new RegExp(`<${key}>([\\s\\S]*?)<\\/${key}>`, 'i'));
        if (match) {
            const val = match[1].trim();
            // Numeric detection: only if it looks like a plain number (not a delta)
            if (!val.startsWith('+') && !val.startsWith('-') && !isNaN(Number(val)) && val !== '') {
                result[key] = Number(val);
            } else {
                result[key] = val;
            }
            hasData = true;
        }
    });
    return hasData ? result : null;
};

// Parse single-line Key-Value format (e.g. opn:85 csn:65 ext:75 ...)
export const parseKeyValPT = (ptStr: string) => {
    if (!ptStr) return null;
    const result: any = {};
    let hasData = false;
    const matches = [...ptStr.matchAll(/([a-zA-Z_]+)\s*:\s*([+-]?\d+)/g)];
    matches.forEach(m => {
        const key = m[1].toLowerCase();
        const val = m[2];
        if (!val.startsWith('+') && !val.startsWith('-') && !isNaN(Number(val)) && val !== '') {
            result[key] = Number(val);
        } else {
            result[key] = val;
        }
        hasData = true;
    });
    return hasData ? result : null;
};

// Extract a single tag's inner content. Supports optional attributes: <tag attr="x">
const extractTag = (tag: string, source: string): string | null => {
    const match = source.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? match[1].trim() : null;
};

// ---------------------------------------------------------------------------
// EXTRACT REPLY — freeform pass-through
// Tries <reply> first, then strips structural tags and returns remainder.
// Does NOT sanitize inner HTML — the persona template must survive intact.
// ---------------------------------------------------------------------------
const extractReply = (responseText: string): string => {
    // Primary: explicit <reply> tag
    const replyMatch = responseText.match(/<reply(?:[^>]*)>([\s\S]*?)<\/reply>/i);
    if (replyMatch) {
        return replyMatch[1].trim();
    }

    // Fallback: strip all known structural Layer-1 tags and return the rest
    const structuralTags = [
        'summary', 'dominant_emotion', 'pt',
        'scene_detail', 'new_memories', 'image_url',
        'heartbeat', 'response', 'long_memories', 'long_memory',
        'sum', 'emo', 'scene', 'img_url', 'hb', 'mems', 'mem'
    ];

    let cleaned = responseText;
    structuralTags.forEach(tag => {
        cleaned = cleaned.replace(new RegExp(`<${tag}(?:[^>]*)>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    });
    // Remove leftover opening/closing response wrapper
    cleaned = cleaned.replace(/<\/?response>/gi, '').trim();
    return cleaned || responseText.trim();
};

// ---------------------------------------------------------------------------
// MAIN PARSER
// ---------------------------------------------------------------------------
export const parseXMLOutput = (responseText: string) => {
    try {
        // ── Layer 2: Freeform reply (extract first, independently) ─────────────
        const replyContent = extractReply(responseText);

        // ── Layer 1: Structured data ──────────────────────────────────────────
        const internalThought = extractTag('thought', responseText) || extractTag('internal_thought', responseText) || "";

        const dominantEmotion = extractTag('emo', responseText) || extractTag('dominant_emotion', responseText);
        const summary = extractTag('sum', responseText) || extractTag('summary', responseText);
        const manualImageUrl = extractTag('img_url', responseText) || extractTag('image_url', responseText);

        // Personality Traits — <pt> shorthand (primary)
        const ptBlock = extractTag('pt', responseText);
        let personalityTraits: any = null;
        if (ptBlock) {
            const rawPt = parseKeyValPT(ptBlock) || parseNestedXML(ptBlock, ['opn', 'csn', 'ext', 'agr', 'neu', 'sex', 'pas', 'pos', 'cnf']);
            if (rawPt) {
                personalityTraits = {
                    openness: rawPt.opn !== undefined ? rawPt.opn : rawPt.openness,
                    conscientiousness: rawPt.csn !== undefined ? rawPt.csn : rawPt.conscientiousness,
                    extraversion: rawPt.ext !== undefined ? rawPt.ext : rawPt.extraversion,
                    agreeableness: rawPt.agr !== undefined ? rawPt.agr : rawPt.agreeableness,
                    neuroticism: rawPt.neu !== undefined ? rawPt.neu : rawPt.neuroticism,
                    sexual_arousal: rawPt.pas !== undefined ? rawPt.pas : (rawPt.sex !== undefined ? rawPt.sex : rawPt.sexual_arousal),
                    possessiveness: rawPt.pos !== undefined ? rawPt.pos : rawPt.possessiveness,
                    confidence: rawPt.cnf !== undefined ? rawPt.cnf : rawPt.confidence
                };
            }
        }
        // Legacy fallback
        if (!personalityTraits) {
            const personalityBlock = extractTag('personality_traits', responseText);
            personalityTraits = personalityBlock
                ? parseNestedXML(personalityBlock, ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism', 'sexual_arousal', 'possessiveness', 'confidence'])
                : null;
        }

        // Timestamps & vitals
        const heartbeat = extractTag('hb', responseText) || extractTag('heartbeat', responseText);

        // Scene detail (image gen prompt)
        const sceneDetail = extractTag('scene', responseText) || extractTag('scene_detail', responseText);

        // Mobile updates (JSON)
        let mobileUpdates = null;
        const mobileUpdatesStr = extractTag('mobile_updates', responseText);
        if (mobileUpdatesStr) {
            try { mobileUpdates = JSON.parse(mobileUpdatesStr); } catch { /* ignore */ }
        }

        // New memories (categorized)
        let newMemories: { category: string; content: string }[] = [];
        const newMemoriesBlock = extractTag('new_memories', responseText);
        if (newMemoriesBlock) {
            const memoryMatches = [...newMemoriesBlock.matchAll(/<memory category="([^"]+)">([\s\S]*?)<\/memory>/gi)];
            for (const m of memoryMatches) {
                if (m[2]?.trim()) {
                    newMemories.push({ category: m[1], content: m[2].trim() });
                }
            }
        }

        // Legacy entity memory fallback
        let legacyEntityMemory: string[] | null = null;
        const entityMemoryStr = extractTag('Entity_Memory', responseText);
        if (entityMemoryStr) {
            legacyEntityMemory = [entityMemoryStr.trim()];
        }

        // Long-term memories (<long_memory title="...">content</long_memory> or <mem title="...">content</mem>)
        const longMemories: { title: string; content: string }[] = [];
        const longMemoryMatches = [
            ...responseText.matchAll(/<long_memory\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/long_memory>/gi),
            ...responseText.matchAll(/<mem\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/mem>/gi)
        ];
        for (const m of longMemoryMatches) {
            if (m[1]?.trim()) {
                longMemories.push({ title: m[1].trim(), content: m[2]?.trim() || "" });
            }
        }

        // ── Construct rawJson ─────────────────────────────────────────────────
        const rawJson = {
            reply: replyContent,
            summary: summary,
            image_url: manualImageUrl || null,
            internal_thought: internalThought,
            heartbeat: heartbeat,
            dominant_emotion: dominantEmotion || "",
            personality_traits: personalityTraits || {
                openness: "", conscientiousness: "", extraversion: "",
                agreeableness: "", neuroticism: "", sexual_arousal: "",
                possessiveness: "", confidence: ""
            },
            scene_detail: sceneDetail,
            mobile_updates: mobileUpdates,
            long_memories: longMemories,
            usageMetadata: null
        };

        return {
            chat: replyContent,
            rawJson,
            heartbeat,
        };

    } catch (e) {
        console.error("[XML Parser] Error:", e);
        return {
            chat: responseText,
            rawJson: null,
            heartbeat: null
        };
    }
};
