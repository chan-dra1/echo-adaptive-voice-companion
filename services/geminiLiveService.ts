import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { MemoryItem, ChatMessage } from '../types';
import { saveMemory, generateContextString } from './memoryService';
import { createPcmBlob, decodeAudioData, base64ToArrayBuffer } from './audioUtils';
import { getLiveModelName, ECHO_SYSTEM_INSTRUCTION } from '../constants';
import { PROACTIVE_AI_TOOLS, proactiveAI } from './proactiveAIService';
import { agentSkillService } from './agentSkillService';
import githubSkill from '../skills/githubSkill';
import knowledgeSkill from '../skills/knowledgeSkill';
import ghostSkill from '../skills/ghostSkill';
import fileGenSkill from '../skills/fileGenSkill';
import reminderSkill from '../skills/reminderSkill';
import flightSkill from '../skills/flightSkill';
import webSkill from '../skills/webSkill';
import resumeSkill from '../skills/resumeSkill';
import taskMissionSkill from '../skills/taskMissionSkill';
import projectOpsSkill from '../skills/projectOpsSkill';
import marketingPlannerSkill from '../skills/marketingPlannerSkill';
import calcSkill from '../skills/calcSkill';
import screenIntelSkill from '../skills/screenIntelSkill';
import jobHuntSkill from '../skills/jobHuntSkill';
import { summaryService } from './summaryService';
import { personalizedLearning } from './personalizedLearningService';
import { bootstrapAgent } from './agentBootstrap';
// MOBILE-AGENT: additive hook — lifecycle/idle/silence/hard-cap timers.
import { sessionLifecycleService } from './sessionLifecycleService';
import {
  conversationPolicyService,
  InterruptMode,
  loadInterruptMode,
} from './conversationPolicyService';
import { mobileAudioBridge } from './mobileAudioBridge';

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
      sensitivity: {
        type: Type.STRING,
        description: "Optional. 'cloud_ok' (default) means this memory can be sent to cloud providers. 'local_only' means it must NEVER leave the device — use for passwords, addresses, health info, private secrets, etc.",
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
const googleSearchTool = { google_search: {} };

export interface ConnectConfig {
  voiceName?: string;
  speechConfig?: {
    silenceThreshold?: number; // RMS threshold 0.0 to 1.0
    preRollMs?: number; // Ms of audio to keep before speech detection (latency buffer)
  }
  useLocalVoice?: boolean;
  systemInstruction?: string;
  /** polite | balanced | eager — when to duck / barge-in / defer during overlap */
  interruptMode?: InterruptMode;
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
  private intentionalDisconnect = false;
  private authFailure = false;
  private sessionOpened = false;
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

  // Smart interrupt / ambient defer
  private deferAiOutput = false;
  private lastOutputRms = 0;
  private interruptMode: InterruptMode = loadInterruptMode();
  private normalOutputGain = 1.0;

  // Transcript state
  private currentTurnId: string | null = null;
  private currentRole: 'user' | 'assistant' = 'user';
  private currentTranscript: string = '';

  // Screen/Camera Share state
  private screenStream: MediaStream | null = null;
  private screenShareInterval: number | null = null;
  private cameraStream: MediaStream | null = null;
  private cameraInterval: number | null = null;
  private videoCanvas: HTMLCanvasElement | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private cameraFacingMode: 'user' | 'environment' = 'user';

  public getCameraStream() { return this.cameraStream; }
  public getScreenStream() { return this.screenStream; }
  public getCameraFacingMode() { return this.cameraFacingMode; }

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

      // Resume AudioContexts (Critical for iOS/Mobile)
      if (this.inputAudioContext.state === 'suspended') {
        await this.inputAudioContext.resume();
      }
      if (this.outputAudioContext.state === 'suspended') {
        await this.outputAudioContext.resume();
      }

      // Create Gain Node for volume control
      this.outputGainNode = this.outputAudioContext.createGain();
      this.outputGainNode.gain.value = 1.0; // Default to full volume

      // Route: Analyser -> Gain -> Destination
      this.outputAnalyser.connect(this.outputGainNode);
      this.outputGainNode.connect(this.outputAudioContext.destination);

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

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
      if (config?.interruptMode) {
        this.interruptMode = config.interruptMode;
        conversationPolicyService.setMode(config.interruptMode);
      } else {
        this.interruptMode = loadInterruptMode();
        conversationPolicyService.setMode(this.interruptMode);
      }
      this.deferAiOutput = false;
      conversationPolicyService.reset();

      mobileAudioBridge.registerAudioContexts({
        input: this.inputAudioContext,
        output: this.outputAudioContext,
      });

      // Skills are registered globally on app boot via bootstrapAgent().
      // We call it again defensively (it's idempotent) so the service still
      // works if used outside the normal App.tsx lifecycle.
      try {
        await bootstrapAgent();
      } catch (e) {
        console.warn("Bootstrap failed, falling back to static skills…", e);
        try {
          agentSkillService.registerSkill(githubSkill);
          agentSkillService.registerSkill(knowledgeSkill);
          agentSkillService.registerSkill(ghostSkill);
          agentSkillService.registerSkill(fileGenSkill);
          agentSkillService.registerSkill(reminderSkill);
          agentSkillService.registerSkill(flightSkill);
          agentSkillService.registerSkill(webSkill);
          agentSkillService.registerSkill(resumeSkill);
          agentSkillService.registerSkill(taskMissionSkill);
          agentSkillService.registerSkill(projectOpsSkill);
          agentSkillService.registerSkill(marketingPlannerSkill);
          agentSkillService.registerSkill(calcSkill);
          agentSkillService.registerSkill(screenIntelSkill);
          agentSkillService.registerSkill(jobHuntSkill);
        } catch { /* swallow */ }
      }

      // Initialize tools. If the caller already supplied a system instruction
      // (e.g. App.tsx now builds the full context via modelContextBuilder),
      // we don't re-append memory/knowledge here to avoid duplication.
      const summaryContext = await summaryService.getContextString();
      const learningContext = personalizedLearning.generatePersonalizedPrompt();

      let fullSystemInstruction: string;
      if (config?.systemInstruction) {
        fullSystemInstruction = `${config.systemInstruction}\n\n${summaryContext}\n\n${learningContext}`;
      } else {
        const memoryContext = generateContextString('cloud');
        fullSystemInstruction = `
${ECHO_SYSTEM_INSTRUCTION}

${memoryContext}

${summaryContext}

${learningContext}
`;
      }
      const voiceName = config?.voiceName || 'Fenrir';
      const liveModel = getLiveModelName();
      console.log(`[GeminiLive] Model: ${liveModel}, voice: ${voiceName}, pre-roll frames: ${this.maxPreRollFrames}`);
      console.log(`[GeminiLive] System Instruction Length: ${fullSystemInstruction.length} chars`);
      const toolsCount = (agentSkillService.getTools()?.length || 0) + 2 + PROACTIVE_AI_TOOLS.length;
      console.log(`[GeminiLive] Total Tools: ${toolsCount}`);

      this.intentionalDisconnect = false;
      this.authFailure = false;
      this.sessionOpened = false;

      this.sessionPromise = this.ai.live.connect({
        model: liveModel,
        config: {
          responseModalities: this.useLocalVoice ? [Modality.TEXT] : [Modality.AUDIO],
          systemInstruction: fullSystemInstruction,
          tools: [
            { functionDeclarations: [memoryToolDeclaration, timeToolDeclaration, ...(PROACTIVE_AI_TOOLS as any), ...(agentSkillService.getTools() as any)] },
            googleSearchTool as any // Enables real-time search for sports, stocks, weather, news
          ],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live WebSocket opened successfully');
            this.sessionOpened = true;
            this.handleOpen();
          },
          onmessage: this.handleMessage.bind(this),
          onerror: (e) => {
            console.error('[GeminiLive] WebSocket Error Object:', e);
            const err = new Error(`WebSocket Error: ${e instanceof Error ? e.message : 'Check console for details'}`);
            this.callbacks.onError(err);
          },
          onclose: (event) => {
            const reason = event.reason || 'No reason provided';
            console.warn(
              `[GeminiLive] WebSocket closed | Code: ${event.code} | Reason: ${reason} | WasClean: ${event.wasClean}`
            );

            const wasConnected = this.sessionOpened;
            this.sessionOpened = false;

            const authFailure =
              event.code === 1007 ||
              event.code === 1008 ||
              event.code === 4001 ||
              event.code === 4003 ||
              /api.?key|auth|permission|invalid|unauthorized|forbidden|credential/i.test(reason);

            if (authFailure) {
              this.authFailure = true;
              this.intentionalDisconnect = true;
            }

            if (!this.intentionalDisconnect && !wasConnected) {
              this.callbacks.onError(
                new Error(
                  `Could not connect (${event.code}): ${reason}. Verify Gemini API key and Live model "${getLiveModelName()}".`
                )
              );
            } else if (!this.intentionalDisconnect && wasConnected && event.code !== 1000 && event.code !== 1001) {
              this.callbacks.onError(
                new Error(`Live session ended (${event.code}): ${reason}. Check API key, model (${getLiveModelName()}), and quota.`)
              );
            }

            this.callbacks.onDisconnect();
            this.stopScreenShare();
            this.stopCamera();

            // Auto-reconnect only after a successful session, not on failed setup or auth errors
            if (
              !this.intentionalDisconnect &&
              !this.authFailure &&
              wasConnected &&
              event.code !== 1000 &&
              event.code !== 1001
            ) {
              console.log(`[GeminiLive] Unexpected closure (${event.code}). Attempting to reconnect in 3 seconds…`);
              setTimeout(() => this.connect(config), 3000);
            }
          },
        },
      });

      this.startVolumeMonitoring();
      this.setupMediaSession();
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
    if (this.videoElement && !this.cameraStream) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
      this.videoCanvas = null;
    }
  }

  public async startCamera(facingMode: 'user' | 'environment' = 'user') {
    if (this.cameraStream) return;
    this.cameraFacingMode = facingMode;

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          facingMode,
        },
        audio: false
      });

      if (!this.videoElement) {
        this.videoElement = document.createElement('video');
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
      }
      this.videoElement.srcObject = this.cameraStream;

      const track = this.cameraStream.getVideoTracks()[0];
      track.onended = () => {
        this.stopCamera();
      };

      this.videoElement.addEventListener('loadeddata', () => {
        if (!this.videoCanvas) {
          this.videoCanvas = document.createElement('canvas');
        }
        this.captureAndSendFrame();

        this.sendTextMessage(
          '[SYSTEM] Camera is now active. You can see the user and their environment. ' +
          'Be conversational and react to what you see. ' +
          'Respond quickly and concisely.'
        );

        this.cameraInterval = window.setInterval(() => {
          this.captureAndSendFrame();
        }, 1000); // 1 FPS for camera to save bandwidth
      }, { once: true });

      await this.videoElement.play();

    } catch (e) {
      console.error("Error starting camera:", e);
      throw e;
    }
  }

  public stopCamera() {
    if (this.cameraInterval) {
      clearInterval(this.cameraInterval);
      this.cameraInterval = null;
    }
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
    if (this.videoElement && !this.screenStream) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
      this.videoCanvas = null;
    }
  }

  public async switchCamera(): Promise<'user' | 'environment'> {
    const newFacing: 'user' | 'environment' = this.cameraFacingMode === 'user' ? 'environment' : 'user';
    // Stop current stream (but keep videoElement/canvas for the restart)
    if (this.cameraInterval) { clearInterval(this.cameraInterval); this.cameraInterval = null; }
    if (this.cameraStream) { this.cameraStream.getTracks().forEach(t => t.stop()); this.cameraStream = null; }
    await this.startCamera(newFacing);
    return newFacing;
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
      session.sendRealtimeInput({ video: { mimeType: 'image/jpeg', data: base64 } });
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
      session.sendRealtimeInput({ video: { mimeType: 'image/jpeg', data: base64 } });
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
      session.sendRealtimeInput({ media: { mimeType: 'application/pdf', data: b64 } });
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
    session.sendRealtimeInput({ media: { mimeType: mime || 'application/octet-stream', data: b64 } });
    if (prefix) {
      await this.sendTextMessage(prefix + `I sent a file: "${file.name}" (${mime}). Please analyze it.`);
    }
    return `📎 File: ${file.name}`;
  }

  /** Send a text message into the live session */
  public async sendTextMessage(text: string): Promise<void> {
    const session = await this.sessionPromise;
    if (!session) return;
    // MOBILE-AGENT: any explicit user input counts as activity.
    try { sessionLifecycleService.noteActivity(); } catch { /* ignore */ }
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
    session.sendRealtimeInput({ video: { mimeType: 'image/jpeg', data: base64 } });
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
    this.updateMediaSession('connected');
    // MOBILE-AGENT: start lifecycle timers (idle/silence/hard-cap).
    try { sessionLifecycleService.start(); } catch (e) { console.warn('[lifecycle.start]', e); }
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

      const aiSpeaking = this.sources.size > 0;
      const policyAction = conversationPolicyService.evaluate({
        userRms: rms,
        outputRms: this.lastOutputRms,
        aiSpeaking,
        userSpeechActive: this.isSpeechActive,
        deferOutput: this.deferAiOutput,
      });
      switch (policyAction.type) {
        case 'duck':
          this.setOutputDuck(policyAction.gain);
          break;
        case 'barge_in':
          this.localInterruptPlayback();
          break;
        case 'defer_output':
          this.deferAiOutput = true;
          this.setOutputDuck(0.06);
          try {
            window.dispatchEvent(new CustomEvent('echo:ambient-busy', { detail: { active: true } }));
          } catch { /* ignore */ }
          break;
        case 'resume_output':
          this.deferAiOutput = false;
          this.setOutputGain(this.normalOutputGain);
          try {
            window.dispatchEvent(new CustomEvent('echo:ambient-busy', { detail: { active: false } }));
          } catch { /* ignore */ }
          break;
        default:
          break;
      }

      // VAD Logic
      if (isCurrentFrameSpeech) {
        this.silenceFrameCount = 0;

        if (!this.isSpeechActive) {
          this.isSpeechActive = true;
          this.flushPreRoll(finalRate);
          this.updateMediaSession('listening');
        }

        // MOBILE-AGENT: feed lifecycle service "user is here" signal.
        try { sessionLifecycleService.noteAudioActivity(); } catch { /* ignore */ }

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

  private setupMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Echo Agent',
        artist: 'Personal AI Companion',
        album: 'Adaptive Voice Live',
        artwork: [
          { src: 'https://echo-adaptive-voice-companion.vercel.app/logo192.png', sizes: '192x192', type: 'image/png' },
          { src: 'https://echo-adaptive-voice-companion.vercel.app/logo512.png', sizes: '512x512', type: 'image/png' },
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => {
        this.setMuted(false);
        this.updateMediaSession('listening');
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.setMuted(true);
        this.updateMediaSession('paused');
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        this.callbacks.onDisconnect();
      });
    }
  }

  private updateMediaSession(state: 'connected' | 'listening' | 'speaking' | 'paused') {
    if ('mediaSession' in navigator) {
      const statusText = state.charAt(0).toUpperCase() + state.slice(1);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Echo Agent - ${statusText}`,
        artist: 'Personal AI Companion',
        album: 'Live Session'
      });
      
      // We use the playbackState to reflect the AI's "activity" on the lock screen
      navigator.mediaSession.playbackState = (state === 'speaking' || state === 'listening') ? 'playing' : 'paused';
    }
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
      session.sendRealtimeInput({ audio: pcmBlob });
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
          const { key, value, sensitivity } = fc.args as any;
          const safeSensitivity = sensitivity === 'local_only' ? 'local_only' : 'cloud_ok';
          const newItem = saveMemory(key, value, safeSensitivity);
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
      if (this.deferAiOutput) {
        this.updateMediaSession('listening');
      } else {
      const audioBytes = base64ToArrayBuffer(base64Audio);
      const audioBuffer = await decodeAudioData(new Uint8Array(audioBytes), this.outputAudioContext);
      this.updateMediaSession('speaking');

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
    }

    if (message.serverContent?.interrupted) {
      this.localInterruptPlayback();
      this.currentTurnId = null;
      this.isSpeechActive = false;
      this.silenceFrameCount = 0;
      this.preRollBuffer = [];
    }
  }

  /** Stop AI playback immediately (local barge-in or server interrupt). */
  private localInterruptPlayback(): void {
    this.sources.forEach((source) => {
      try { source.stop(); } catch { /* ignore */ }
    });
    this.sources.clear();
    this.nextStartTime = 0;
    this.setOutputGain(this.normalOutputGain);
    this.updateMediaSession('listening');
    try {
      window.dispatchEvent(new CustomEvent('echo:local-barge-in'));
    } catch { /* ignore */ }
  }

  private setOutputGain(volume: number): void {
    this.normalOutputGain = Math.max(0, Math.min(1, volume));
    if (this.outputGainNode && this.outputAudioContext) {
      this.outputGainNode.gain.setTargetAtTime(
        this.normalOutputGain,
        this.outputAudioContext.currentTime,
        0.02
      );
    }
  }

  private setOutputDuck(duckGain: number): void {
    if (this.outputGainNode && this.outputAudioContext) {
      this.outputGainNode.gain.setTargetAtTime(
        Math.max(0, Math.min(1, duckGain)),
        this.outputAudioContext.currentTime,
        0.03
      );
    }
  }

  public async resumeAudioContexts(): Promise<void> {
    await mobileAudioBridge.resumeAudioContexts({
      input: this.inputAudioContext,
      output: this.outputAudioContext,
    });
  }

  public setInterruptMode(mode: InterruptMode): void {
    this.interruptMode = mode;
    conversationPolicyService.setMode(mode);
  }

  public startHandsFreeKeepalive(): void {
    mobileAudioBridge.startAudioKeepalive(this.outputAudioContext);
  }

  public stopHandsFreeKeepalive(): void {
    mobileAudioBridge.stopAudioKeepalive();
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
    this.intentionalDisconnect = true;
    this.sessionOpened = false;
    // Close Live session if still open
    try {
      const session = await this.sessionPromise;
      session?.close?.();
    } catch { /* ignore */ }
    // MOBILE-AGENT: stop lifecycle timers on disconnect.
    try { sessionLifecycleService.stop(); } catch { /* ignore */ }
    mobileAudioBridge.stopAudioKeepalive();
    conversationPolicyService.reset();
    this.deferAiOutput = false;
    this.stopScreenShare();
    this.stopCamera();
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
        this.lastOutputRms = outputVol / 255;
      }

      if (typeof window !== 'undefined') {
        (window as any)._lastInputVol = inputVol;
        (window as any)._lastOutputVol = outputVol;
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
    const v = Math.max(0, Math.min(1, volume));
    this.normalOutputGain = v;
    this.setOutputGain(v);
  }
}
