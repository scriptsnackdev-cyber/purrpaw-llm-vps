import { ChatMessage } from "./types.js";

// Applies deltas and clamps values.
export const applyStateLogic = (targetBlock: any, sourceBlock: any, limits: { min: number, max: number }) => {
    if (!sourceBlock) return targetBlock;
    const result = { ...(targetBlock || {}) };

    Object.keys(sourceBlock).forEach(key => {
        const sourceVal = sourceBlock[key];
        // Handle undefined target by defaulting to mid-point
        let currentVal = result[key] !== undefined ? Number(result[key]) : (limits.min + limits.max) / 2;
        if (isNaN(currentVal)) currentVal = (limits.min + limits.max) / 2;

        let delta = 0;
        let isDelta = false;

        // Check format
        if (typeof sourceVal === 'string') {
            if (sourceVal.startsWith('+') || sourceVal.startsWith('-')) {
                delta = Number(sourceVal);
                isDelta = true;
            } else if (!isNaN(Number(sourceVal))) {
                result[key] = Number(sourceVal);
                return;
            }
        } else if (typeof sourceVal === 'number') {
            // If negative and range is 0-100, assume delta (since absolute can't be negative)
            if (limits.min === 0 && sourceVal < 0) {
                delta = sourceVal;
                isDelta = true;
            } else {
                // Otherwise treat as absolute
                result[key] = sourceVal;
                return;
            }
        }

        if (isDelta && !isNaN(delta)) {
            const newVal = Math.min(Math.max(currentVal + delta, limits.min), limits.max);
            result[key] = newVal;
        } else {
            if (!isNaN(Number(sourceVal))) {
                result[key] = Math.min(Math.max(Number(sourceVal), limits.min), limits.max);
            } else {
                result[key] = sourceVal;
            }
        }
    });

    return result;
};

export const resolveFallbackState = (currentJson: any, history: ChatMessage[]) => {
    // 1. Scan backwards for latest complete state
    const keysToMerge = ['personality_traits', 'summary', 'image_url', 'scene_detail'];
    let baseState: any = {};
    for (const msg of [...history].reverse()) {
        if ((msg.role !== 'assistant' && msg.role !== 'character') || !msg.raw_text_json) continue;
        try {
            const prevData = typeof msg.raw_text_json === 'string' ? JSON.parse(msg.raw_text_json) : msg.raw_text_json;
            keysToMerge.forEach(key => {
                if ((baseState[key] === undefined || baseState[key] === null) && prevData[key]) {
                    baseState[key] = prevData[key];
                }
            });
        } catch { }
    }

    // 2. Prepare Base for Personality Traits (Ensure all keys exist)
    const REQUIRED_TRAITS = [
        'openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism',
        'sexual_arousal', 'possessiveness', 'confidence'
    ];

    // Initialize base traits with defaults (50) if history is missing them
    if (!baseState.personality_traits) baseState.personality_traits = {};
    REQUIRED_TRAITS.forEach(t => {
        if (baseState.personality_traits[t] === undefined) {
            baseState.personality_traits[t] = 50; // Default midpoint
        }
    });

    // 3. Now merge/apply deltas
    let resolved = { ...baseState };

    // Merge new JSON if exists
    if (currentJson) {
        resolved.personality_traits = applyStateLogic(baseState.personality_traits, currentJson.personality_traits, { min: 0, max: 100 });

        // Merge other non-logic fields
        ['scene_detail', 'mobile_updates', 'reply', 'internal_thought', 'dominant_emotion', 'heartbeat', 'summary', 'image_url'].forEach(k => {
            if (currentJson[k] !== undefined) resolved[k] = currentJson[k];
        });
    }

    // 4. Final Safety: Ensure resolved has the keys (in case applyStateLogic somehow lost them, though unlikely)
    if (!resolved.personality_traits) resolved.personality_traits = {};
    REQUIRED_TRAITS.forEach(t => {
        if (resolved.personality_traits[t] === undefined) resolved.personality_traits[t] = 50;
    });

    // 5. Explicitly structure the return object
    return {
        reply: resolved.reply || "",
        summary: currentJson?.summary || resolved.summary || "",
        image_url: currentJson?.image_url || resolved.image_url || null,
        internal_thought: resolved.internal_thought || "",
        heartbeat: resolved.heartbeat || "",
        dominant_emotion: currentJson?.dominant_emotion || resolved.dominant_emotion || "เฉยๆ",
        personality_traits: resolved.personality_traits,
        scene_detail: resolved.scene_detail || null,
        mobile_updates: resolved.mobile_updates || {},
        long_memories: currentJson?.long_memories || [],
        usageMetadata: null
    };
};
