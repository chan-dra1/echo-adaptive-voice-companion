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
import { Mic, MicOff, Volume2, VolumeX, X, Terminal, MessageSquare, Database, Monitor, MonitorOff, Lock, Menu, Ghost, Globe, Brain, User, Paperclip, Camera, Plus, Clock, Headphones, Folder } from 'lucide-react';
import { MemoryItem, ChatMessage, ConnectionStatus } from './types';
import { VOICE_OPTIONS, ECHO_SYSTEM_INSTRUCTION } from './constants';
import { useToast } from './hooks/useToast';
import { createConversation, getConversations, getActiveConversationId, setActiveConversationId, buildKnowledgeContext, Conversation, deleteConversation, getConversation, addMessageToConversation } from './services/conversationService';
import StealthPanel from './components/StealthPanel';
import TranslationPanel from './components/TranslationPanel';
import KnowledgeDropZone from './components/KnowledgeDropZone';
import TextChatBar from './components/TextChatBar';
import SettingsVault from './components/SettingsVault';
import AvatarDisplay from './components/AvatarDisplay';
import MatrixRain from './components/MatrixRain';
import MatrixVisualizer from './components/MatrixVisualizer';
import { ghostAgent } from './services/ghostAgentService';
import SkillApprovalModal from './components/SkillApprovalModal';
import UnlockVault from './components/UnlockVault';
import { initVault, hasVault, getVaultMode, isUnlocked } from './services/cryptoService';
import { bootstrapAgent } from './services/agentBootstrap';
import { buildSystemContext } from './services/modelContextBuilder';
import { taskMissionService } from './services/taskMissionService';
import VaultOrganizerPanel from './components/VaultOrganizerPanel';
// MOBILE-AGENT: PWA / mobile-only additive imports.
import InstallPrompt from './components/InstallPrompt';
import { wakeLockService } from './services/wakeLockService';
import { sessionLifecycleService, loadLifecycleConfig } from './services/sessionLifecycleService';
import { setScreenShareActive, SCREEN_READ_EVENT, ScreenReadEventDetail } from './skills/screenIntelSkill';

export default function App() {
  // Check if ANY provider key is available
  const hasAnyApiKey = () => {
    return !!(localStorage.getItem('echo_api_key') || localStorage.getItem('echo_openai_key') || localStorage.getItem('echo_anthropic_key') || localStorage.getItem('echo_groq_key') || localStorage.getItem('echo_nvidia_key') || localStorage.getItem('echo_openrouter_key') || localStorage.getItem('echo_mistral_key') || localStorage.getItem('echo_hf_key'));
  };

  // Vault unlock state — gates the entire UI until crypto is initialized.
  const [vaultReady, setVaultReady] = useState<boolean>(isUnlocked());
  const [needsPassphrasePrompt, setNeedsPassphrasePrompt] = useState<boolean>(false);

  useEffect(() => {
    if (vaultReady) return;
    const needsModal = hasVault() && getVaultMode() === 'passphrase';
    if (needsModal) {
      setNeedsPassphrasePrompt(true);
      return;
    }
    // No vault yet OR auto-mode vault → silently init quick mode.
    initVault({ autoMode: true })
      .then(() => bootstrapAgent())
      .then(() => setVaultReady(true))
      .catch((e) => {
        console.error('[App] vault init failed:', e);
        setNeedsPassphrasePrompt(true);
      });
  }, [vaultReady]);

  const handleVaultUnlocked = useCallback(() => {
    bootstrapAgent()
      .catch(e => console.error('[App] bootstrap failed:', e))
      .finally(() => {
        setVaultReady(true);
        setNeedsPassphrasePrompt(false);
      });
  }, []);

  const [apiKey, setApiKey] = useState((localStorage.getItem('echo_api_key') || '').trim());
  const [hasKey, setHasKey] = useState(hasAnyApiKey());
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
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
  // Conversations loading
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  // MOBILE-AGENT: hands-free + coarse-pointer (mobile) detection.
  const [isHandsFree, setIsHandsFree] = useState<boolean>(() => loadLifecycleConfig().handsFree);
  const [isMobileCoarse, setIsMobileCoarse] = useState<boolean>(() => {
    try { return window.matchMedia?.('(pointer:coarse)').matches ?? false; } catch { return false; }
  });

  const serviceRef = useRef<GeminiLiveService | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const { removeToast, success, error, warning, info } = useToast();
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
    if (!apiKey) {
      error("Please enter your API Key in the Settings Vault to continue");
      setIsSettingsOpen(true);
      return;
    }

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

      const trimmedKey = apiKey.trim();
      const service = new GeminiLiveService(trimmedKey, {
        onConnect: () => {
          setStatus(ConnectionStatus.CONNECTED);
          success("Connected to Echo");
          // MOBILE-AGENT: hold the screen awake during a live session.
          try { wakeLockService.acquire(); } catch { /* ignore */ }
          // Apply current hands-free preference to fresh lifecycle.
          try { sessionLifecycleService.setHandsFree(isHandsFree); } catch { /* ignore */ }
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
          if (errorMessage.includes('API key')) {
            error("Invalid API key. Please check your Gemini API key.");
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
        }
      });

      if (effectiveStealth) {
        success("Ghost Mode Active");
      }
    } catch (err: any) {
      console.error('Connection failed:', err);
      setStatus(ConnectionStatus.ERROR);
      error(`Failed to connect: ${err.message || 'Unknown error'}`);
    }
  }, [apiKey, status, isMicMuted, selectedVoice, isLocalVoiceEnabled, isStealthMode, isHandsFree, isTranslationMode, currentConvoId, success, error, info]);

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
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      } catch { /* ignore */ }
    }
  }, [isHandsFree, info]);

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

  return (

    <div className={`relative w-screen h-screen overflow-hidden bg-black text-[#00ff41] font-mono selection:bg-[#00ff41]/30 flex flex-col${isMobileCoarse ? ' mobile-lite' : ''}`}>
      {needsPassphrasePrompt && <UnlockVault onUnlocked={handleVaultUnlocked} />}
      <SkillApprovalModal />
      {/* MOBILE-AGENT: dismissible install pill (Android BIP + iOS hint) */}
      <InstallPrompt />
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
          {(showChat || showMemory || showVoiceVault || showMobileMenu || showPersonalizedLearning || showGhostMode || showVaultOrganizer) && (
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
              }}
              aria-hidden="true"
            />
          )}

          {/* Settings Vault (Modal) */}
          <SettingsVault
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
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

          {/* Main Agent Area */}
          <main className="flex-1 relative flex flex-col items-center justify-center p-4 pt-safe pb-safe h-full">
            {/* SCREEN_READ_LINK badge (only when screen-share is on AND metadata extraction just succeeded) */}
            {isScreenSharing && screenReadBadge && (
              <div className="absolute top-4 right-4 md:top-10 md:right-10 z-20 pointer-events-none">
                <div className="px-3 py-1 rounded-md bg-black/70 backdrop-blur-md border border-[#00ff41]/40 shadow-[0_0_10px_rgba(0,255,65,0.25)] font-mono text-[10px] md:text-xs text-[#00ff41] tracking-widest uppercase animate-pulse max-w-[260px] truncate">
                  SCREEN_READ_LINK :: {screenReadBadge.source}
                  {screenReadBadge.title ? ` — ${screenReadBadge.title}` : ''}
                </div>
              </div>
            )}
            {/* Top Bar (Status) */}
            <div className="absolute top-4 md:top-10 left-0 right-0 flex justify-center z-10 pointer-events-none pt-safe">
              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="flex items-center gap-2 bg-white/5 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                  <div className={`w-2 h-2 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
                  <span className="text-[10px] md:text-xs font-mono tracking-widest uppercase opacity-70">
                    Echo Neural Link
                  </span>
                </div>
                <span className="text-[10px] md:text-xs tracking-widest uppercase opacity-40">
                  {status === ConnectionStatus.CONNECTED ? (isStealthMode ? 'Ghost Mode Active' : 'System Online') : 'Ready to Connect'}
                </span>
              </div>
            </div>

            {/* The Matrix Cube Display */}
            <div className="my-auto flex-1 flex items-center justify-center w-full max-w-lg aspect-square relative">
              <MatrixVisualizer 
                isActive={status === ConnectionStatus.CONNECTED}
                outputVolume={volumeState.outputVolume}
                inputVolume={volumeState.inputVolume}
              />
              {isCameraActive && (
                 <div className="absolute inset-0 z-10 border-2 border-[#00ff41] rounded-lg overflow-hidden">
                    <AvatarDisplay 
                      state="idle"
                      volume={0}
                      cameraStream={serviceRef.current?.getCameraStream()}
                      avatarUrl={avatarUrl}
                    />
                 </div>
              )}
            </div>

            {/* Floating Action Strip */}
            <div className="absolute bottom-10 md:bottom-24 flex items-center gap-2 md:gap-4 px-4 md:px-8 py-3 md:py-4 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-xl pointer-events-auto shadow-2xl animate-float transition-all duration-500 scale-90 md:scale-100 keyboard-safe-bottom">
               {/* MOBILE-AGENT: Hands-Free toggle (small, subtle, additive) */}
               <Tooltip content={isHandsFree ? 'Hands-Free ON' : 'Hands-Free OFF'}>
                <button
                  onClick={toggleHandsFree}
                  className={`p-2 md:p-3 rounded-full transition-all duration-300 ${isHandsFree ? 'bg-[#00ff41]/20 text-[#00ff41]' : 'hover:bg-white/10 text-white/60'}`}
                  aria-label="Toggle Hands-Free mode"
                  aria-pressed={isHandsFree}
                >
                  <Headphones size={18} />
                </button>
              </Tooltip>

              <div className="w-px h-8 bg-white/10" />

               <Tooltip content="Ghost Mode Settings">
                <button
                  onClick={() => setShowGhostMode(true)}
                  className={`p-2 md:p-3 rounded-full transition-all duration-300 ${isStealthMode ? 'bg-cyan-500/20 text-cyan-400' : 'hover:bg-white/10 text-white/60'}`}
                >
                  <Ghost size={20} />
                </button>
              </Tooltip>

              <div className="w-px h-8 bg-white/10" />

              <Tooltip content={isCameraActive ? "Stop Camera" : "Start Camera Vision"}>
                <button
                  onClick={async () => {
                    if (!serviceRef.current) return;
                    if (isCameraActive) {
                      serviceRef.current.stopCamera();
                      setIsCameraActive(false);
                    } else {
                      try {
                        await serviceRef.current.startCamera();
                        setIsCameraActive(true);
                      } catch (e) {
                        error("Could not access camera");
                      }
                    }
                  }}
                  className={`p-3 rounded-full transition-all duration-300 ${isCameraActive ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-white/10 text-white/60'}`}
                >
                  <Camera size={24} />
                </button>
              </Tooltip>

              <div className="w-px h-8 bg-white/10" />

              {/* Mic Connection Button */}
              <button
                onClick={handleConnect}
                className={`p-6 rounded-full transition-all duration-500 shadow-lg relative group ${
                  status === ConnectionStatus.CONNECTED 
                    ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/30' 
                    : status === ConnectionStatus.CONNECTING 
                      ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                      : 'bg-[#00ff41] text-black hover:bg-[#00ff41]/80 shadow-[0_0_20px_rgba(0,255,65,0.4)]'
                }`}
              >
                {status === ConnectionStatus.CONNECTED ? <X size={28} /> : (isMicMuted ? <MicOff size={28} /> : <Mic size={28} className="group-hover:scale-110 transition-transform" />)}
              </button>

              <div className="w-px h-8 bg-white/10" />

              <Tooltip content="Screen Share">
                <button
                  onClick={async () => {
                    if (!serviceRef.current) return;
                    if (isScreenSharing) {
                      serviceRef.current.stopScreenShare();
                      setIsScreenSharing(false);
                    } else {
                      try {
                        await serviceRef.current.startScreenShare();
                        setIsScreenSharing(true);
                      } catch (e) {
                        error("Could not share screen");
                      }
                    }
                  }}
                  className={`p-3 rounded-full transition-all duration-300 ${isScreenSharing ? 'bg-purple-500/20 text-purple-400' : 'hover:bg-white/10 text-white/60'}`}
                >
                  {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
                </button>
              </Tooltip>
            </div>

            <div className="absolute bottom-4 md:bottom-10 left-4 md:left-10 flex gap-2 md:gap-4 pointer-events-auto pb-safe pl-safe">
               <Tooltip content="Settings & Key Vault">
                <button onClick={() => setIsSettingsOpen(true)} className="p-2 md:p-3 rounded-2xl glass-panel hover:bg-white/10 transition-all">
                  <User size={18} className="text-white/60" />
                </button>
              </Tooltip>
              
              <Tooltip content={isBackendOnline ? "Cloud Agent Online" : "Cloud Agent Offline"}>
                <div className={`p-2 md:p-3 rounded-2xl glass-panel transition-all ${isBackendOnline ? 'border-emerald-500/30' : 'opacity-40'}`}>
                  <Database size={18} className={isBackendOnline ? 'text-emerald-400' : 'text-white/40'} />
                </div>
              </Tooltip>
            </div>

            <div className="absolute bottom-4 md:bottom-10 right-4 md:right-10 flex gap-2 md:gap-4 pointer-events-auto pb-safe pr-safe">
              <Tooltip content="Upload Knowledge">
                <button onClick={() => setShowFileUpload(true)} className="p-2 md:p-3 rounded-2xl glass-panel hover:bg-white/10 transition-all">
                  <Plus size={18} className="text-white/60" />
                </button>
              </Tooltip>
              
              <Tooltip content="Conversation History">
                <button onClick={() => setShowChat(true)} className="p-2 md:p-3 rounded-2xl glass-panel hover:bg-white/10 transition-all">
                  <MessageSquare size={18} className="text-white/60" />
                </button>
              </Tooltip>

              <Tooltip content="Memory Bank">
                <button onClick={() => setShowMemory(true)} className="p-2 md:p-3 rounded-2xl glass-panel hover:bg-white/10 transition-all">
                  <Brain size={18} className="text-white/60" />
                </button>
              </Tooltip>

              <Tooltip content="Vault Organizer">
                <button onClick={() => setShowVaultOrganizer(true)} className="p-2 md:p-3 rounded-2xl glass-panel hover:bg-white/10 transition-all">
                  <Folder size={18} className="text-white/60" />
                </button>
              </Tooltip>
            </div>
          </main>
        </div>
      </KnowledgeDropZone>
    </div>
  );
}

