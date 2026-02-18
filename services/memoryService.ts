import { MemoryItem } from '../types';

const STORAGE_KEY = 'echo_long_term_memory';

export const getMemories = (): MemoryItem[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Failed to load memories", e);
    return [];
  }
};

export const saveMemory = (key: string, value: string): MemoryItem => {
  const memories = getMemories();
  
  // Update if key exists, otherwise add new
  const existingIndex = memories.findIndex(m => m.key.toLowerCase() === key.toLowerCase());
  const newItem: MemoryItem = {
    id: crypto.randomUUID(),
    key,
    value,
    timestamp: Date.now()
  };

  if (existingIndex >= 0) {
    memories[existingIndex] = newItem;
  } else {
    memories.push(newItem);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
  return newItem;
};

export const deleteMemory = (id: string): void => {
  const memories = getMemories();
  const filtered = memories.filter(m => m.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

export const clearMemories = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

export const generateContextString = (): string => {
  const memories = getMemories();
  if (memories.length === 0) return '';

  return `
[LONG TERM MEMORY / LOCAL CONTEXT]
The following list is your memory of this user. Use it to verify facts before asking questions.
${memories.map(m => `- ${m.key}: ${m.value}`).join('\n')}
`;
};
