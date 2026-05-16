import { MemoryItem } from '../types';
import { getCached, setCached, removeCached } from './cryptoService';

const STORAGE_KEY = 'echo_long_term_memory';

export type MemorySensitivity = 'cloud_ok' | 'local_only';

export interface MemoryItemExt extends MemoryItem {
    sensitivity?: MemorySensitivity;
}

export const getMemories = (): MemoryItemExt[] => {
    const items = getCached<MemoryItemExt[]>(STORAGE_KEY, []);
    return items.map(m => ({ sensitivity: 'cloud_ok' as MemorySensitivity, ...m }));
};

export const saveMemory = (
    key: string,
    value: string,
    sensitivity: MemorySensitivity = 'cloud_ok',
): MemoryItemExt => {
    const memories = getMemories();
    const existingIndex = memories.findIndex(m => m.key.toLowerCase() === key.toLowerCase());
    const newItem: MemoryItemExt = {
        id: crypto.randomUUID(),
        key,
        value,
        timestamp: Date.now(),
        sensitivity,
    };

    if (existingIndex >= 0) {
        // preserve existing sensitivity unless explicitly overridden
        newItem.sensitivity = sensitivity ?? memories[existingIndex].sensitivity ?? 'cloud_ok';
        memories[existingIndex] = newItem;
    } else {
        memories.push(newItem);
    }

    setCached(STORAGE_KEY, memories);
    return newItem;
};

export const updateMemorySensitivity = (id: string, sensitivity: MemorySensitivity): void => {
    const memories = getMemories();
    const idx = memories.findIndex(m => m.id === id);
    if (idx < 0) return;
    memories[idx] = { ...memories[idx], sensitivity };
    setCached(STORAGE_KEY, memories);
};

export const deleteMemory = (id: string): void => {
    const memories = getMemories();
    const filtered = memories.filter(m => m.id !== id);
    setCached(STORAGE_KEY, filtered);
};

export const clearMemories = (): void => {
    removeCached(STORAGE_KEY);
};

/**
 * Build a memory context string. By default all memories are included
 * (legacy behavior used by the live audio session, which runs against
 * Gemini Live — i.e. cloud). For more granular filtering use
 * `modelContextBuilder.buildSystemContext()` instead.
 */
export const generateContextString = (destination: 'cloud' | 'local' = 'cloud'): string => {
    const memories = getMemories();
    const filtered = destination === 'cloud'
        ? memories.filter(m => (m.sensitivity || 'cloud_ok') !== 'local_only')
        : memories;
    if (filtered.length === 0) return '';

    return `
[LONG TERM MEMORY / LOCAL CONTEXT]
The following list is your memory of this user. Use it to verify facts before asking questions.
${filtered.map(m => `- ${m.key}: ${m.value}`).join('\n')}
`;
};
