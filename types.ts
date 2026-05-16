export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  timestamp: number;
  /** Where this memory is allowed to leave the device. Defaults to 'cloud_ok'. */
  sensitivity?: 'cloud_ok' | 'local_only';
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
