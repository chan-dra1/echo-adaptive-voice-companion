import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GeminiLiveService } from './services/geminiLiveService';
import { chat, chooseProvider } from './services/llmRouter';
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
import { Mic, MicOff, Volume2, VolumeX, X, Terminal, MessageSquare, Database, Monitor, MonitorOff, Lock, Menu, Ghost, Globe, Brain, User, Paperclip, Camera, Plus, Clock, Headphones, Folder, Ear, Heart, Briefcase, BookOpen, Music, MoreHorizontal } from 'lucide-react';
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
import InterviewPracticeMode from './components/InterviewPracticeMode';
import RAGPanel from './components/RAGPanel';
import FilesPanel from './components/FilesPanel';
import SingPanel from './components/SingPanel';
import { query as ragQuery, formatRagContext } from './services/ragService';
import { setRagContext, clearRagContext } from './services/modelContextBuilder';
import { warmEmbeddingModel } from './services/embeddingService';
// Living HUD additions
import EchoFrame from './components/EchoFrame';
import AmbientField from './components/AmbientField';
import SingularityCore from './components/SingularityCore';
import CommandPalette, { Command } from './components/CommandPalette';
import { startCircadianLoop } from './services/circadianThemeService';
import { BookOpen as IconBookOpen, Fingerprint } from 'lucide-react';
import { enrollBiometric, isBiometricEnrolled, unenrollBiometric } from './services/webauthnService';
import { connectHands, isHandsConnected, setHandsToken, forgetHands, hasHandsToken } from './services/handsBridgeService';
import { startMarketWatchLoop } from './services/marketWatchService';
import { Terminal as IconTerminal } from 'lucide-react';

export default function App() {
  // Check if ANY provider key is available
  const hasAnyApiKey = () => {
    return !!(localStorage.getItem('echo_api_key') || localStorage.getItem('echo_openai_key') || localStorage.getItem('echo_anthropic_key') || localStorage.getItem('echo_groq_key') || localStorage.getItem('echo_nvidia_key') || localStorage.getItem('echo_openrouter_key') || localStorage.getItem('echo_mistral_key') || localStorage.getItem('echo_hf_key'));
  };

  // Vault unlock state — gates the entire UI until crypto is initialized.
  const [vaultReady, setVaultReady] = useState<boolean>(isUnlocked());
  const [needsPassphrasePrompt, setNeedsPassphrasePrompt] = useState<boolean>(false);

  const [apiKey, setApiKey] = useState((localStorage.getItem('echo_api_key') || '').trim());
  const [hasKey, setHasKey] = useState(hasAnyApiKey());
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);

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
  const [showOnboarding, setShowOnboarding] = useState(() => !getCompanionState().onboardingComplete);
  const [showInterview, setShowInterview] = useState(false);
  const [interviewSystemPrompt, setInterviewSystemPrompt] = useState<string | null>(null);
  const [showRAGPanel, setShowRAGPanel] = useState(false);
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  const [showSingPanel, setShowSingPanel] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
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

  const serviceRef = useRef<GeminiLiveService | null>(null);
  const recognitionRef = useRef<any>(null);
  const isBrowserVoiceConnectedRef = useRef(false);
  const speechVolumeIntervalRef = useRef<any>(null);
  const isAIPendingRef = useRef(false);
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
    // Warm up the embedding model in background so RAG is ready
    warmEmbeddingModel();
    // Start circadian theme loop
    const stopCircadian = startCircadianLoop();
    // Try connecting to the Echo Hands daemon (silent no-op if not paired/running)
    connectHands();
    // Price alert loop (read-only market watch)
    const stopMarketWatch = startMarketWatchLoop();
    const handleMarketAlert = (e: any) => {
      if (e.detail?.message) warning(`📈 ${e.detail.message}`);
    };
    window.addEventListener('market:alert', handleMarketAlert);
    const handleHandsStatus = (e: any) => {
      if (e.detail?.connected) success(`Echo Hands connected — workspace: ${e.detail.workspace}`);
      else warning('Echo Hands daemon disconnected.');
    };
    window.addEventListener('hands:status', handleHandsStatus);

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
        setShowRAGPanel(false);
        setShowInterview(false);
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
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
      window.speechSynthesis.cancel();
      if (speechVolumeIntervalRef.current) {
        clearInterval(speechVolumeIntervalRef.current);
      }
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
      // Companion
      window.removeEventListener('echo-deadline-nudge', handleDeadlineNudge);
      window.removeEventListener('hands:status', handleHandsStatus);
      window.removeEventListener('market:alert', handleMarketAlert);
      stopMarketWatch();
      window.removeEventListener('ambient:quiet', handleAmbientQuiet);
      window.removeEventListener('ambient:resumed', handleAmbientResume);
      window.removeEventListener('ambient:silence-checkin', handleSilenceCheckin);
      stopCircadian();
    };
  }, [success, info, warning]);

  // ⌘K / Ctrl+K to open command palette from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isCmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowCmdPalette(p => !p);
      } else if (e.key === '/' && !inField && !showCmdPalette) {
        e.preventDefault();
        setShowCmdPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCmdPalette]);



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
    const persistedVoiceEngine = localStorage.getItem('echo_voice_engine') || 'gemini';

    if (persistedVoiceEngine === 'browser') {
      const activeBrain = chooseProvider();
      
      if (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING) {
        isBrowserVoiceConnectedRef.current = false;
        isAIPendingRef.current = false;
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch { /* ignore */ }
        }
        window.speechSynthesis.cancel();
        if (speechVolumeIntervalRef.current) {
          clearInterval(speechVolumeIntervalRef.current);
        }
        setVolumeState({ inputVolume: 0, outputVolume: 0 });
        setStatus(ConnectionStatus.DISCONNECTED);
        info("Disconnected browser voice link");
        return;
      }

      setStatus(ConnectionStatus.CONNECTING);
      setMicPermissionDenied(false);

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        error("Web Speech API is not supported in this browser. Please use Chrome/Safari or Gemini Cloud engine.");
        setStatus(ConnectionStatus.ERROR);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (micError: any) {
        setMicPermissionDenied(true);
        setStatus(ConnectionStatus.ERROR);
        error("Microphone access error: " + (micError.message || "Unknown error"));
        return;
      }

      isBrowserVoiceConnectedRef.current = true;
      isAIPendingRef.current = false;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setStatus(ConnectionStatus.CONNECTED);
        success("Connected (Browser Speech Link)");
      };

      recognition.onerror = (e: any) => {
        console.error("Speech recognition error:", e.error);
        if (e.error === 'not-allowed') {
          error("Browser Speech: Microphone permission denied or blocked.");
          setStatus(ConnectionStatus.ERROR);
          isBrowserVoiceConnectedRef.current = false;
        } else if (e.error === 'network') {
          error("Browser Speech: Network error occurred.");
          setStatus(ConnectionStatus.ERROR);
          isBrowserVoiceConnectedRef.current = false;
        } else if (e.error !== 'no-speech') {
          error(`Browser Speech error: ${e.error}`);
          setStatus(ConnectionStatus.ERROR);
          isBrowserVoiceConnectedRef.current = false;
        }
      };

      recognition.onend = () => {
        if (isBrowserVoiceConnectedRef.current && !isAIPendingRef.current && !window.speechSynthesis.speaking) {
          setTimeout(() => {
            if (isBrowserVoiceConnectedRef.current && !isAIPendingRef.current && !window.speechSynthesis.speaking) {
              try { recognition.start(); } catch { /* ignore */ }
            }
          }, 150);
        }
      };

      recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (!transcript.trim()) return;

        isAIPendingRef.current = true;

        const userMsg = { id: `local_msg_${Date.now()}`, role: 'user', text: transcript, isFinal: true };
        setChatHistory(prev => [...prev, userMsg]);
        if (currentConvoId) {
          addMessageToConversation(currentConvoId, 'user', transcript);
        }

        setVolumeState({ inputVolume: 0.8, outputVolume: 0 });
        setTimeout(() => setVolumeState({ inputVolume: 0, outputVolume: 0 }), 300);

        try {
          let thinkingPhase = true;
          const pulseInterval = setInterval(() => {
            if (!thinkingPhase) return;
            setVolumeState(prev => ({
              inputVolume: 0,
              outputVolume: 0.2 + Math.random() * 0.2
            }));
          }, 200);

          const formattedHistory = chatHistory.map(m => ({
            role: (m.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: m.text
          }));
          formattedHistory.push({ role: 'user', content: transcript });

          const response = await chat({
            messages: formattedHistory,
            provider: activeBrain
          });

          thinkingPhase = false;
          clearInterval(pulseInterval);
          setVolumeState({ inputVolume: 0, outputVolume: 0 });

          const aiMsg = { id: `local_msg_${Date.now() + 1}`, role: 'ai', text: response.text, isFinal: true };
          setChatHistory(prev => [...prev, aiMsg]);
          if (currentConvoId) {
            addMessageToConversation(currentConvoId, 'ai', response.text);
          }

          const utterance = new SpeechSynthesisUtterance(response.text);
          
          const systemVoices = window.speechSynthesis.getVoices();
          const premiumVoice = systemVoices.find(v => 
            (v.name.includes('Siri') || v.name.includes('Samantha') || v.name.includes('Google') || v.name.includes('Natural')) && 
            v.lang.startsWith('en')
          ) || systemVoices.find(v => v.lang.startsWith('en')) || systemVoices[0];
          
          if (premiumVoice) {
            utterance.voice = premiumVoice;
          }
          
          speechVolumeIntervalRef.current = setInterval(() => {
            setVolumeState({
              inputVolume: 0,
              outputVolume: 0.5 + Math.random() * 0.5
            });
          }, 100);

          utterance.onend = () => {
            isAIPendingRef.current = false;
            if (speechVolumeIntervalRef.current) {
              clearInterval(speechVolumeIntervalRef.current);
            }
            setVolumeState({ inputVolume: 0, outputVolume: 0 });
            if (isBrowserVoiceConnectedRef.current) {
              setTimeout(() => {
                if (isBrowserVoiceConnectedRef.current && !isAIPendingRef.current) {
                  try { recognition.start(); } catch { /* ignore */ }
                }
              }, 150);
            }
          };

          utterance.onerror = () => {
            isAIPendingRef.current = false;
            if (speechVolumeIntervalRef.current) {
              clearInterval(speechVolumeIntervalRef.current);
            }
            setVolumeState({ inputVolume: 0, outputVolume: 0 });
            if (isBrowserVoiceConnectedRef.current) {
              setTimeout(() => {
                if (isBrowserVoiceConnectedRef.current && !isAIPendingRef.current) {
                  try { recognition.start(); } catch { /* ignore */ }
                }
              }, 150);
            }
          };

          window.speechSynthesis.speak(utterance);

        } catch (err: any) {
          isAIPendingRef.current = false;
          error("Error fetching AI response: " + (err.message || err));
          if (isBrowserVoiceConnectedRef.current) {
            setTimeout(() => {
              if (isBrowserVoiceConnectedRef.current && !isAIPendingRef.current) {
                try { recognition.start(); } catch { /* ignore */ }
              }
            }, 150);
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      return;
    }

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
          const isRealKeyError = (errorMessage.includes('API key expired') || errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) ||
                                 (errorMessage.includes('API key') && !errorMessage.includes('not found') && !errorMessage.includes('supported for bidiGenerateContent'));
          if (isRealKeyError) {
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

      // ── RAG: retrieve relevant knowledge for this session ─────────────────
      // We use the companion name + recent chat as the seed query.
      // This runs async before connect so it's ready when the session starts.
      try {
        const seedQuery = `${getCompanionState().userName || 'user'} personal knowledge goals habits`;
        const ragChunks = await ragQuery(seedQuery, { topK: 5, threshold: 0.28 });
        if (ragChunks.length > 0) {
          setRagContext(formatRagContext(ragChunks));
        } else {
          clearRagContext();
        }
      } catch { clearRagContext(); }
      // ─────────────────────────────────────────────────────────────────────

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
  }, [apiKey, status, isMicMuted, selectedVoice, isLocalVoiceEnabled, isStealthMode, isHandsFree, isTranslationMode, interruptMode, currentConvoId, success, error, info, chatHistory]);

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

  // ── EchoHUD (Jarvis talk-back) derived state ──
  const lastAssistant = useMemo(() => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === 'assistant') return chatHistory[i];
    }
    return undefined;
  }, [chatHistory]);
  const hudCaption = lastAssistant?.text || '';
  const hudStreaming = !!lastAssistant && lastAssistant.isFinal === false;

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

  // Build the command list for the palette
  const paletteCommands: Command[] = React.useMemo(() => [
    { id: 'connect', label: status === ConnectionStatus.CONNECTED ? 'Disconnect Echo' : 'Connect to Echo',
      description: 'Toggle the voice neural link', icon: <Mic size={14} />, category: 'Voice',
      color: status === ConnectionStatus.CONNECTED ? 'var(--c-red)' : 'var(--c-green)',
      keywords: ['mic','voice','start','stop','call'], run: () => handleConnect() },
    { id: 'mute', label: isMicMuted ? 'Unmute microphone' : 'Mute microphone',
      description: 'Toggle mic without disconnecting', icon: <MicOff size={14} />, category: 'Voice',
      color: 'var(--c-cyan)', keywords: ['mute','silence'], run: () => toggleMute() },
    { id: 'companion', label: 'Open Companion Panel',
      description: 'Habits, goals, mood, briefing', icon: <Heart size={14} />, category: 'Navigation',
      color: 'var(--c-pink)', keywords: ['habits','goals','mood','briefing'], run: () => setShowCompanionPanel(true) },
    { id: 'memory', label: 'Open Memory Bank',
      description: 'What Echo remembers about you', icon: <Brain size={14} />, category: 'Memory',
      color: 'var(--c-pink)', keywords: ['memories','remember','notes'], run: () => setShowMemory(true) },
    { id: 'rag', label: 'Open Knowledge Vault (RAG)',
      description: 'Upload docs, semantic search', icon: <IconBookOpen size={14} />, category: 'Memory',
      color: 'var(--c-cyan)', keywords: ['rag','knowledge','documents','pdf','search'], run: () => setShowRAGPanel(true) },
    { id: 'files', label: 'Files & Downloads',
      description: 'Download drafts, campaigns & projects — individually or all', icon: <IconTerminal size={14} />, category: 'Navigation',
      color: 'var(--c-cyan)', keywords: ['files','download','export','zip','drafts','campaigns','projects','save'], run: () => setShowFilesPanel(true) },
    { id: 'sing', label: 'Singing Studio',
      description: 'Generate song lyrics and synthesize vocals', icon: <Music size={14} />, category: 'Creative',
      color: 'var(--c-green)', keywords: ['sing','song','music','lyrics','vocal','bark','musicgen'], run: () => setShowSingPanel(true) },
    { id: 'chat', label: 'Open Conversation History',
      description: 'Past text chats', icon: <MessageSquare size={14} />, category: 'Navigation',
      color: 'var(--c-cyan)', keywords: ['history','transcript','chat'], run: () => setShowChat(true) },
    { id: 'new-chat', label: 'Start a new conversation',
      description: 'Clear current session', icon: <Plus size={14} />, category: 'Action',
      color: 'var(--c-green)', keywords: ['fresh','reset','clear'], run: () => handleNewChat() },
    { id: 'interview', label: 'Interview Practice Mode',
      description: 'Echo becomes your interviewer', icon: <Briefcase size={14} />, category: 'Practice',
      color: 'var(--c-amber)', keywords: ['job','practice','behavioral','technical'], run: () => setShowInterview(true) },
    { id: 'vault', label: 'Vault Organizer',
      description: 'Manage encrypted files and notes', icon: <Folder size={14} />, category: 'Navigation',
      color: 'var(--c-cyan)', keywords: ['files','notes','folders'], run: () => setShowVaultOrganizer(true) },
    { id: 'voice-vault', label: 'Voice Vault',
      description: 'Manage voice models', icon: <Lock size={14} />, category: 'System',
      color: 'var(--c-cyan)', keywords: ['voices','speech','tts'], run: () => setShowVoiceVault(true) },
    { id: 'settings', label: 'Settings & Keys',
      description: 'API keys and defaults', icon: <User size={14} />, category: 'System',
      color: 'rgba(255,255,255,0.7)', keywords: ['api','config','preferences'], run: () => setIsSettingsOpen(true) },
    { id: 'camera', label: isCameraActive ? 'Stop camera' : 'Start camera vision',
      description: 'Echo can see what you see', icon: <Camera size={14} />, category: 'Voice',
      color: 'var(--c-green)', keywords: ['vision','webcam','see'], run: async () => {
        if (!serviceRef.current) return;
        if (isCameraActive) { serviceRef.current.stopCamera(); setIsCameraActive(false); }
        else { try { await serviceRef.current.startCamera(); setIsCameraActive(true); } catch { error('Could not access camera'); } }
      }},
    { id: 'screen', label: isScreenSharing ? 'Stop screen share' : 'Share screen with Echo',
      description: 'Echo reads your active window', icon: <Monitor size={14} />, category: 'Voice',
      color: 'var(--c-purple)', keywords: ['screen','share','show'], run: () => handleScreenShare() },
    { id: 'handsfree', label: isHandsFree ? 'Hands-Free OFF' : 'Hands-Free ON',
      description: 'Extended silence tolerance', icon: <Headphones size={14} />, category: 'Voice',
      color: 'var(--c-green)', keywords: ['mobile','background'], run: () => toggleHandsFree() },
    { id: 'ghost', label: 'Open Ghost persona settings',
      description: 'Configure interview persona', icon: <Ghost size={14} />, category: 'Practice',
      color: 'var(--c-cyan)', keywords: ['persona','style'], run: () => setShowGhostMode(true) },
    { id: 'upload', label: 'Upload a file',
      description: 'Send a doc, PDF or code file to Echo', icon: <Plus size={14} />, category: 'Action',
      color: 'var(--c-amber)', keywords: ['file','pdf','document','code'], run: () => setShowFileUpload(true) },
    { id: 'biometric', label: isBiometricEnrolled() ? 'Disable biometric unlock' : 'Enable biometric unlock',
      description: isBiometricEnrolled() ? 'Remove the passkey wrap for this vault' : 'Touch ID / Face ID / Windows Hello via passkey',
      icon: <Fingerprint size={14} />, category: 'System',
      color: 'var(--c-cyan)', keywords: ['touchid','faceid','passkey','webauthn','fingerprint'],
      run: async () => {
        if (isBiometricEnrolled()) {
          unenrollBiometric();
          info('Biometric unlock disabled.');
          return;
        }
        try {
          await enrollBiometric(getCompanionState().userName || 'Echo User');
          success('Biometric unlock enabled — next unlock can use Touch ID / Face ID.');
        } catch (e: any) {
          error(e?.message || 'Biometric enrollment failed.');
        }
      }},
    { id: 'hands', label: isHandsConnected() ? 'Disconnect Echo Hands' : 'Connect Echo Hands',
      description: isHandsConnected() ? 'Drop the local execution daemon link' : 'Pair with the local daemon for shell & file powers',
      icon: <IconTerminal size={14} />, category: 'System',
      color: 'var(--c-green)', keywords: ['daemon','shell','terminal','local','execute','computer'],
      run: () => {
        if (isHandsConnected() || hasHandsToken()) {
          forgetHands();
          info('Echo Hands unpaired. Run the daemon and re-pair anytime.');
          return;
        }
        const token = window.prompt('Paste the Echo Hands token (printed by: cd echo-daemon && npm start)');
        if (token?.trim()) {
          setHandsToken(token);
          info('Pairing with Echo Hands daemon…');
        }
      }},
  ], [status, isMicMuted, isCameraActive, isScreenSharing, isHandsFree, handleConnect, toggleMute, handleNewChat, handleScreenShare, toggleHandsFree, error, info, success]);

  return (

    <div className={`relative w-screen h-screen overflow-hidden bg-black text-[#00ff41] font-mono selection:bg-[#00ff41]/30 flex flex-col${isMobileCoarse ? ' mobile-lite' : ''}`}>
      {/* Living HUD — ambient field behind everything */}
      <AmbientField
        status={status}
        outputVolume={volumeState.outputVolume}
        inputVolume={volumeState.inputVolume}
      />
      {/* Iron-Man-style viewport frame with corner readouts */}
      {vaultReady && !showOnboarding && (
        <EchoFrame status={status} />
      )}
      {/* Global command palette — Cmd/Ctrl+K to open */}
      <CommandPalette
        open={showCmdPalette}
        onClose={() => setShowCmdPalette(false)}
        commands={paletteCommands}
      />

      {needsPassphrasePrompt && <UnlockVault onUnlocked={handleVaultUnlocked} />}
      {/* Onboarding Wizard — shows on first launch after vault is ready */}
      {vaultReady && showOnboarding && (
        <OnboardingWizard
          onComplete={() => setShowOnboarding(false)}
        />
      )}
      {showInterview && (
        <InterviewPracticeMode
          onClose={() => { setShowInterview(false); setInterviewSystemPrompt(null); }}
          onSystemPromptOverride={setInterviewSystemPrompt}
        />
      )}
      {showRAGPanel && (
        <RAGPanel onClose={() => setShowRAGPanel(false)} />
      )}

      {showFilesPanel && (
        <FilesPanel onClose={() => setShowFilesPanel(false)} />
      )}

      {/* Singing Studio — slides in from right */}
      <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[380px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showSingPanel ? 'translate-x-0' : 'translate-x-full'}`}>
        <SingPanel onClose={() => setShowSingPanel(false)} />
      </div>
      <SkillApprovalModal />
      {/* MOBILE-AGENT: dismissible install pill (Android BIP + iOS hint) */}
      <InstallPrompt isConnected={status === ConnectionStatus.CONNECTED} />
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
          {(showChat || showMemory || showVoiceVault || showMobileMenu || showPersonalizedLearning || showGhostMode || showVaultOrganizer || showCompanionPanel) && (
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
                setShowMoreActions(false);
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

          {/* Companion Panel */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[400px] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showCompanionPanel ? 'translate-x-0' : 'translate-x-full'}`}>
            <CompanionPanel onClose={() => setShowCompanionPanel(false)} />
          </div>

          {/* Mobile Menu Drawer (Control Panel) */}
          <div className={`fixed top-0 bottom-0 right-0 z-40 w-full sm:w-[320px] bg-black/90 backdrop-blur-xl border-l border-white/10 p-6 flex flex-col gap-6 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showMobileMenu ? 'translate-x-0' : 'translate-x-full'} pointer-events-auto`}>
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <span className="text-sm tracking-widest uppercase text-[#00ff41]">Echo Control Panel</span>
              <button onClick={() => setShowMobileMenu(false)} className="p-2 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-all">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
              <button
                onClick={() => { setShowMobileMenu(false); setIsSettingsOpen(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-white/5 rounded-xl text-white/70"><User size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Settings & Vault</div>
                  <div className="text-[10px] text-white/40">API Keys and defaults</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowChat(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-white/5 rounded-xl text-white/70"><MessageSquare size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Conversation History</div>
                  <div className="text-[10px] text-white/40">View previous text chats</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowMemory(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-white/5 rounded-xl text-white/70"><Brain size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Memory Bank</div>
                  <div className="text-[10px] text-white/40">What Echo remembers about you</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowVaultOrganizer(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-white/5 rounded-xl text-white/70"><Folder size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Vault Organizer</div>
                  <div className="text-[10px] text-white/40">Manage files and notes</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowCompanionPanel(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-pink-500/10 rounded-xl text-pink-400"><Heart size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Companion panel</div>
                  <div className="text-[10px] text-white/40">Habits, goals & briefing</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowRAGPanel(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-cyan-500/10 rounded-xl text-cyan-400"><BookOpen size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Knowledge Vault</div>
                  <div className="text-[10px] text-white/40">RAG — upload docs, search memory</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowFileUpload(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-white/5 rounded-xl text-white/70"><Plus size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Upload Knowledge</div>
                  <div className="text-[10px] text-white/40">Send document, pdf or code</div>
                </div>
              </button>

              <button
                onClick={() => { setShowMobileMenu(false); setShowSingPanel(true); }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-[#00ff41]/10 hover:border-[#00ff41]/30 transition-all text-left text-white"
              >
                <div className="p-3 bg-[#00ff41]/10 rounded-xl text-[#00ff41]"><Music size={20} /></div>
                <div>
                  <div className="text-sm font-semibold">Singing Studio</div>
                  <div className="text-[10px] text-white/40">Generate lyrics &amp; synthesize vocals</div>
                </div>
              </button>
            </div>
            
            <div className="border-t border-white/10 pt-4 flex items-center justify-between text-[11px] text-white/40">
              <span>Cloud Agent: <span className={isBackendOnline ? "text-emerald-400" : "text-rose-400"}>{isBackendOnline ? "Online" : "Offline"}</span></span>
              <span>v1.2.0</span>
            </div>
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
            {/* Top Bar (Status / Mobile Menu Button) */}
            <div className="absolute top-4 md:top-10 left-0 right-0 flex items-center justify-between px-6 z-10 pointer-events-none pt-safe">
              {/* Left spacer on mobile, to balance the menu button */}
              <div className="w-10 h-10 md:hidden" />

              <div className="flex flex-col items-center gap-1 md:gap-2">
                <div className="flex items-center gap-2 bg-white/5 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 pointer-events-auto">
                  <div className={`w-2 h-2 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
                  <span className="text-[10px] md:text-xs font-mono tracking-widest uppercase opacity-70">
                    Echo Neural Link
                  </span>
                </div>
                <span className="text-[10px] md:text-xs tracking-widest uppercase opacity-40">
                  {deferHint && status === ConnectionStatus.CONNECTED
                    ? 'Listening — holding (ambient audio)'
                    : status === ConnectionStatus.CONNECTED
                      ? (isStealthMode ? 'Ghost Mode Active' : 'System Online')
                      : 'Ready to Connect'}
                </span>
              </div>

              {/* Hamburger menu button for small screens */}
              <div className="pointer-events-auto md:hidden">
                <button
                  onClick={() => setShowMobileMenu(true)}
                  className="p-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-white/80"
                  aria-label="Open control panel"
                >
                  <Menu size={20} />
                </button>
              </div>
            </div>

            {/* ECHO VOID — Singularity Core (replaces MatrixVisualizer + EchoHUD) */}
            <SingularityCore
              connected={status === ConnectionStatus.CONNECTED}
              inputVolume={volumeState.inputVolume}
              outputVolume={volumeState.outputVolume}
              captionText={hudCaption}
              streaming={hudStreaming}
              awaitingReply={isThinking}
            />
            {/* Camera PiP overlay (when camera is active) */}
            {isCameraActive && (
              <div className="absolute top-16 right-4 z-30 w-32 h-32 border border-[#00ff41]/40 rounded-lg overflow-hidden shadow-lg shadow-[#00ff41]/10">
                <AvatarDisplay
                  state="idle"
                  volume={0}
                  cameraStream={serviceRef.current?.getCameraStream()}
                  avatarUrl={avatarUrl}
                />
              </div>
            )}

            {/* ── Floating Action Dock ── */}
            <div className="absolute bottom-6 md:bottom-10 z-20 pointer-events-auto flex flex-col items-center gap-3 keyboard-safe-bottom">

              {/* Secondary action grid (slides up when More is open) */}
              <div className={`transition-all duration-300 ${showMoreActions ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}>
                <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-black/85 border border-white/10 backdrop-blur-xl shadow-2xl">

                  {/* Hands-free */}
                  <button
                    onClick={toggleHandsFree}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${isHandsFree ? 'border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    <Headphones size={20} />
                    <span className="text-[9px] sc-hud-font tracking-wide">Hands-free</span>
                  </button>

                  {/* Interrupt mode */}
                  <button
                    onClick={toggleInterruptMode}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${interruptMode === 'eager' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : interruptMode === 'polite' ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    <Ear size={20} />
                    <span className="text-[9px] sc-hud-font tracking-wide capitalize">{interruptMode}</span>
                  </button>

                  {/* Ghost mode */}
                  <button
                    onClick={() => { setShowMoreActions(false); setShowGhostMode(true); }}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${isStealthMode ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    <Ghost size={20} />
                    <span className="text-[9px] sc-hud-font tracking-wide">Ghost</span>
                  </button>

                  {/* Camera */}
                  <button
                    onClick={async () => {
                      if (!serviceRef.current) return;
                      if (isCameraActive) { serviceRef.current.stopCamera(); setIsCameraActive(false); }
                      else { try { await serviceRef.current.startCamera(); setIsCameraActive(true); } catch { error('Could not access camera'); } }
                    }}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${isCameraActive ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    <Camera size={20} />
                    <span className="text-[9px] sc-hud-font tracking-wide">Camera</span>
                  </button>

                  {/* Screen share */}
                  <button
                    onClick={async () => {
                      if (!serviceRef.current) return;
                      if (isScreenSharing) { serviceRef.current.stopScreenShare(); setIsScreenSharing(false); }
                      else { try { await serviceRef.current.startScreenShare(); setIsScreenSharing(true); } catch { error('Could not share screen'); } }
                    }}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${isScreenSharing ? 'border-purple-500/40 bg-purple-500/10 text-purple-400' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
                    <span className="text-[9px] sc-hud-font tracking-wide">{isScreenSharing ? 'Stop' : 'Screen'}</span>
                  </button>

                  {/* Singing studio */}
                  <button
                    onClick={() => { setShowMoreActions(false); setShowSingPanel(p => !p); }}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all ${showSingPanel ? 'border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]' : 'border-white/8 hover:bg-white/8 text-white/55'}`}
                  >
                    <Music size={20} />
                    <span className="text-[9px] sc-hud-font tracking-wide">Sing</span>
                  </button>

                </div>
              </div>

              {/* Primary dock */}
              <div className="flex items-center gap-5 px-7 py-4 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">

                {/* Interrupt / listen mode toggle */}
                <button
                  onClick={toggleInterruptMode}
                  className={`p-3 rounded-full transition-all ${interruptMode === 'eager' ? 'bg-amber-500/20 text-amber-300' : interruptMode === 'polite' ? 'bg-blue-500/15 text-blue-300' : 'hover:bg-white/10 text-white/50'}`}
                  aria-label={`Interrupt mode: ${interruptMode}`}
                >
                  <Ear size={22} />
                </button>

                {/* Main mic / connect button */}
                <button
                  onClick={handleConnect}
                  className={`p-5 rounded-full transition-all duration-500 shadow-lg group ${
                    status === ConnectionStatus.CONNECTED
                      ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/30'
                      : status === ConnectionStatus.CONNECTING
                        ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                        : 'bg-[#00ff41] text-black hover:bg-[#00ff41]/80 shadow-[0_0_24px_rgba(0,255,65,0.45)]'
                  }`}
                >
                  {status === ConnectionStatus.CONNECTED
                    ? <X size={26} />
                    : isMicMuted
                      ? <MicOff size={26} />
                      : <Mic size={26} className="group-hover:scale-110 transition-transform" />}
                </button>

                {/* More — opens secondary grid */}
                <button
                  onClick={() => setShowMoreActions(v => !v)}
                  className={`p-3 rounded-full transition-all ${showMoreActions ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/50'}`}
                  aria-label="More controls"
                >
                  <MoreHorizontal size={22} />
                </button>

              </div>
            </div>

            {/* ── Desktop feature footer — fixed, labeled, z-30 ── */}
            <div className="hidden md:flex fixed bottom-0 left-0 right-0 z-30 pointer-events-auto items-end justify-between px-6 pb-3 pt-1">

              {/* Left: system */}
              <div className="flex items-end gap-2">
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl bg-white/4 border border-white/8 hover:bg-white/10 hover:border-white/20 transition-all group"
                >
                  <User size={16} className="text-white/50 group-hover:text-white/80 transition-colors" />
                  <span className="text-[9px] text-white/35 group-hover:text-white/60 sc-hud-font tracking-wide">Settings</span>
                </button>

                <div className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl border transition-all ${isBackendOnline ? 'bg-emerald-500/6 border-emerald-500/20' : 'bg-white/4 border-white/8 opacity-40'}`}>
                  <Database size={16} className={isBackendOnline ? 'text-emerald-400' : 'text-white/40'} />
                  <span className="text-[9px] sc-hud-font tracking-wide" style={{ color: isBackendOnline ? 'rgba(52,211,153,0.6)' : 'rgba(255,255,255,0.3)' }}>
                    {isBackendOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              {/* Right: feature panels */}
              <div className="flex items-end gap-1.5">
                {([
                  { icon: <Plus size={16} />,         label: 'Upload',    color: 'text-white/50',        action: () => setShowFileUpload(true) },
                  { icon: <MessageSquare size={16} />, label: 'Chats',     color: 'text-white/50',        action: () => setShowChat(true) },
                  { icon: <Brain size={16} />,         label: 'Memory',    color: 'text-white/50',        action: () => setShowMemory(true) },
                  { icon: <Folder size={16} />,        label: 'Vault',     color: 'text-white/50',        action: () => setShowVaultOrganizer(true) },
                  { icon: <Heart size={16} />,         label: 'Life',      color: 'text-pink-400/70',     action: () => setShowCompanionPanel(true) },
                  { icon: <Briefcase size={16} />,     label: 'Practice',  color: 'text-amber-400/70',    action: () => setShowInterview(true) },
                  { icon: <BookOpen size={16} />,      label: 'Knowledge', color: 'text-cyan-400/70',     action: () => setShowRAGPanel(true) },
                  { icon: <Music size={16} />,         label: 'Sing',      color: 'text-[#00ff41]/70',    action: () => setShowSingPanel(p => !p) },
                ] as { icon: React.ReactNode; label: string; color: string; action: () => void }[]).map(({ icon, label, color, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl bg-white/4 border border-white/8 hover:bg-white/10 hover:border-white/20 transition-all group"
                  >
                    <span className={`${color} group-hover:opacity-100 transition-opacity`}>{icon}</span>
                    <span className="text-[9px] text-white/35 group-hover:text-white/60 sc-hud-font tracking-wide">{label}</span>
                  </button>
                ))}
              </div>

            </div>
          </main>
        </div>
      </KnowledgeDropZone>
    </div>
  );
}

