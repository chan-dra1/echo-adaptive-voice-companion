import { MemoryItem } from '../types';
import CryptoJS from 'crypto-js';

const STORAGE_KEY = 'echo_long_term_memory';
const ENCRYPTION_KEY = 'echo_secure_storage_v1';

function encrypt(data: any): string {
  return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
}

function decrypt<T>(ciphertext: string | null, fallback: T): T {
  if (!ciphertext) return fallback;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
  } catch (e) {
    // Fallback for unencrypted legacy data
    try {
      return JSON.parse(ciphertext);
    } catch {
      return fallback;
    }
  }
}

export const getMemories = (): MemoryItem[] => {
  return decrypt<MemoryItem[]>(localStorage.getItem(STORAGE_KEY), []);
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

  localStorage.setItem(STORAGE_KEY, encrypt(memories));
  return newItem;
};

export const deleteMemory = (id: string): void => {
  const memories = getMemories();
  const filtered = memories.filter(m => m.id !== id);
  localStorage.setItem(STORAGE_KEY, encrypt(filtered));
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
