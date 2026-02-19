import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { MemoryItem, ChatMessage } from '../types';
import { saveMemory, generateContextString } from './memoryService';
import { createPcmBlob, decodeAudioData, base64ToArrayBuffer } from './audioUtils';
import { MODEL_NAME, ECHO_SYSTEM_INSTRUCTION } from '../constants';
import { PROACTIVE_AI_TOOLS, proactiveAI } from './proactiveAIService';
import { agentSkillService } from './agentSkillService';
import githubSkill from '../skills/githubSkill';
import knowledgeSkill from '../skills/knowledgeSkill';
import ghostSkill from '../skills/ghostSkill';
import fileGenSkill from '../skills/fileGenSkill';
import { summaryService } from './summaryService';
import { personalizedLearning } from './personalizedLearningService';

interface LiveServiceCallbacks {
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: Error) => void;
  onVolumeChange: (input: number, output: number) => void;
  onMemoryUpdate: (item: MemoryItem) => void;
  onMessageUpdate: (message: ChatMessage) => void;
}

const memoryToolDeclaration: FunctionDeclaration = {
  name: 'updateMemory',
  parameters: {
    type: Type.OBJECT,
    description: 'Save a key-value pair to long-term memory about the user (e.g., preferences, goals, facts).',
    properties: {
      key: {
        type: Type.STRING,
        description: 'The category or topic of the memory (e.g., "coding_preference", "favorite_food", "current_goal").',
      },
      value: {
        type: Type.STRING,
        description: 'The detail to remember.',
      },
    },
    required: ['key', 'value'],
  },
};

const timeToolDeclaration: FunctionDeclaration = {
  name: "get_current_time",
  description: "Get the current system time.",
};

// Google Search grounding for real-world data (sports, stocks, weather, news)
const googleSearchTool = { googleSearch: {} };

export interface ConnectConfig {
  voiceName?: string;
  speechConfig?: {
    silenceThreshold?: number; // RMS threshold 0.0 to 1.0
    preRollMs?: number; // Ms of audio to keep before speech detection (latency buffer)
  }
  useLocalVoice?: boolean;
  systemInstruction?: string;
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private callbacks: LiveServiceCallbacks;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private sessionPromise: Promise<any> | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private volumeInterval: number | null = null;
  private isMuted: boolean = false;
  private useLocalVoice: boolean = false;

  // VAD & Buffering Logic
  private silenceThreshold = 0.005; // Lowered for better sensitivity
  private preRollBuffer: Float32Array[] = [];
  private maxPreRollFrames = 4; // Default ~500ms
  private isSpeechActive = false;
  private silenceFrameCount = 0;
  private maxSilenceFrames = 8; // Hangover: 8 * 128ms = ~1s

  // Transcript state
  private currentTurnId: string | null = null;
  private currentRole: 'user' | 'assistant' = 'user';
  private currentTranscript: string = '';

  // Screen Share state
  private screenStream: MediaStream | null = null;
  private screenShareInterval: number | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoElement: HTMLVideoElement | null = null;

  constructor(apiKey: string, callbacks: LiveServiceCallbacks) {
    this.ai = new GoogleGenAI({ apiKey });
    this.callbacks = callbacks;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public async connect(config?: ConnectConfig) {
    try {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      this.inputAnalyser = this.inputAudioContext.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      this.outputAnalyser = this.outputAudioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;

      // Create Gain Node for volume control
      this.outputGainNode = this.outputAudioContext.createGain();
      this.outputGainNode.gain.value = 1.0; // Default to full volume

      // Route: Analyser -> Gain -> Destination
      this.outputAnalyser.connect(this.outputGainNode);
      this.outputGainNode.connect(this.outputAudioContext.destination);

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Apply Config
      if (config?.speechConfig) {
        if (config.speechConfig.silenceThreshold) {
          this.silenceThreshold = config.speechConfig.silenceThreshold;
        }
        if (config.speechConfig.preRollMs) {
          // 2048 samples @ 16000Hz is approx 128ms per frame
          this.maxPreRollFrames = Math.ceil(config.speechConfig.preRollMs / 128);
        }
      }

      this.useLocalVoice = !!config?.useLocalVoice;

      // Register Agent Skills
      agentSkillService.registerSkill(githubSkill);
      agentSkillService.registerSkill(knowledgeSkill);
      agentSkillService.registerSkill(ghostSkill);
      agentSkillService.registerSkill(fileGenSkill);

      // Initialize tools
      const memoryContext = generateContextString();
      const learningContext = personalizedLearning.generatePersonalizedPrompt();
      const summaryContext = await summaryService.getContextString();

      const baseInstruction = config?.systemInstruction || ECHO_SYSTEM_INSTRUCTION;

      const fullSystemInstruction = `
${baseInstruction}

${memoryContext}

${summaryContext}

${learningContext}
`;
      const voiceName = config?.voiceName || 'Fenrir';

      console.log(`Connecting with voice: ${voiceName}, pre-roll frames: ${this.maxPreRollFrames}`);

      this.sessionPromise = this.ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: this.useLocalVoice ? [Modality.TEXT] : [Modality.AUDIO],
          systemInstruction: fullSystemInstruction,
          tools: [
            { functionDeclarations: [memoryToolDeclaration, timeToolDeclaration, ...(PROACTIVE_AI_TOOLS as any), ...(agentSkillService.getTools() as any)] },
            googleSearchTool // Enables real-time search for sports, stocks, weather, news
          ],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: this.handleOpen.bind(this),
          onmessage: this.handleMessage.bind(this),
          onerror: (e) => {
            console.error(e);
            this.callbacks.onError(new Error('Connection error'));
          },
          onclose: () => {
            console.log('Session closed');
            this.callbacks.onDisconnect();
            this.stopScreenShare();
          },
        },
      });

      this.startVolumeMonitoring();
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error('Failed to connect'));
    }
  }

  public async startInterviewMode() {
    if (!this.inputAudioContext) return;

    try {
      // 1. Get System Audio (via Screen Share with Audio)
      const systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required for getDisplayMedia, but we'll ignore video
        audio: true
      });

      // 2. Get Microphone
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 3. Mix Streams
      const sourceMic = this.inputAudioContext.createMediaStreamSource(micStream);
      const sourceSystem = this.inputAudioContext.createMediaStreamSource(systemStream);
      const destination = this.inputAudioContext.createMediaStreamDestination();

      sourceMic.connect(destination);
      sourceSystem.connect(destination);

      // 4. Update Stream Reference & Restart Processing
      this.stream = destination.stream;

      // Cleanup old processor if exists
      if (this.inputProcessor) {
        this.inputProcessor.disconnect();
        this.inputProcessor = null;
      }

      this.startAudioInput();

      // Handle stream end (user stops sharing)
      systemStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare(); // Re-use stop logic to reset to mic-only if needed, or just stop
        // TODO: ideally fallback to just mic, but for now let's just stop
        console.log("Interview mode ended (screen share stopped)");
      };

      // Store tracks for cleanup
      this.screenStream = systemStream; // Re-use screenStream variable

    } catch (e) {
      console.error("Failed to start Interview Mode", e);
      throw e;
    }
  }

  public async startScreenShare() {
    if (this.screenStream) return;

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 2, max: 5 }
        },
        audio: false
      });

      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.screenStream;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;

      const track = this.screenStream.getVideoTracks()[0];
      track.onended = () => {
        this.stopScreenShare();
      };

      // Wait for video to be ready, then send first frame immediately
      this.videoElement.addEventListener('loadeddata', () => {
        this.videoCanvas = document.createElement('canvas');
        // Send first frame right away so AI can see the screen instantly
        this.captureAndSendFrame();

        // Tell the AI it can now see the screen
        this.sendTextMessage(
          '[SYSTEM] Screen sharing is now active. You can see the user\'s screen in real-time. ' +
          'Proactively describe what you see, answer questions about screen content, and provide suggestions. ' +
          'Respond quickly and concisely.'
        );

        // Then continue at 2 FPS (every 500ms) for fast response
        this.screenShareInterval = window.setInterval(() => {
          this.captureAndSendFrame();
        }, 500);
      }, { once: true });

      await this.videoElement.play();

    } catch (e) {
      console.error("Error starting screen share:", e);
      throw e;
    }
  }

  public stopScreenShare() {
    if (this.screenShareInterval) {
      clearInterval(this.screenShareInterval);
      this.screenShareInterval = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    this.videoCanvas = null; ``
  }

  private captureAndSendFrame() {
    if (!this.videoElement || !this.videoCanvas) return;

    const vw = this.videoElement.videoWidth;
    const vh = this.videoElement.videoHeight;
    if (vw === 0 || vh === 0) return;

    // Scale down to max 640px wide for fast transfer
    const scale = Math.min(1, 640 / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    this.videoCanvas.width = w;
    this.videoCanvas.height = h;
    const ctx = this.videoCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(this.videoElement, 0, 0, w, h);
    const base64 = this.videoCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];

    this.sessionPromise?.then(session => {
      session.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
    });
  }

  // ─── File type categories ───
  private static IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
  private static TEXT_TYPES = [
    'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
    'application/json', 'application/xml', 'text/xml', 'text/markdown',
    'application/x-yaml', 'text/x-python', 'text/x-java', 'text/x-c',
  ];
  private static PDF_TYPE = 'application/pdf';

  /**
   * Universal file sender — handles images, PDFs, text/code, and documents.
   * Returns a description of what was sent for UI feedback.
   */
  public async sendFile(file: File, instruction?: string): Promise<string> {
    const session = await this.sessionPromise;
    if (!session) throw new Error('Not connected');

    const mime = file.type || this.guessMime(file.name);
    const prefix = instruction ? `[USER INSTRUCTION: ${instruction}]\n\n` : '';

    // ── Images ──
    if (GeminiLiveService.IMAGE_TYPES.some(t => mime.startsWith(t.split('/')[0])) || mime.startsWith('image/')) {
      const base64 = await this.compressImageFile(file, 1024, 0.7);
      session.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
      if (prefix) {
        await this.sendTextMessage(prefix + `I just sent you an image: "${file.name}". Please analyze it according to my instruction above.`);
      }
      return `📷 Image: ${file.name}`;
    }

    // ── PDFs — render each page as an image ──
    if (mime === GeminiLiveService.PDF_TYPE) {
      const text = await this.extractPdfText(file);
      if (text.length > 0) {
        const truncated = text.slice(0, 15000); // Limit to ~15k chars for speed
        await this.sendTextMessage(
          prefix +
          `[DOCUMENT UPLOADED: "${file.name}" (PDF, ${Math.ceil(file.size / 1024)}KB)]\n\n` +
          `--- CONTENT START ---\n${truncated}\n--- CONTENT END ---\n\n` +
          `Analyze this document thoroughly. Respond concisely and fast.`
        );
        return `📄 PDF: ${file.name} (${Math.ceil(file.size / 1024)}KB)`;
      }
      // Fallback: send as raw base64 if text extraction fails
      const b64 = await this.fileToBase64(file);
      session.sendRealtimeInput([{ mimeType: 'application/pdf', data: b64 }]);
      return `📄 PDF: ${file.name}`;
    }

    // ── Text / Code files ──
    if (GeminiLiveService.TEXT_TYPES.includes(mime) || this.isTextFile(file.name)) {
      const text = await file.text();
      const truncated = text.slice(0, 20000);
      const ext = file.name.split('.').pop() || 'txt';
      await this.sendTextMessage(
        prefix +
        `[FILE UPLOADED: "${file.name}" (${ext.toUpperCase()}, ${Math.ceil(file.size / 1024)}KB)]\n\n` +
        `\`\`\`${ext}\n${truncated}\n\`\`\`\n\n` +
        `Analyze this file. Respond concisely and fast.`
      );
      return `📝 File: ${file.name}`;
    }

    // ── Fallback: send raw bytes for any other type ──
    const b64 = await this.fileToBase64(file);
    session.sendRealtimeInput([{ mimeType: mime || 'application/octet-stream', data: b64 }]);
    if (prefix) {
      await this.sendTextMessage(prefix + `I sent a file: "${file.name}" (${mime}). Please analyze it.`);
    }
    return `📎 File: ${file.name}`;
  }

  /** Send a text message into the live session */
  public async sendTextMessage(text: string): Promise<void> {
    const session = await this.sessionPromise;
    if (!session) return;
    session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }] });
  }

  /** Keep sendImage for backward compat */
  public async sendImage(input: string | File | Blob): Promise<void> {
    if (input instanceof File) {
      await this.sendFile(input);
      return;
    }
    let base64: string;
    if (typeof input === 'string') {
      base64 = input.includes(',') ? input.split(',')[1] : input;
    } else {
      base64 = await this.fileToBase64(input);
    }
    const session = await this.sessionPromise;
    if (!session) return;
    session.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
  }

  private compressImageFile(file: File | Blob, maxDim: number, quality: number): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  private fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.readAsDataURL(file);
    });
  }

  private async extractPdfText(file: File): Promise<string> {
    // Use FileReader to get text content — for PDFs without a library,
    // we extract raw text strings from the binary
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    // Extract text between stream markers (basic PDF text extraction)
    const matches: string[] = [];
    const regex = /\((.*?)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const val = match[1].trim();
      if (val.length > 2 && /[a-zA-Z]/.test(val)) {
        matches.push(val);
      }
    }
    return matches.join(' ').slice(0, 15000);
  }

  private guessMime(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
      pdf: 'application/pdf',
      txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
      json: 'application/json', xml: 'application/xml',
      html: 'text/html', css: 'text/css', js: 'text/javascript',
      ts: 'text/javascript', py: 'text/x-python', java: 'text/x-java',
      c: 'text/x-c', cpp: 'text/x-c', h: 'text/x-c',
      rs: 'text/plain', go: 'text/plain', rb: 'text/plain',
      sh: 'text/plain', yaml: 'application/x-yaml', yml: 'application/x-yaml',
      sql: 'text/plain', swift: 'text/plain', kt: 'text/plain',
      dart: 'text/plain', tsx: 'text/javascript', jsx: 'text/javascript',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return map[ext] || 'application/octet-stream';
  }

  private isTextFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx',
      'py', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'rb', 'sh', 'yaml', 'yml',
      'sql', 'swift', 'kt', 'dart', 'log', 'env', 'cfg', 'ini', 'toml'].includes(ext);
  }

  private handleOpen() {
    this.callbacks.onConnect();
    this.startAudioInput();
  }

  private calculateRMS(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  private downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number = 16000): Float32Array {
    if (outputRate >= inputRate) return buffer;

    const ratio = inputRate / outputRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < newLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  private startAudioInput() {
    if (!this.inputAudioContext || !this.stream) return;

    const source = this.inputAudioContext.createMediaStreamSource(this.stream);
    if (this.inputAnalyser) source.connect(this.inputAnalyser);

    // 2048 samples is approx 128ms latency bucket at 16k, but varies at 48k
    // We'll stick to 2048 or 4096 for stability
    const bufferSize = this.inputAudioContext.sampleRate > 30000 ? 4096 : 2048;
    this.inputProcessor = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);

    this.inputProcessor.onaudioprocess = (e) => {
      if (this.isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const inputRate = this.inputAudioContext?.sampleRate || 16000;

      // Downsample if needed (target 16000Hz)
      const targetRate = 16000;
      const needsDownsampling = inputRate > 24000;

      const processedData = needsDownsampling
        ? this.downsampleBuffer(inputData, inputRate, targetRate)
        : inputData;

      const finalRate = needsDownsampling ? targetRate : inputRate;

      const rms = this.calculateRMS(processedData);
      const isCurrentFrameSpeech = rms > this.silenceThreshold;

      // VAD Logic
      if (isCurrentFrameSpeech) {
        this.silenceFrameCount = 0;

        if (!this.isSpeechActive) {
          this.isSpeechActive = true;
          this.flushPreRoll(finalRate);
        }

        this.sendAudioChunk(processedData, finalRate);
      } else {
        // Silence detected
        if (this.isSpeechActive) {
          this.silenceFrameCount++;
          if (this.silenceFrameCount <= this.maxSilenceFrames) {
            this.sendAudioChunk(processedData, finalRate);
          } else {
            this.isSpeechActive = false;
          }
        } else {
          this.addToPreRoll(processedData);
        }
      }
    };

    source.connect(this.inputProcessor);
    this.inputProcessor.connect(this.inputAudioContext.destination);
  }

  private addToPreRoll(data: Float32Array) {
    const clone = new Float32Array(data);
    this.preRollBuffer.push(clone);
    if (this.preRollBuffer.length > this.maxPreRollFrames) {
      this.preRollBuffer.shift();
    }
  }

  private flushPreRoll(sampleRate: number = 16000) {
    if (this.preRollBuffer.length === 0) return;
    for (const buffer of this.preRollBuffer) {
      this.sendAudioChunk(buffer, sampleRate);
    }
    this.preRollBuffer = [];
  }

  private sendAudioChunk(data: Float32Array, sampleRate: number = 16000) {
    const pcmBlob = createPcmBlob(data, sampleRate);
    this.sessionPromise?.then((session) => {
      session.sendRealtimeInput({ media: pcmBlob });
    });
  }

  private async handleMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;
    if (serverContent) {
      if (serverContent.inputTranscription) {
        this.handleTranscript(serverContent.inputTranscription.text, 'user', false);
      }
      if (serverContent.outputTranscription) {
        this.handleTranscript(serverContent.outputTranscription.text, 'assistant', false);
      }

      // Handle Model Turn for Text (when in Local Voice mode)
      if (this.useLocalVoice && serverContent.modelTurn?.parts?.[0]?.text) {
        const text = serverContent.modelTurn.parts[0].text;
        this.handleTranscript(text, 'assistant', true);
        await this.synthesizeLocalVoice(text);
        return; // Skip default audio handling
      }
      if (serverContent.turnComplete) {
        if (this.currentTurnId) {
          this.callbacks.onMessageUpdate({
            id: this.currentTurnId,
            role: this.currentRole,
            text: this.currentTranscript,
            timestamp: Date.now(),
            isFinal: true
          });
          this.currentTurnId = null;
          this.currentTranscript = '';
        }
      }
    }

    if (message.toolCall) {
      const responses: any[] = [];
      for (const fc of message.toolCall.functionCalls) {
        if (fc.name === 'updateMemory') {
          const { key, value } = fc.args as any;
          const newItem = saveMemory(key, value);
          this.callbacks.onMemoryUpdate(newItem);

          responses.push({
            id: fc.id,
            name: fc.name,
            response: { result: `Memory updated: Saved ${key}=${value}` }
          });
        }
        else if (fc.name === 'get_current_time') {
          const now = new Date();
          responses.push({
            id: fc.id,
            name: fc.name,
            response: { result: `The current time is ${now.toLocaleTimeString()}` }
          });
        }
        else {
          // 1. Try Agent Skills
          try {
            const result = await agentSkillService.executeTool(fc.name, fc.args);
            responses.push({
              id: fc.id,
              name: fc.name,
              response: result
            });
          } catch (skillError: any) {
            // If tool not found in skills, try Proactive AI
            if (skillError.message && skillError.message.includes('not found')) {
              try {
                const result = await proactiveAI.handleFunctionCall(fc.name, fc.args as any);
                responses.push({
                  id: fc.id,
                  name: fc.name,
                  response: result
                });
              } catch (error) {
                console.error(`Error handling function ${fc.name}:`, error);
                responses.push({
                  id: fc.id,
                  name: fc.name,
                  response: { error: error instanceof Error ? error.message : 'Unknown error' }
                });
              }
            } else {
              // Real error in skill execution
              responses.push({
                id: fc.id,
                name: fc.name,
                response: { error: skillError.message }
              });
            }
          }
        }
      }

      if (responses.length > 0) {
        this.sessionPromise?.then(session => {
          session.sendToolResponse({
            functionResponses: responses as any
          });
        });
      }
    }

    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext && this.outputAnalyser) {
      const audioBytes = base64ToArrayBuffer(base64Audio);
      const audioBuffer = await decodeAudioData(new Uint8Array(audioBytes), this.outputAudioContext);

      const now = this.outputAudioContext.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now + 0.05;
      }

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAnalyser); // Analyser is already connected to Gain -> Destination

      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
    }

    if (message.serverContent?.interrupted) {
      this.sources.forEach(source => source.stop());
      this.sources.clear();
      this.nextStartTime = 0;
      this.currentTurnId = null;
      this.isSpeechActive = false;
      this.silenceFrameCount = 0;
      this.preRollBuffer = [];
      // Don't stop screen share on interrupt, just audio state
    }
  }

  private handleTranscript(text: string, role: 'user' | 'assistant', isFinal: boolean) {
    if (!text) return;

    if (this.currentRole !== role || !this.currentTurnId) {
      this.currentTurnId = crypto.randomUUID();
      this.currentRole = role;
      this.currentTranscript = '';
    }

    this.currentTranscript += text;

    this.callbacks.onMessageUpdate({
      id: this.currentTurnId,
      role: this.currentRole,
      text: this.currentTranscript,
      timestamp: Date.now(),
      isFinal: isFinal
    });

    // Learn from user's speech patterns (only if it's a user message and is final)
    if (role === 'user' && isFinal) {
      personalizedLearning.learnFromSpeech(this.currentTranscript, 'voice-conversation').catch(err => {
        console.error('Error learning from speech:', err);
      });
    }
  }

  public async disconnect() {
    this.stopScreenShare();
    if (this.inputProcessor) {
      this.inputProcessor.disconnect();
      this.inputProcessor.onaudioprocess = null;
      this.inputProcessor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.inputAudioContext) {
      await this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      await this.outputAudioContext.close();
      this.outputAudioContext = null;
      this.outputGainNode = null;
    }
    if (this.volumeInterval) {
      window.clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    this.sources.forEach(s => s.stop());
    this.sources.clear();
    this.preRollBuffer = [];
    this.sessionPromise = null;
    this.callbacks.onDisconnect();
  }

  private startVolumeMonitoring() {
    this.volumeInterval = window.setInterval(() => {
      let inputVol = 0;
      let outputVol = 0;

      if (this.inputAnalyser) {
        const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(data);
        inputVol = data.reduce((a, b) => a + b) / data.length;
      }

      if (this.outputAnalyser) {
        const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyser.getByteFrequencyData(data);
        outputVol = data.reduce((a, b) => a + b) / data.length;
      }

      this.callbacks.onVolumeChange(inputVol, outputVol);
    }, 50);
  }

  // New Method: Synthesize Voice via Local Server
  private async synthesizeLocalVoice(text: string) {
    try {
      // Send text to local python server
      const response = await fetch('http://localhost:8000/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          reference_audio: '', // TODO: Get from IndexedDB -> AudioStorageService
          // For now, server requires reference_audio. We need a way to pass it or mock it.
          // We'll send a dummy valid base64 for now if not available, OR 
          // we depend on the user having uploaded one.
          // Actually, let's just assume the server handles "default" if empty for now, or we'll fix this in next step.
          language: 'en'
        })
      });

      if (!response.ok) throw new Error('Local TTS failed');

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await this.outputAudioContext?.decodeAudioData(arrayBuffer);

      if (audioBuffer && this.outputAudioContext && this.outputAnalyser) {
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAnalyser);
        // Analyser is already connected to Gain -> Destination
        source.start(0);
      }

    } catch (e) {
      console.error("Local TTS Error:", e);
    }
  }

  public setOutputVolume(volume: number) {
    if (this.outputGainNode) {
      // Clamp volume between 0 and 1
      const v = Math.max(0, Math.min(1, volume));
      this.outputGainNode.gain.setValueAtTime(v, this.outputAudioContext?.currentTime || 0);
    }
  }
}
