export const convertLegacyToTagsFormat = (legacyText: string): string => {
    if (!legacyText) return '';
    const processInline = (text: string) => text.replace(/\*([^*]+)\*/g, '<h>$1</h>');
    let taggedText = '';
    let lastIndex = 0;
    const regex = /('''([\s\S]*?)''')|(\"([^\"]*)\")|(\(([^)]*)\))/g;
    let match;

    while ((match = regex.exec(legacyText)) !== null) {
        const preMatchText = legacyText.substring(lastIndex, match.index);
        if (preMatchText.trim()) taggedText += `<a>${processInline(preMatchText)}</a>`;

        if (match[1]) taggedText += `<b>${processInline(match[2])}</b>`;
        else if (match[3]) taggedText += `<q>${processInline(match[4])}</q>`;
        else if (match[5]) taggedText += `<internal>${processInline(match[6])}</internal>`;

        lastIndex = regex.lastIndex;
    }
    const postMatchText = legacyText.substring(lastIndex);
    if (postMatchText.trim()) taggedText += `<a>${processInline(postMatchText)}</a>`;

    if (!taggedText && legacyText) {
        if (legacyText.includes('|') || legacyText.match(/[\u{1F300}-\u{1F9FF}]/u)) {
            return `<b>${processInline(legacyText)}</b>`;
        }
        return `<a>${processInline(legacyText)}</a>`;
    }

    return taggedText.trim();
};

export const addLine = (prompt: string, label: string, value: any): string => {
    if (value === null || typeof value === 'undefined') return prompt;
    const stringValue = String(value);
    if (stringValue.trim() !== "") return prompt + `${label}: ${value}\n`;
    return prompt;
};

export const cleanTagsAndRemoveDisallowed = (text: string): string => {
    if (!text) return '';
    const allowedTags = new Set(['q', 'a', 'h', 'internal', 'b']);
    return text.replace(/<(\/?)([a-zA-Z0-9_]+)([^>]*?)>/gi, (match, slash, tagName, attrs) => {
        const lower = tagName.toLowerCase();
        if (allowedTags.has(lower)) {
            return `<${slash}${lower}>`;
        }
        return '';
    });
};

export const repairTags = (text: string): string => {
    if (!text) return '';
    let cleaned = text.replace(/^<reply>/i, '').replace(/<\/reply>$/i, '');
    return cleaned;
};

export const deepMerge = (target: any, source: any): any => {
    if (typeof target !== 'object' || target === null) return source;
    if (typeof source !== 'object' || source === null) return target;

    const output = { ...target };
    Object.keys(source).forEach(key => {
        const sourceValue = source[key];
        const targetValue = output[key];

        if (sourceValue === null || sourceValue === undefined) return;

        if (Array.isArray(sourceValue)) {
            output[key] = sourceValue;
        } else if (typeof sourceValue === 'object' && typeof targetValue === 'object' && targetValue !== null) {
            output[key] = deepMerge(targetValue, sourceValue);
        } else {
            output[key] = sourceValue;
        }
    });
    return output;
};
