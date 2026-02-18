import { ChatMessage } from '../types';

const STORAGE_KEY = 'echo_chat_history';

export const getHistory = (): ChatMessage[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error("Failed to load chat history", e);
    return [];
  }
};

export const saveMessage = (message: ChatMessage): void => {
  const history = getHistory();
  // Check if we are updating an existing non-final message (streaming)
  const existingIndex = history.findIndex(m => m.id === message.id);
  
  if (existingIndex >= 0) {
    history[existingIndex] = message;
  } else {
    history.push(message);
  }

  // Keep history manageable (last 100 messages)
  const trimmedHistory = history.slice(-100);
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedHistory));
};

export const clearHistory = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};
