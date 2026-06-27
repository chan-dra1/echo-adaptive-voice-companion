import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiLiveService } from './services/geminiLiveService';
import { getMemories } from './services/memoryService';
import { getHistory, saveMessage } from './services/chatHistoryService'; // Deprecated, will remove usage below
import { proactiveAI } from './services/proactiveAIService';
import { personalizedLearning } from './services/personalizedLearningService';
import MemoryPanel from './components/MemoryPanel';
import ChatPanel from './components/ChatPanel';
import { VoiceVault } from './components/VoiceVault';
import PersonalizedLearningPanel from './components/PersonalizedLearningPanel';
import GhostMode from './components/InterviewMode';
import FileUploadPopup from './components/FileUploadPopup';
import ToastContainer from './components/ToastContainer';
import Tooltip from './components/Tooltip';
import Button from './components/Button';
import { Mic, MicOff, Volume2, VolumeX, X, Terminal, MessageSquare, Database, Monitor, MonitorOff, Lock, Menu, Ghost, Globe, Brain, User, Paperclip, Camera, Plus, Clock, Headphones, Folder, Ear, Heart, Sparkles, Megaphone, Zap, Rocket, RotateCcw, ChevronUp } from 'lucide-react';
import { MemoryItem, ChatMessage, ConnectionStatus } from './types';
import { VOICE_OPTIONS, ECHO_SYSTEM_INSTRUCTION } from './constants';
import { useToast } from './hooks/useToast';
import { createConversation, getConversations, getActiveConversationId, setActiveConversationId, buildKnowledgeContext, Conversation, deleteConversation, getConversation, addMessageToConversation } from './services/conversationService';
import StealthPanel from './components/StealthPanel';
import TranslationPanel from './components/TranslationPanel';
import KnowledgeDropZone from './components/KnowledgeDropZone';
import SettingsVault from './components/SettingsVault';
import TextChatBar from './components/TextChatBar';
import AvatarDisplay from './components/AvatarDisplay';
import MatrixRain from './components/MatrixRain';
import VoiceOrb from './components/VoiceOrb';
import { ghostAgent } from './services/ghostAgentService';
import SkillApprovalModal from './components/SkillApprovalModal';
import { initVault, isUnlocked, resetVaultKeys } from './services/cryptoService';
import { bootstrapAgent } from './services/agentBootstrap';
import { buildSystemContext } from './services/modelContextBuilder';
import { taskMissionService } from './services/taskMissionService';
import VaultOrganizerPanel from './components/VaultOrganizerPanel';
// MOBILE-AGENT: PWA / mobile-only additive imports.
import InstallPrompt from './components/InstallPrompt';
import { wakeLockService } from './services/wakeLockService';
import { sessionLifecycleService, loadLifecycleConfig } from './services/sessionLifecycleService';
import { setScreenShareActive, SCREEN_READ_EVENT, ScreenReadEventDetail } from './skills/screenIntelSkill';
import {
  loadInterruptMode,
  cycleInterruptMode,
  interruptModeLabel,
  InterruptMode,
} from './services/conversationPolicyService';
import { mobileAudioBridge } from './services/mobileAudioBridge';
// Companion system
import { getCompanionState, recordSessionStart } from './services/companionPersonaService';
import { checkDeadlinesOnBoot } from './services/deadlineGuardianService';
import { ambientModeService, getAmbientConfig } from './services/ambientModeService';
import CompanionPanel from './components/CompanionPanel';
import OnboardingWizard from './components/OnboardingWizard';
import SkillsVaultPanel from './components/SkillsVaultPanel';
import SocialComposer from './components/SocialComposer';
import AutomationHub from './components/AutomationHub';
import MissionDashboard from './components/MissionDashboard';

export default function App() {
  // Check if ANY provider key is available
  const hasAnyApiKey = () => {
    return !!(localStorage.getItem('echo_api_key') || localStorage.getItem('echo_openai_key') || localStorage.getItem('echo_anthropic_key') || localStorage.getItem('echo_groq_key') || localStorage.getItem('echo_nvidia_key') || localStorage.getItem('echo_openrouter_key') || localStorage.getItem('echo_mistral_key') || localStorage.getItem('echo_hf_key'));
  };

  // Vault unlock state — gates the entire UI until crypto is initialized.
  const [vaultReady, setVaultReady] = useState<boolean>(isUnlocked());

  const [apiKey, setApiKey] = useState((localStorage.getItem('echo_api_key') || '').trim());
  const [hasKey, setHasKey] = useState(hasAnyApiKey());
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);

  const refreshKeyState = useCallback(() => {
    setApiKey((localStorage.getItem('echo_api_key') || '').trim());
    setHasKey(hasAnyApiKey());
  }, []);

  const hasGeminiKey = !!(apiKey || localStorage.getItem('echo_api_key') || '').trim();
  const hasOpenAiKey = !!(localStorage.getItem('echo_openai_key') || '').trim();
  const textOnlyMode = hasOpenAiKey && !hasGeminiKey;

  useEffect(() => {
    const onAmbient = (e: Event) => {
      const active = (e as CustomEvent<{ active?: boolean }>).detail?.active;
      setDeferHint(!!active);
    };
    const onBarge = () => setDeferHint(false);
    window.addEventListener('echo:ambient-busy', onAmbient);
    window.addEventListener('echo:local-barge-in', onBarge);
    window.addEventListener('echo:app-visible', onBarge);
    return () => {
      window.removeEventListener('echo:ambient-busy', onAmbient);
      window.removeEventListener('echo:local-barge-in', onBarge);
      window.removeEventListener('echo:app-visible', onBarge);
    };
  }, []);

  useEffect(() => {
    if (!vaultReady) return;
    const gemini = (localStorage.getItem('echo_api_key') || '').trim();
    const openai = (localStorage.getItem('echo_openai_key') || '').trim();
    const saved = localStorage.getItem('echo_default_brain');
    if (!gemini && openai && (!saved || saved === 'gemini')) {
      localStorage.setItem('echo_default_brain', 'openai');
      localStorage.setItem('echo_llm_provider', 'openai');
    }
  }, [vaultReady]);

  useEffect(() => {
    if (vaultReady) return;
    (async () => {
      try {
        await initVault({ autoMode: true });
      } catch (e) {
        console.warn('[App] vault init failed, resetting to quick mode:', e);
        resetVaultKeys();
        await initVault({ autoMode: true });
      }
      await bootstrapAgent().catch(err => console.error('[App] bootstrap failed:', err));
      setVaultReady(true);
    })().catch((e) => {
      console.error('[App] vault boot failed:', e);
      setVaultReady(true);
    });
  }, [vaultReady]);

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [volumeState, setVolumeState] = useState({ inputVolume: 0, outputVolume: 0 });

  // Settings
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS.find(v => v.id === 'Kore') || VOICE_OPTIONS[0]);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  // UI Toggles
  const [showMemory, setShowMemory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showVoiceVault, setShowVoiceVault] = useState(false);
  const [showPersonalizedLearning, setShowPersonalizedLearning] = useState(false);
  const [showGhostMode, setShowGhostMode] = useState(false);
  const [showVaultOrganizer, setShowVaultOrganizer] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenReadBadge, setScreenReadBadge] = useState<ScreenReadEventDetail | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isLocalVoiceEnabled, setIsLocalVoiceEnabled] = useState(false);
  const [isStealthMode, setIsStealthMode] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTranslationMode, setIsTranslationMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>(localStorage.getItem('echo_avatar_url') || '/ai-avatar.png');
  // Companion system
  const [showCompanionPanel, setShowCompanionPanel] = useState(false);
  const [showSkillsVault, setShowSkillsVault] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showMissions, setShowMissions] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !getCompanionState().onboardingComplete);
  // Conversations loading
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  // MOBILE-AGENT: hands-free + coarse-pointer (mobile) detection.
  const [isHandsFree, setIsHandsFree] = useState<boolean>(() => loadLifecycleConfig().handsFree);
  const [interruptMode, setInterruptMode] = useState<InterruptMode>(() => loadInterruptMode());
  const [deferHint, setDeferHint] = useState(false);
  const [isMobileCoarse, setIsMobileCoarse] = useState<boolean>(() => {
    try { return window.matchMedia?.('(pointer:coarse)').matches ?? false; } catch { return false; }
  });

  // Camera facing mode (front / back)
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  // Floating draggable camera overlay position (fixed px from top-left)
  const [camPos, setCamPos] = useState({ x: 16, y: 100 });
  const camDragging = useRef(false);
  const camDragOffset = useRef({ x: 0, y: 0 });

  const serviceRef = useRef<GeminiLiveService | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { removeToast, success, error, warning, info } = useToast();

  useEffect(() => {
    mobileAudioBridge.initMobileAudioBridge(() => {
      if (status === ConnectionStatus.CONNECTED && serviceRef.current) {
        void serviceRef.current.resumeAudioContexts();
      }
    });
  }, [status]);

  const [showFileUpload, setShowFileUpload] = useState(false);
  const [currentConvoId, setCurrentConvoId] = useState<string | null>(() => {
    const id = getActiveConversationId();
    if (!id) {
      const convo = createConversation();
      return convo.id;
    }
    return id;
  });

  useEffect(() => {
    setMemories(getMemories());
    // Load history from active conversation
    if (currentConvoId) {
      const convo = getConversation(currentConvoId);
      if (convo) {
        // Map Convo messages to ChatMessage format for UI
        // Map Convo messages to ChatMessage format for UI
        const mappedHistory: ChatMessage[] = convo.messages.map(m => ({
          id: crypto.randomUUID(),
          role: m.role === 'ai' ? 'assistant' : 'user',
          text: m.text,
          timestamp: m.timestamp,
          isFinal: true
        }));
        setChatHistory(mappedHistory);
      }
    }

    // Enable proactive AI background service
    proactiveAI.setActive(true);

    // ── Companion system boot ──────────────────────────────────────────────
    recordSessionStart();
    checkDeadlinesOnBoot();
    // Restore ambient mode if it was enabled
    const ambientCfg = getAmbientConfig();
    if (ambientCfg.enabled) ambientModeService.setEnabled(true);

    // Deadline nudge handler
    const handleDeadlineNudge = (e: any) => {
      const { message } = e.detail || {};
      if (message) warning(message);
    };
    window.addEventListener('echo-deadline-nudge', handleDeadlineNudge);

    // Ambient mode handlers
    const handleAmbientQuiet = () => info('Echo is now in quiet mode. Say "Echo wake up" to resume.');
    const handleAmbientResume = () => info('Echo is back and listening 👂');
    const handleSilenceCheckin = () => info('Hey, you still there? I\'m here if you need me.');
    window.addEventListener('ambient:quiet', handleAmbientQuiet);
    window.addEventListener('ambient:resumed', handleAmbientResume);
    window.addEventListener('ambient:silence-checkin', handleSilenceCheckin);
    // ──────────────────────────────────────────────────────────────────────

    // Listen for reminders
    const handleReminder = (e: any) => {
      const reminder = e.detail;
      success(`Reminder: ${reminder.title}`);
    };
    const handleTaskNudge = (e: any) => {
      const task = e?.detail?.task;
      const nextBestAction = e?.detail?.nextBestAction;
      if (!task?.title) return;
      const msg = nextBestAction
        ? `Task nudge: ${task.title}. Next: ${nextBestAction}`
        : `Task nudge: ${task.title}`;
      info(msg);
    };
    const handleTaskOverdue = (e: any) => {
      const task = e?.detail?.task;
      if (!task?.title) return;
      warning(`Overdue task: ${task.title}`);
    };
    const handleTaskCatchup = (e: any) => {
      const missed = Number(e?.detail?.missedNudges || 0);
      const overdue = Number(e?.detail?.overdueTasks || 0);
      if (missed <= 0) return;
      info(`Task catch-up: ${missed} missed nudges${overdue ? `, ${overdue} overdue` : ''}.`);
    };

    window.addEventListener('echo-reminder', handleReminder);
    window.addEventListener('echo-task-nudge', handleTaskNudge);
    window.addEventListener('echo-task-overdue', handleTaskOverdue);
    window.addEventListener('echo-task-catchup', handleTaskCatchup);
    const onVisible = () => {
      if (document.visibilityState === 'visible') taskMissionService.handleRuntimeResume();
    };
    const onOnline = () => taskMissionService.handleRuntimeResume();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    // Check backend status
    ghostAgent.isAvailable().then(setIsBackendOnline);

    // Global Key Listener for Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowChat(false);
        setShowMemory(false);
        setShowVoiceVault(false);
        setIsSettingsOpen(false);
        setShowFileUpload(false);
        setShowPersonalizedLearning(false);
        setShowGhostMode(false);
        setShowVaultOrganizer(false);
        setShowMobileMenu(false);
        setShowCompanionPanel(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // MOBILE-AGENT: PWA shortcut deep-links (?action=new-chat, ?action=reminder)
    try {
      const params = new URLSearchParams(window.location.search);
      const action = params.get('action');
      if (action === 'new-chat') {
        const convo = createConversation();
        setCurrentConvoId(convo.id);
        setChatHistory([]);
      } else if (action === 'reminder') {
        info('Quick Reminder — tell Echo what to remember.');
        setShowChat(true);
      }
      if (action) {
        params.delete('action');
        const next = window.location.pathname + (params.toString() ? `?${params}` : '');
        window.history.replaceState({}, '', next);
      }
    } catch { /* ignore */ }

    // MOBILE-AGENT: lifecycle events from sessionLifecycleService.
    const onIdle = () => {
      info('Echo went idle — disconnecting to save battery.');
      serviceRef.current?.disconnect();
      wakeLockService.release();
    };
    const onSilence = () => {
      info('No voice detected — pausing Echo. Tap mic to resume.');
      serviceRef.current?.disconnect();
      wakeLockService.release();
    };
    const onHardCap = () => {
      warning('Session hit the safety cap. Disconnecting.');
      serviceRef.current?.disconnect();
      wakeLockService.release();
    };
    window.addEventListener('lifecycle:idle', onIdle);
    window.addEventListener('lifecycle:silence', onSilence);
    window.addEventListener('lifecycle:hard-cap', onHardCap);

    // MOBILE-AGENT: pointer:coarse media query (re-evaluate if device flips).
    const mql = window.matchMedia?.('(pointer:coarse)');
    const onMqlChange = (e: MediaQueryListEvent) => setIsMobileCoarse(e.matches);
    if (mql?.addEventListener) mql.addEventListener('change', onMqlChange);
    else if (mql?.addListener) mql.addListener(onMqlChange); // older Safari

    // Camera overlay drag — global move/up so fast swipes don't lose tracking
    const onCamMove = (e: MouseEvent | TouchEvent) => {
      if (!camDragging.current) return;
      const pt = 'touches' in e ? (e as TouchEvent).touches[0] : e as MouseEvent;
      const nx = Math.max(0, Math.min(window.innerWidth - 120, pt.clientX - camDragOffset.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 120, pt.clientY - camDragOffset.current.y));
      setCamPos({ x: nx, y: ny });
    };
    const onCamUp = () => { camDragging.current = false; };
    window.addEventListener('mousemove', onCamMove);
    window.addEventListener('touchmove', onCamMove, { passive: true });
    window.addEventListener('mouseup', onCamUp);
    window.addEventListener('touchend', onCamUp);

    return () => {
      proactiveAI.setActive(false);
      window.removeEventListener('echo-reminder', handleReminder);
      window.removeEventListener('echo-task-nudge', handleTaskNudge);
      window.removeEventListener('echo-task-overdue', handleTaskOverdue);
      window.removeEventListener('echo-task-catchup', handleTaskCatchup);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('lifecycle:idle', onIdle);
      window.removeEventListener('lifecycle:silence', onSilence);
      window.removeEventListener('lifecycle:hard-cap', onHardCap);
      if (mql?.removeEventListener) mql.removeEventListener('change', onMqlChange);
      else if (mql?.removeListener) mql.removeListener(onMqlChange);
      window.removeEventListener('mousemove', onCamMove);
      window.removeEventListener('touchmove', onCamMove);
      window.removeEventListener('mouseup', onCamUp);
      window.removeEventListener('touchend', onCamUp);
      // Companion
      window.removeEventListener('echo-deadline-nudge', handleDeadlineNudge);
      window.removeEventListener('ambient:quiet', handleAmbientQuiet);
      window.removeEventListener('ambient:resumed', handleAmbientResume);
      window.removeEventListener('ambient:silence-checkin', handleSilenceCheckin);
    };
  }, [success, info, warning]);

  // Keyboard navigation: ESC to close sidebars and modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVoiceVault) {
          setShowVoiceVault(false);
        } else if (showPersonalizedLearning) {
          setShowPersonalizedLearning(false);
        } else if (showGhostMode) {
          setShowGhostMode(false);
        } else if (showVaultOrganizer) {
          setShowVaultOrganizer(false);
        } else if (showChat) {
          setShowChat(false);
        } else if (showMemory) {
          setShowMemory(false);
        } else if (showMobileMenu) {
          setShowMobileMenu(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showVoiceVault, showChat, showMemory, showMobileMenu, showPersonalizedLearning, showGhostMode, showVaultOrganizer]);

  const handleConnect = useCallback(async () => {
    const geminiKey = (localStorage.getItem('echo_api_key') || apiKey || '').trim();
    const openaiKey = (localStorage.getItem('echo_openai_key') || '').trim();

    if (!geminiKey) {
      if (openaiKey) {
        error('Voice needs a Google Gemini API key. Your OpenAI key works for text chat — open the chat bar below.');
      } else {
        error('Add a Google Gemini API key in Settings for voice, or OpenAI for text chat.');
      }
      setIsSettingsOpen(true);
      return;
    }

    if (geminiKey !== apiKey) setApiKey(geminiKey);

    if (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING) {
      await serviceRef.current?.disconnect();
      serviceRef.current = null; // Clean up ref to prevent memory leaks
      info("Disconnected from Echo");
      return;
    }

    setStatus(ConnectionStatus.CONNECTING);
    setMicPermissionDenied(false);

    try {
      // Check microphone permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (micError: any) {
        setMicPermissionDenied(true);
        setStatus(ConnectionStatus.ERROR);
        if (micError.name === 'NotAllowedError' || micError.name === 'PermissionDeniedError') {
          error("Microphone permission denied. Please allow microphone access in your browser settings.");
        } else if (micError.name === 'NotFoundError') {
          error("No microphone found. Please connect a microphone and try again.");
        } else {
          error("Microphone access error: " + (micError.message || "Unknown error"));
        }
        return;
      }

      const trimmedKey = geminiKey;
      const service = new GeminiLiveService(trimmedKey, {
        onConnect: () => {
          setStatus(ConnectionStatus.CONNECTED);
          success("Connected to Echo");
          // MOBILE-AGENT: hold the screen awake during a live session.
          try { wakeLockService.acquire({ useNativeBridge: mobileAudioBridge.isNativeShell() }); } catch { /* ignore */ }
          // Apply current hands-free preference to fresh lifecycle.
          try { sessionLifecycleService.setHandsFree(isHandsFree); } catch { /* ignore */ }
          if (isHandsFree) {
            try { service.startHandsFreeKeepalive(); } catch { /* ignore */ }
          }
        },
        onDisconnect: () => {
          setStatus(ConnectionStatus.DISCONNECTED);
          setIsScreenSharing(false);
          info("Disconnected from Echo");
          // MOBILE-AGENT: release wake-lock when the session ends.
          try { wakeLockService.release(); } catch { /* ignore */ }
          try { sessionLifecycleService.stop(); } catch { /* ignore */ }
        },
        onError: (err) => {
          console.error(err);
          setStatus(ConnectionStatus.ERROR);
          const errorMessage = err.message || 'Unknown connection error';
          const hasOpenAi = !!openaiKey;
          if (errorMessage.includes('API key') || errorMessage.includes('Verify Gemini')) {
            if (hasOpenAi) {
              error('Gemini key rejected for voice. Check your Google Gemini key in Settings, or use text chat with OpenAI.');
            } else {
              error('Invalid Gemini API key. Create one at aistudio.google.com/apikey');
            }
          } else if (errorMessage.includes('network')) {
            error("Network error. Please check your internet connection.");
          } else if (errorMessage.includes('quota')) {
            error("API quota exceeded. Please check your usage limits.");
          } else {
            error(`Connection error: ${errorMessage}`);
          }
        },
        onVolumeChange: (input, output) => setVolumeState({ inputVolume: input, outputVolume: output }),
        onMemoryUpdate: () => setMemories(getMemories()),
        onMessageUpdate: (message) => {
          // Update UI state immediately (handling streaming)
          setChatHistory(prev => {
            const existingIndex = prev.findIndex(m => m.id === message.id);
            if (existingIndex >= 0) {
              const newHistory = [...prev];
              newHistory[existingIndex] = message;
              return newHistory;
            } else {
              return [...prev, message];
            }
          });

          // Persist ONLY final messages to storage
          if (message.isFinal && currentConvoId) {
            addMessageToConversation(
              currentConvoId,
              message.role === 'assistant' ? 'ai' : 'user',
              message.text
            );
          }
        }
      });

      service.setMuted(isMicMuted);
      serviceRef.current = service;
      if (typeof window !== 'undefined') {
        (window as any).liveService = service;
      }

      // Build mode-specific extras
      const persistedTranslation = localStorage.getItem('echo_translation_mode') === 'true';
      const persistedStealth = localStorage.getItem('echo_stealth_mode') === 'true';
      const persistedGhost = localStorage.getItem('echo_ghost_active') === 'true';
      const ghostConfigJson = localStorage.getItem('echo_ghost_config');

      const extras: string[] = [];
      if (isTranslationMode || persistedTranslation) {
        extras.push("[SYSTEM] TRANSLATION MODE ACTIVE. You are now a Real-Time Interpreter. Translate everything to English.");
      }
      if (persistedGhost && ghostConfigJson) {
        try {
          const cfg = JSON.parse(ghostConfigJson);
          extras.push(`[GHOST PERSONA] Style: ${cfg.style}; allow interruptions: ${cfg.allowInterruptions}; filler words: ${cfg.useFillerWords}; emotional: ${cfg.emotionalResponses}.`);
        } catch { /* ignore */ }
      }

      const builtSys = buildSystemContext({
        destination: 'cloud',
        provider: 'gemini-live',
        extraInstructions: extras.join('\n\n'),
      });
      const systemInstruction = builtSys.systemInstruction;
      const effectiveStealth = isStealthMode || persistedStealth;

      await service.connect({
        voiceName: selectedVoice.id,
        useLocalVoice: isLocalVoiceEnabled || effectiveStealth,
        systemInstruction,
        speechConfig: {
          preRollMs: 300,
          silenceThreshold: 0.015
        },
        interruptMode,
      });

      if (effectiveStealth) {
        success("Ghost Mode Active");
      }
    } catch (err: any) {
      console.error('Connection failed:', err);
      setStatus(ConnectionStatus.ERROR);
      error(`Failed to connect: ${err.message || 'Unknown error'}`);
    }
  }, [apiKey, status, isMicMuted, selectedVoice, isLocalVoiceEnabled, isStealthMode, isHandsFree, isTranslationMode, interruptMode, currentConvoId, success, error, info]);

  const toggleMute = () => {
    const newState = !isMicMuted;
    setIsMicMuted(newState);
    if (serviceRef.current) {
      serviceRef.current.setMuted(newState);
    }
  };

  // MOBILE-AGENT: hands-free doubles silence tolerance and sets lock-screen metadata.
  const toggleHandsFree = useCallback(() => {
    const next = !isHandsFree;
    setIsHandsFree(next);
    try { sessionLifecycleService.setHandsFree(next); } catch { /* ignore */ }
    if (next) {
      info('Hands-Free ON — extended silence tolerance, lock-screen controls active.');
      try {
        serviceRef.current?.startHandsFreeKeepalive();
        if (mobileAudioBridge.isNativeShell()) {
          import('./mobile/capacitorBridge').then((m) => m.notifyNativeBackgroundAudio(true)).catch(() => {});
        }
      } catch { /* ignore */ }
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Echo Listening',
            artist: 'Hands-Free Voice Agent',
            album: 'Echo Live',
          });
          navigator.mediaSession.playbackState = 'playing';
        }
      } catch { /* ignore */ }
    } else {
      info('Hands-Free OFF.');
      try {
        serviceRef.current?.stopHandsFreeKeepalive();
        if (mobileAudioBridge.isNativeShell()) {
          import('./mobile/capacitorBridge').then((m) => m.notifyNativeBackgroundAudio(false)).catch(() => {});
        }
      } catch { /* ignore */ }
      try {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      } catch { /* ignore */ }
    }
  }, [isHandsFree, info]);

  const toggleInterruptMode = useCallback(() => {
    const next = cycleInterruptMode(interruptMode);
    setInterruptMode(next);
    serviceRef.current?.setInterruptMode(next);
    info(interruptModeLabel(next));
  }, [interruptMode, info]);

  useEffect(() => {
    setScreenShareActive(isScreenSharing);
  }, [isScreenSharing]);

  useEffect(() => {
    const onScreenRead = (e: Event) => {
      const detail = (e as CustomEvent<ScreenReadEventDetail>).detail;
      if (!detail) return;
      setScreenReadBadge(detail);
      const t = window.setTimeout(() => setScreenReadBadge(null), 3000);
      return () => window.clearTimeout(t);
    };
    window.addEventListener(SCREEN_READ_EVENT, onScreenRead);
    return () => window.removeEventListener(SCREEN_READ_EVENT, onScreenRead);
  }, []);

  const handleScreenShare = useCallback(async () => {
    if (!serviceRef.current || status !== ConnectionStatus.CONNECTED) return;

    if (isScreenSharing) {
      await serviceRef.current.stopScreenShare();
      setIsScreenSharing(false);
      info("Screen sharing stopped");
    } else {
      try {
        await serviceRef.current.startScreenShare();
        setIsScreenSharing(true);
        success("Screen sharing started");
      } catch (e) {
        console.error("Failed to start screen share", e);
        error("Failed to start screen share. Please try again.");
      }
    }
  }, [status, isScreenSharing, success, error, info]);


  const toggleAudioMute = useCallback(() => {
    if (serviceRef.current) {
      const newMuted = !isAudioMuted;
      setIsAudioMuted(newMuted);
      serviceRef.current.setOutputVolume(newMuted ? 0 : 1);
    }
  }, [isAudioMuted]);

  const handleManualMemoryUpdate = () => {
    setMemories(getMemories());
  };

  const handleHistoryClear = () => {
    setChatHistory([]);
  };

  const getThemeGradient = () => {
    switch (status) {
      case ConnectionStatus.CONNECTED:
        return 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/40 via-echo-dark to-echo-dark';
      case ConnectionStatus.CONNECTING:
        return 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-yellow-900/20 via-echo-dark to-echo-dark';
      case ConnectionStatus.ERROR:
        return 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-900/40 via-echo-dark to-echo-dark';
      default:
        return 'bg-echo-dark';
    }
  };

  const isThinking = status === ConnectionStatus.CONNECTED &&
    chatHistory.length > 0 &&
    chatHistory[chatHistory.length - 1].role === 'user' &&
    chatHistory[chatHistory.length - 1].isFinal;

  const isUserSpeaking = volumeState.inputVolume > 10;

  const handleSelectConversation = (id: string) => {
    const convo = getConversation(id);
    if (!convo) return;

    // If we're connected, we might want to warn user?
    // For now, just switch context.

    setActiveConversationId(id);
    setCurrentConvoId(id);
    setChatHistory(convo.messages);
    success(`Resumed: ${convo.title}`);
  };

  const loadConversations = useCallback(() => {
    setConversations(getConversations());
  }, []);

  const handleNewChat = useCallback(() => {
    if (status === ConnectionStatus.CONNECTED) {
      serviceRef.current?.disconnect();
    }
    const convo = createConversation();
    setCurrentConvoId(convo.id);
    setChatHistory([]);
    loadConversations();
    success('🆕 New conversation started');
  }, [status, success, loadConversations]);

  const handleDeleteConversation = (id: string) => {
    deleteConversation(id);
    loadConversations();
    if (currentConvoId === id) {
      // If deleted current, start new or switch to another
      const remaining = getConversations();
      if (remaining.length > 0) {
        handleSelectConversation(remaining[0].id);
      } else {
        handleNewChat();
      }
    }
  }

  const hideBottomChrome = isSettingsOpen || showFileUpload || (vaultReady && showOnboarding);

  return (

    <div className={`relative w-screen h-screen overflow-hidden flex flex-col selection:bg-[#00ff88]/20${isMobileCoarse ? ' mobile-lite' : ''}`} style={{ background: 'var(--bg-base)', fontFamily: 'var(--font-ui)', color: 'var(--text-primary)' }}>
      {/* Onboarding Wizard — shows on first launch after vault is ready */}
      {vaultReady && showOnboarding && (
        <OnboardingWizard
          onComplete={() => setShowOnboarding(false)}
          onSkip={() => setShowOnboarding(false)}
        />
      )}
      <SkillApprovalModal />
      {/* MOBILE-AGENT: dismissible install pill (Android BIP + iOS hint) */}
      {!isSettingsOpen && <InstallPrompt />}
      <KnowledgeDropZone onFileDrop={(file) => {
        setFileToUpload(file);
        setShowFileUpload(true);
      }}>
        {/* Matrix Background */}
        <MatrixRain 
          isActive={status === ConnectionStatus.CONNECTED} 
          outputVolume={volumeState.outputVolume}
          inputVolume={volumeState.inputVolume}
        />

        <div className="flex-1 flex flex-col relative z-20 w-full h-full">
          {/* Backdrop Overlay for Sidebars */}
          {(showChat || showMemory || showVoiceVault || showMobileMenu || showPersonalizedLearning || showGhostMode || showVaultOrganizer || showCompanionPanel || showSkillsVault || showSocial || showAutomation || showMissions) && (
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-30 transition-opacity duration-300"
              onClick={() => {
                setShowChat(false);
                setShowMemory(false);
                setShowVoiceVault(false);
                setShowMobileMenu(false);
                setShowPersonalizedLearning(false);
                setShowGhostMode(false);
                setShowVaultOrganizer(false);
                setShowCompanionPanel(false);
                setShowSkillsVault(false);
                setShowSocial(false);
                setShowAutomation(false);
                setShowMissions(false);
              }}
              aria-hidden="true"
            />
          )}

          {/* Settings Vault (Modal) */}
          <SettingsVault
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onSaved={refreshKeyState}
          />

          {/* File Upload Popup (Modal) */}
          {showFileUpload && (
            <div className="absolute inset-0 z-50 pointer-events-auto">
              <FileUploadPopup
                isConnected={status === ConnectionStatus.CONNECTED}
                onSendFile={async (file, instruction) => {
                  if (!serviceRef.current) return;
                  await serviceRef.current.sendFile(file, instruction);
                  success(`Sent ${file.name} to Echo`);
                  setShowFileUpload(false);
                  setFileToUpload(null);
                }}
                onClose={() => {
                  setShowFileUpload(false);
                  setFileToUpload(null);
                }}
                initialFile={fileToUpload}
              />
            </div>
          )}

          {/* Sidebars (Drawers) */}
          <div className={`fixed top-0 bottom-0 left-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showChat ? 'translate-x-0' : '-translate-x-full'}`}>
            <ChatPanel
              history={chatHistory}
              onHistoryClear={handleHistoryClear}
              isThinking={isThinking}
              onClose={() => setShowChat(false)}
              onApiKeyMissing={() => setIsSettingsOpen(true)}
              onNewMessage={(role, text) => {
                if (currentConvoId) {
                  addMessageToConversation(currentConvoId, role === 'assistant' ? 'ai' : 'user', text);
                }
              }}
            />
          </div>

          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showMemory ? 'translate-x-0' : 'translate-x-full'}`}>
             <MemoryPanel memories={memories} onUpdate={handleManualMemoryUpdate} onClose={() => setShowMemory(false)} />
          </div>

          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[420px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showVaultOrganizer ? 'translate-x-0' : 'translate-x-full'}`}>
            <VaultOrganizerPanel onClose={() => setShowVaultOrganizer(false)} />
          </div>

          {/* Companion Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showCompanionPanel ? 'translate-x-0' : 'translate-x-full'}`}>
            <CompanionPanel onClose={() => setShowCompanionPanel(false)} />
          </div>

          {/* Skills Vault Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[480px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showSkillsVault ? 'translate-x-0' : 'translate-x-full'}`}>
            <SkillsVaultPanel onClose={() => setShowSkillsVault(false)} />
          </div>

          {/* Social Autopilot Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[480px] p-3 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showSocial ? 'translate-x-0' : 'translate-x-full'}`}>
            <SocialComposer onClose={() => setShowSocial(false)} />
          </div>

          {/* Automation Hub Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[480px] p-3 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showAutomation ? 'translate-x-0' : 'translate-x-full'}`}>
            <AutomationHub onClose={() => setShowAutomation(false)} />
          </div>

          {/* Mission Dashboard Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[480px] p-3 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showMissions ? 'translate-x-0' : 'translate-x-full'}`}>
            <MissionDashboard onClose={() => setShowMissions(false)} />
          </div>

          <div className={`fixed top-0 bottom-0 left-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showVoiceVault ? 'translate-x-0' : '-translate-x-full'}`}>
            <VoiceVault
              onClose={() => setShowVoiceVault(false)}
              isLocalVoiceEnabled={isLocalVoiceEnabled}
              onToggleLocalVoice={setIsLocalVoiceEnabled}
            />
          </div>

          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showGhostMode ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="h-full w-full bg-echo-dark/95 backdrop-blur-xl border-l border-white/5 shadow-2xl">
               <GhostMode 
                 isActive={localStorage.getItem('echo_ghost_active') === 'true'} 
                 onActivate={(config) => {
                   try {
                     localStorage.setItem('echo_ghost_config', JSON.stringify(config));
                     localStorage.setItem('echo_ghost_active', 'true');
                   } catch { /* ignore */ }
                   setShowGhostMode(false);
                   success("Ghost persona will apply on next connect.");
                 }} 
               />
               <button 
                 onClick={() => setShowGhostMode(false)}
                 className="absolute top-4 right-4 text-gray-500 hover:text-white"
               >
                 <X size={24} />
               </button>
            </div>
          </div>

          {/* ═══ PREMIUM MAIN LAYOUT ════════════════════════════════ */}

          {/* LEFT SIDEBAR — icon navigation strip */}
          <nav className="echo-sidebar hidden md:flex" aria-label="Echo navigation">
            {/* Logo mark */}
            <div className="sidebar-logo mb-2">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--accent-green)', letterSpacing: '0.05em' }}>E</span>
            </div>

            <div style={{ width: '100%', height: 1, background: 'var(--border-subtle)', margin: '8px 0 12px' }} />

            <Tooltip content="Chat History">
              <button
                onClick={() => setShowChat(true)}
                className={`sidebar-btn ${showChat ? 'active' : ''}`}
                aria-label="Chat history"
              >
                <MessageSquare size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Memory Bank">
              <button
                onClick={() => setShowMemory(true)}
                className={`sidebar-btn ${showMemory ? 'active' : ''}`}
                aria-label="Memory bank"
              >
                <Brain size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Vault Organizer">
              <button
                onClick={() => setShowVaultOrganizer(true)}
                className={`sidebar-btn ${showVaultOrganizer ? 'active-cyan' : ''}`}
                aria-label="Vault organizer"
              >
                <Folder size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Skills Vault">
              <button
                onClick={() => setShowSkillsVault(true)}
                className={`sidebar-btn ${showSkillsVault ? 'active' : ''}`}
                aria-label="Skills vault"
              >
                <Sparkles size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Social Autopilot">
              <button
                onClick={() => setShowSocial(true)}
                className={`sidebar-btn ${showSocial ? 'active' : ''}`}
                aria-label="Social autopilot"
              >
                <Megaphone size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Automation Hub">
              <button
                onClick={() => setShowAutomation(true)}
                className={`sidebar-btn ${showAutomation ? 'active' : ''}`}
                aria-label="Automation hub"
              >
                <Zap size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Autonomous Missions">
              <button
                onClick={() => setShowMissions(true)}
                className={`sidebar-btn ${showMissions ? 'active' : ''}`}
                aria-label="Autonomous missions"
              >
                <Rocket size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Companion">
              <button
                onClick={() => setShowCompanionPanel(true)}
                className={`sidebar-btn ${showCompanionPanel ? 'active-pink' : ''}`}
                aria-label="Companion"
              >
                <Heart size={18} />
              </button>
            </Tooltip>

            <Tooltip content="Ghost Mode">
              <button
                onClick={() => setShowGhostMode(true)}
                className={`sidebar-btn ${isStealthMode ? 'active-cyan' : ''}`}
                aria-label="Ghost mode"
              >
                <Ghost size={18} />
              </button>
            </Tooltip>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            <Tooltip content={isBackendOnline ? 'Cloud Agent Online' : 'Cloud Agent Offline'}>
              <div className={`sidebar-btn ${isBackendOnline ? 'active' : ''}`} style={{ cursor: 'default' }}>
                <Database size={16} />
              </div>
            </Tooltip>

            <Tooltip content="Settings & Key Vault">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="sidebar-btn"
                aria-label="Settings"
              >
                <User size={18} />
              </button>
            </Tooltip>
          </nav>

          {/* MAIN STAGE */}
          <main
            className="flex-1 relative flex flex-col items-center justify-center h-full overflow-hidden"
            style={{ paddingLeft: 'max(env(safe-area-inset-left), 0px)', paddingRight: 'max(env(safe-area-inset-right), 0px)' }}
          >
            {/* Ambient mesh blobs — pure CSS background depth */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: 600, height: 600,
                borderRadius: '50%',
                background: status === ConnectionStatus.CONNECTED
                  ? 'radial-gradient(circle, rgba(0,255,136,0.055) 0%, transparent 70%)'
                  : 'radial-gradient(circle, rgba(30,140,255,0.04) 0%, transparent 70%)',
                top: '-10%', left: '50%', transform: 'translateX(-50%)',
                filter: 'blur(60px)',
                transition: 'background 2s ease',
                animation: 'float-slow 12s ease-in-out infinite',
                willChange: 'transform',
              }}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                width: 400, height: 400,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(0,100,255,0.04) 0%, transparent 70%)',
                bottom: '-5%', right: '10%',
                filter: 'blur(80px)',
                animation: 'float-slow 16s ease-in-out infinite reverse',
                willChange: 'transform',
              }}
            />

            {/* SCREEN_READ badge */}
            {isScreenSharing && screenReadBadge && (
              <div className="absolute top-4 right-4 z-20 pointer-events-none">
                <div
                  className="px-3 py-1 rounded-md animate-pulse"
                  style={{
                    background: 'rgba(5,8,16,0.85)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(0,255,136,0.35)',
                    boxShadow: 'var(--glow-green-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--accent-green)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  SCREEN_READ :: {screenReadBadge.source}
                  {screenReadBadge.title ? ` — ${screenReadBadge.title}` : ''}
                </div>
              </div>
            )}

            {/* STATUS PILL — top center */}
            <div className="absolute top-5 left-0 right-0 flex justify-center z-10 pointer-events-none pt-safe">
              <div
                className={`status-pill ${
                  status === ConnectionStatus.CONNECTED ? 'connected' : ''
                }`}
              >
                <span
                  className="status-dot"
                  style={{
                    background: status === ConnectionStatus.CONNECTED
                      ? 'var(--accent-green)'
                      : status === ConnectionStatus.CONNECTING
                        ? 'var(--accent-amber)'
                        : 'rgba(255,255,255,0.2)',
                    boxShadow: status === ConnectionStatus.CONNECTED
                      ? '0 0 8px var(--accent-green)'
                      : 'none',
                    animation: status !== ConnectionStatus.DISCONNECTED ? 'pulse-glow 2s ease-in-out infinite' : 'none',
                  }}
                />
                <span>
                  {deferHint && status === ConnectionStatus.CONNECTED
                    ? 'Ambient Hold'
                    : status === ConnectionStatus.CONNECTED
                      ? (isStealthMode ? 'Ghost Mode' : 'Neural Link Active')
                      : status === ConnectionStatus.CONNECTING
                        ? 'Connecting…'
                        : 'Echo · Standby'}
                </span>
              </div>
            </div>

            {/* ORB STAGE — the centerpiece */}
            <div
              className="relative flex items-center justify-center"
              style={{
                width: 'clamp(280px, min(60vw, 60vh), 520px)',
                height: 'clamp(280px, min(60vw, 60vh), 520px)',
                maxWidth: 520,
                maxHeight: 520,
                flexShrink: 0,
              }}
            >
              <VoiceOrb
                isActive={status === ConnectionStatus.CONNECTED}
                outputVolume={volumeState.outputVolume}
                inputVolume={volumeState.inputVolume}
                isThinking={isThinking}
              />

              {/* AI response preview — floats below orb core */}
              {status === ConnectionStatus.CONNECTED && (() => {
                const last = [...chatHistory].reverse().find(m => m.role === 'assistant');
                if (!last?.text?.trim()) return null;
                const text = last.text.trim();
                const preview = text.length > 100 ? '…' + text.slice(-100) : text;
                return (
                  <div
                    key={last.id}
                    className="absolute inset-x-4 flex justify-center pointer-events-none z-10"
                    style={{ bottom: '10%' }}
                  >
                    <p
                      className="animate-fade-up text-center max-w-xs leading-relaxed"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'clamp(9px, 1.3vw, 11px)',
                        color: 'rgba(255,255,255,0.32)',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {preview}
                    </p>
                  </div>
                );
              })()}

              {/* camera overlay moved to floating draggable below */}
            </div>

            {/* ── FLOATING DRAGGABLE CAMERA OVERLAY ───────────────────────────── */}
            {isCameraActive && (
              <div
                style={{
                  position: 'fixed',
                  left: camPos.x,
                  top: camPos.y,
                  width: 120,
                  height: 120,
                  zIndex: 60,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '2px solid var(--accent-green)',
                  boxShadow: 'var(--glow-green-sm)',
                  cursor: 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
                onMouseDown={(e) => {
                  camDragging.current = true;
                  camDragOffset.current = { x: e.clientX - camPos.x, y: e.clientY - camPos.y };
                  e.preventDefault();
                }}
                onTouchStart={(e) => {
                  camDragging.current = true;
                  camDragOffset.current = { x: e.touches[0].clientX - camPos.x, y: e.touches[0].clientY - camPos.y };
                }}
              >
                <AvatarDisplay
                  state="idle"
                  volume={0}
                  cameraStream={serviceRef.current?.getCameraStream()}
                  avatarUrl={avatarUrl}
                />
                {/* Flip camera button — bottom-right of the circle */}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!serviceRef.current) return;
                    try {
                      const next = await serviceRef.current.switchCamera();
                      setCameraFacing(next);
                    } catch { error('Could not switch camera'); }
                  }}
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                  }}
                  aria-label="Flip camera"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            )}

            {/* ── MOBILE BOTTOM SHEET (all nav options) ─────────────────────────── */}
            {showMobileMenu && (
              <div
                className="fixed inset-0 z-50 flex items-end md:hidden"
                onClick={() => setShowMobileMenu(false)}
              >
                <div
                  className="w-full rounded-t-2xl p-4"
                  style={{
                    background: 'rgba(8,12,22,0.97)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderBottom: 'none',
                    paddingBottom: 'max(env(safe-area-inset-bottom,16px),16px)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Handle */}
                  <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 16px' }} />
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>
                    Navigation
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
                    {([
                      { icon: MessageSquare, label: 'Chat',      action: () => { setShowChat(true);          setShowMobileMenu(false); } },
                      { icon: Brain,        label: 'Memory',     action: () => { setShowMemory(true);         setShowMobileMenu(false); } },
                      { icon: Folder,       label: 'Vault',      action: () => { setShowVaultOrganizer(true); setShowMobileMenu(false); } },
                      { icon: Sparkles,     label: 'Skills',     action: () => { setShowSkillsVault(true);    setShowMobileMenu(false); } },
                      { icon: Megaphone,    label: 'Social',     action: () => { setShowSocial(true);         setShowMobileMenu(false); } },
                      { icon: Zap,          label: 'Automations',action: () => { setShowAutomation(true);     setShowMobileMenu(false); } },
                      { icon: Rocket,       label: 'Missions',   action: () => { setShowMissions(true);       setShowMobileMenu(false); } },
                      { icon: Heart,        label: 'Companion',  action: () => { setShowCompanionPanel(true); setShowMobileMenu(false); } },
                      { icon: Ghost,        label: 'Ghost',      action: () => { setShowGhostMode(true);      setShowMobileMenu(false); } },
                      { icon: User,         label: 'Settings',   action: () => { setIsSettingsOpen(true);     setShowMobileMenu(false); } },
                      { icon: Monitor,      label: 'Screen',     action: () => {
                        setShowMobileMenu(false);
                        error('Screen sharing is not supported in mobile browsers. Use Echo on desktop to share your screen.');
                      }},
                      { icon: Plus,         label: 'Upload',     action: () => { setShowFileUpload(true);     setShowMobileMenu(false); } },
                    ] as { icon: React.ElementType; label: string; action: () => void }[]).map(({ icon: Icon, label, action }) => (
                      <button
                        key={label}
                        onClick={action}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          padding: '12px 4px',
                          borderRadius: 12,
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          color: 'var(--text-secondary)',
                          fontSize: 10,
                          fontFamily: 'var(--font-ui)',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon size={20} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>
                    Controls
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                    {([
                      { icon: Headphones, label: isHandsFree ? 'H-Free ON' : 'H-Free',   active: isHandsFree,    action: toggleHandsFree },
                      { icon: Ear,        label: `${interruptMode}`,                       active: interruptMode !== 'default', action: toggleInterruptMode },
                      { icon: isMicMuted ? MicOff : Mic, label: isMicMuted ? 'Unmute' : 'Mute mic', active: isMicMuted, action: toggleMute },
                      { icon: isAudioMuted ? VolumeX : Volume2, label: isAudioMuted ? 'Audio off' : 'Audio on', active: isAudioMuted, action: toggleAudioMute },
                    ] as { icon: React.ElementType; label: string; active?: boolean; action: () => void }[]).map(({ icon: Icon, label, active, action }) => (
                      <button
                        key={label}
                        onClick={() => { action(); setShowMobileMenu(false); }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          padding: '12px 4px',
                          borderRadius: 12,
                          background: active ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${active ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.06)'}`,
                          color: active ? 'var(--accent-green)' : 'var(--text-secondary)',
                          fontSize: 10,
                          fontFamily: 'var(--font-ui)',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon size={20} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── MOBILE HAMBURGER ─── top-right corner, mobile only ─────────── */}
            {!hideBottomChrome && (
              <button
                className="md:hidden"
                onClick={() => setShowMobileMenu(true)}
                style={{
                  position: 'fixed',
                  top: 'max(env(safe-area-inset-top,14px),14px)',
                  right: 16,
                  zIndex: 25,
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(8,12,22,0.8)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
                aria-label="Open menu"
              >
                <ChevronUp size={18} />
              </button>
            )}

            {/* TEXT CHAT BAR + BOTTOM DOCK — hidden while modals open */}
            {!hideBottomChrome && (
              <>
                <TextChatBar
                  onApiKeyMissing={() => setIsSettingsOpen(true)}
                  onNewMessage={(role, text) => {
                    const message: ChatMessage = {
                      id: crypto.randomUUID(),
                      role,
                      text,
                      timestamp: Date.now(),
                      isFinal: true,
                    };
                    setChatHistory(prev => [...prev, message]);
                    if (currentConvoId) {
                      addMessageToConversation(
                        currentConvoId,
                        role === 'assistant' ? 'ai' : 'user',
                        text,
                      );
                    }
                  }}
                />

                {/* PREMIUM FLOATING DOCK */}
                <div
                  className={`absolute z-50 pointer-events-auto echo-dock ${
                    status === ConnectionStatus.CONNECTED ? 'connected' : ''
                  }`}
                  style={{
                    bottom: 'max(env(safe-area-inset-bottom, 20px), 20px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    animation: 'float 8s ease-in-out infinite',
                  }}
                >
                  {/* Hands-free — desktop only in dock; mobile uses bottom sheet */}
                  <Tooltip content={isHandsFree ? 'Hands-Free ON' : 'Hands-Free OFF'}>
                    <button
                      onClick={toggleHandsFree}
                      className={`icon-btn hidden md:flex ${isHandsFree ? 'active-green' : ''}`}
                      aria-label="Toggle Hands-Free"
                      aria-pressed={isHandsFree}
                    >
                      <Headphones size={17} />
                    </button>
                  </Tooltip>

                  {/* Interrupt mode — desktop only in dock */}
                  <Tooltip content={`Interrupt: ${interruptMode}`}>
                    <button
                      onClick={toggleInterruptMode}
                      className={`icon-btn hidden md:flex ${
                        interruptMode === 'polite' ? 'active-cyan'
                        : interruptMode === 'eager' ? 'active-amber'
                        : ''
                      }`}
                      aria-label={`Interrupt mode: ${interruptMode}`}
                    >
                      <Ear size={17} />
                    </button>
                  </Tooltip>

                  <div className="dock-divider hidden md:block" />

                  {/* Ghost mode toggle — hidden on mobile (use bottom sheet) */}

                  {/* Camera */}
                  <Tooltip content={isCameraActive ? 'Stop Camera' : 'Camera Vision'}>
                    <button
                      onClick={async () => {
                        if (!serviceRef.current) return;
                        if (isCameraActive) {
                          serviceRef.current.stopCamera();
                          setIsCameraActive(false);
                        } else {
                          try { await serviceRef.current.startCamera(); setIsCameraActive(true); }
                          catch { error('Could not access camera'); }
                        }
                      }}
                      className={`icon-btn ${isCameraActive ? 'active-green' : ''}`}
                      aria-label="Camera"
                    >
                      <Camera size={17} />
                    </button>
                  </Tooltip>

                  {/* Mute audio output */}
                  <Tooltip content={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}>
                    <button
                      onClick={toggleAudioMute}
                      className={`icon-btn ${isAudioMuted ? 'danger' : ''}`}
                      aria-label="Toggle audio"
                    >
                      {isAudioMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                    </button>
                  </Tooltip>

                  <div className="dock-divider" />

                  {/* ── THE MIC BUTTON ── */}
                  <div className="relative flex items-center justify-center">
                    {/* Sonar rings */}
                    {status === ConnectionStatus.CONNECTED && (
                      <>
                        <div
                          className="absolute inset-0 rounded-full pointer-events-none mic-ring-1"
                          style={{ border: '2px solid rgba(0,255,136,0.55)' }}
                        />
                        <div
                          className="absolute inset-0 rounded-full pointer-events-none mic-ring-2"
                          style={{ border: '2px solid rgba(0,255,136,0.35)' }}
                        />
                      </>
                    )}
                    <Tooltip content={
                      textOnlyMode
                        ? 'Voice requires Gemini API key'
                        : status === ConnectionStatus.CONNECTED
                          ? 'Disconnect voice'
                          : status === ConnectionStatus.CONNECTING
                            ? 'Connecting…'
                            : 'Start voice (Gemini Live)'
                    }>
                      <button
                        onClick={handleConnect}
                        className={`mic-btn ${
                          status === ConnectionStatus.CONNECTED ? 'muted' :
                          status === ConnectionStatus.CONNECTING ? '' :
                          'active'
                        }`}
                        style={{
                          background: status === ConnectionStatus.CONNECTED
                            ? 'rgba(255,59,92,0.12)'
                            : status === ConnectionStatus.CONNECTING
                              ? 'rgba(255,179,0,0.12)'
                              : undefined,
                          borderColor: status === ConnectionStatus.CONNECTED
                            ? 'rgba(255,59,92,0.5)'
                            : status === ConnectionStatus.CONNECTING
                              ? 'rgba(255,179,0,0.5)'
                              : undefined,
                          color: status === ConnectionStatus.CONNECTED
                            ? 'var(--accent-red)'
                            : status === ConnectionStatus.CONNECTING
                              ? 'var(--accent-amber)'
                              : undefined,
                          animation: status === ConnectionStatus.CONNECTING
                            ? 'pulse-gentle 1s ease-in-out infinite'
                            : undefined,
                        }}
                        aria-label="Toggle voice connection"
                      >
                        {status === ConnectionStatus.CONNECTED
                          ? <X size={24} />
                          : isMicMuted
                            ? <MicOff size={24} />
                            : <Mic size={24} />}
                      </button>
                    </Tooltip>
                  </div>

                  <div className="dock-divider" />

                  {/* Screen share — desktop only; mobile shows proper error from bottom sheet */}
                  <Tooltip content={isScreenSharing ? 'Stop Screen Share' : 'Screen Share (desktop only)'}>
                    <button
                      onClick={async () => {
                        if (isMobileCoarse) {
                          error('Screen sharing is not supported in mobile browsers. Use Echo on desktop.');
                          return;
                        }
                        if (!serviceRef.current) return;
                        if (isScreenSharing) {
                          serviceRef.current.stopScreenShare();
                          setIsScreenSharing(false);
                        } else {
                          try { await serviceRef.current.startScreenShare(); setIsScreenSharing(true); }
                          catch { error('Could not share screen. Make sure Echo is connected first.'); }
                        }
                      }}
                      className={`icon-btn hidden md:flex ${isScreenSharing ? 'active-pink' : ''}`}
                      aria-label="Screen share"
                    >
                      {isScreenSharing ? <MonitorOff size={17} /> : <Monitor size={17} />}
                    </button>
                  </Tooltip>

                  {/* File upload — desktop only; mobile uses bottom sheet */}
                  <Tooltip content="Upload Knowledge">
                    <button
                      onClick={() => setShowFileUpload(true)}
                      className="icon-btn hidden md:flex"
                      aria-label="Upload file"
                    >
                      <Plus size={17} />
                    </button>
                  </Tooltip>
                </div>
              </>
            )}
          </main>
        </div>
      </KnowledgeDropZone>
    </div>
  );
}

