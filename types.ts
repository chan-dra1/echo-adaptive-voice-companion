export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  timestamp: number;
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export interface AudioVolumeState {
  inputVolume: number;
  outputVolume: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isFinal: boolean;
}
