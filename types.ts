export interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant' | 'character' | 'system';
    message_data?: any;
    message_index?: number;
    raw_text?: string;
    raw_text_json?: any;
}

export interface SessionData {
    id: string;
    character_id: string;
    user_character_id: string;
    relation_prompt?: string;
    context_length?: number;
    recent_summary?: string;
    character: {
        id: string;
        name: string;
        prompt?: {
            starting_chat?: string;
            gender?: string;
            age?: string;
            persona?: string;
            personality?: string;
            background?: string;
        };
    };
    user_character?: {
        name?: string;
        gender?: string;
        age?: string;
        persona?: string;
    };
    model: {
        id: string;
        api_name: string;
        provider: string;
        api_key_name: string;
    };
}

export interface RequestBody {
    sessionId: string;
    messageText: string;
    action?: 'chat' | 'continue' | 'resend';
    fromMessageId?: string;
    fromMessageIndex?: number;
    user_heartbeat?: number;
}
