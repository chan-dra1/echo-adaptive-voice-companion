import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiLiveService } from './services/geminiLiveService';
import { getMemories } from './services/memoryService';
import { getHistory, saveMessage } from './services/chatHistoryService'; // Deprecated, will remove usage below
import { proactiveAI } from './services/proactiveAIService';
import { personalizedLearning } from './services/personalizedLearningService';
import MatrixRain from './components/MatrixRain';
import MatrixVisualizer from './components/MatrixVisualizer';
import MemoryPanel from './components/MemoryPanel';
import ChatPanel from './components/ChatPanel';
import { VoiceVault } from './components/VoiceVault';
import PersonalizedLearningPanel from './components/PersonalizedLearningPanel';
import InterviewMode from './components/InterviewMode';
import FileUploadPopup from './components/FileUploadPopup';
import ToastContainer from './components/ToastContainer';
import Tooltip from './components/Tooltip';
import Button from './components/Button';
import { Mic, MicOff, Volume2, VolumeX, X, Terminal, MessageSquare, Database, Monitor, MonitorOff, Lock, Menu, Ghost, Globe, Brain, User, Paperclip, Camera, Plus, Clock } from 'lucide-react';
import { MemoryItem, ChatMessage, ConnectionStatus } from './types';
import { VOICE_OPTIONS, ECHO_SYSTEM_INSTRUCTION } from './constants';
import { useToast } from './hooks/useToast';
import { createConversation, getConversations, getActiveConversationId, setActiveConversationId, buildKnowledgeContext, Conversation, deleteConversation, getConversation, addMessageToConversation } from './services/conversationService';
import StealthPanel from './components/StealthPanel';
import TranslationPanel from './components/TranslationPanel';
import HistorySidebar from './components/HistorySidebar';
import SettingsVault from './components/SettingsVault';
import RecentChatsWidget from './components/RecentChatsWidget';
import KnowledgeDropZone from './components/KnowledgeDropZone';

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('echo_api_key') || process.env.API_KEY || '');
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
  const [showInterviewMode, setShowInterviewMode] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isLocalVoiceEnabled, setIsLocalVoiceEnabled] = useState(false);
  const [isStealthMode, setIsStealthMode] = useState(false);
  const [isTranslationMode, setIsTranslationMode] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Conversations loading
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

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

    window.addEventListener('echo-reminder', handleReminder);

    return () => {
      proactiveAI.setActive(false);
      window.removeEventListener('echo-reminder', handleReminder);
    };
  }, [success]);

  // Keyboard navigation: ESC to close sidebars and modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVoiceVault) {
          setShowVoiceVault(false);
        } else if (showPersonalizedLearning) {
          setShowPersonalizedLearning(false);
        } else if (showInterviewMode) {
          setShowInterviewMode(false);
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
  }, [showVoiceVault, showChat, showMemory, showMobileMenu, showPersonalizedLearning, showInterviewMode]);

  const handleConnect = useCallback(async () => {
    if (!apiKey) {
      error("Please enter a valid API Key to continue");
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

      const service = new GeminiLiveService(apiKey, {
        onConnect: () => {
          setStatus(ConnectionStatus.CONNECTED);
          success("Connected to Echo");
        },
        onDisconnect: () => {
          setStatus(ConnectionStatus.DISCONNECTED);
          setIsScreenSharing(false);
          info("Disconnected from Echo");
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

      let systemInstruction = ECHO_SYSTEM_INSTRUCTION;
      // Inject shared knowledge from previous conversations
      const knowledgeCtx = buildKnowledgeContext();
      if (knowledgeCtx) {
        systemInstruction += knowledgeCtx;
      }
      if (isTranslationMode) {
        systemInstruction += "\n\n[SYSTEM] TRANSLATION MODE ACTIVE. You are now a Real-Time Interpreter. Translate everything to English.";
      }

      await service.connect({
        voiceName: selectedVoice,
        useLocalVoice: isLocalVoiceEnabled || isStealthMode,
        systemInstruction,
        speechConfig: {
          preRollMs: 300,
          silenceThreshold: 0.015
        }
      });

      if (isStealthMode) {
        await service.startInterviewMode();
        success("Ghost Mode Active: Listening to System Audio");
      }
    } catch (err: any) {
      console.error('Connection failed:', err);
      setStatus(ConnectionStatus.ERROR);
      error(`Failed to connect: ${err.message || 'Unknown error'}`);
    }
  }, [apiKey, status, isMicMuted, selectedVoice, isLocalVoiceEnabled, isStealthMode, success, error, info]);

  const toggleMute = () => {
    const newState = !isMicMuted;
    setIsMicMuted(newState);
    if (serviceRef.current) {
      serviceRef.current.setMuted(newState);
    }
  };

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
    setIsHistoryOpen(false);
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
  };

  return (
    <div className={`relative w-screen h-screen overflow-hidden bg-black text-white font-sans selection:bg-white/20 flex flex-col ${getThemeGradient()}`}>
      <KnowledgeDropZone onFileDrop={(file) => {
        setFileToUpload(file);
        setShowFileUpload(true);
      }}>
        {/* Matrix Rain Background */}
        <MatrixRain
          outputVolume={volumeState.outputVolume}
          inputVolume={volumeState.inputVolume}
          isActive={status === ConnectionStatus.CONNECTED}
        />

        {/* Background Ambience (Green Glow) */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[120px] mix-blend-screen transition-all duration-1000 ${status === ConnectionStatus.CONNECTED ? 'bg-green-500/8 opacity-100' : 'bg-transparent opacity-0'
            }`} />
          <div className={`absolute top-0 right-0 w-[500px] h-[500px] bg-green-500/5 rounded-full blur-[100px] mix-blend-screen transition-all duration-1000 ${status === ConnectionStatus.CONNECTED ? 'opacity-100' : 'opacity-0'
            }`} />
        </div>

        <div className="flex-1 flex flex-col relative z-20 pointer-events-none w-full">
          {/* Main Application Area */}

          {/* Backdrop Overlay for Sidebars */}
          {(showChat || showMemory || showVoiceVault || showMobileMenu || showPersonalizedLearning || showInterviewMode) && (
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 transition-opacity duration-300"
              onClick={() => {
                setShowChat(false);
                setShowMemory(false);
                setShowVoiceVault(false);
                setShowMobileMenu(false);
                setShowPersonalizedLearning(false);
                setShowInterviewMode(false);
              }}
              aria-hidden="true"
            />
          )}

          {/* Stealth Panel (Interview Mode) */}
          {isStealthMode && (
            <StealthPanel
              history={chatHistory}
              isThinking={isThinking}
              onClose={() => setIsStealthMode(false)}
            />
          )}

          {/* History Sidebar */}
          <HistorySidebar
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            conversations={conversations}
            activeId={currentConvoId}
            onSelect={handleSelectConversation}
            onDelete={handleDeleteConversation}
          />

          <SettingsVault
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          {/* Translation Panel (Left Side) */}
          {isTranslationMode && (
            <div className="absolute left-4 top-24 bottom-24 w-80 z-30 pointer-events-auto">
              <TranslationPanel
                history={chatHistory}
                isThinking={isThinking}
                onClose={() => setIsTranslationMode(false)}
              />
            </div>
          )}

          {/* File Upload Popup */}
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

          {/* Personalized Learning Panel */}
          {showPersonalizedLearning && (
            <div className="absolute top-0 bottom-0 right-0 z-40 w-full sm:w-[450px] transition-transform duration-500">
              <div className="h-full w-full bg-echo-dark/95 backdrop-blur-xl border-l border-white/5 shadow-2xl">
                <PersonalizedLearningPanel
                  onClose={() => setShowPersonalizedLearning(false)}
                  onApplyPersonalization={(prompt) => {
                    success("Personalized AI activated! Reconnect to apply changes.");
                  }}
                />
              </div>
            </div>
          )}

          {/* Interview Mode Panel */}
          {showInterviewMode && (
            <div className="absolute top-0 bottom-0 right-0 z-40 w-full sm:w-[450px] transition-transform duration-500">
              <div className="h-full w-full bg-echo-dark/95 backdrop-blur-xl border-l border-white/5 shadow-2xl">
                <InterviewMode
                  onClose={() => setShowInterviewMode(false)}
                  onActivate={(config) => {
                    setShowInterviewMode(false);
                    success("Interview mode configured! Enable 'Stealth Mode' to start.");
                  }}
                />
              </div>
            </div>
          )}

          {/* Left Panel: Chat History */}
          <div className={`absolute top-0 bottom-0 left-0 z-30 w-full sm:w-[400px] transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${showChat ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="h-full w-full bg-echo-dark/80 backdrop-blur-xl border-r border-white/5 shadow-2xl">
              <ChatPanel
                history={chatHistory}
                onHistoryClear={handleHistoryClear}
                isThinking={isThinking}
                onClose={() => setShowChat(false)}
              />
            </div>
          </div>

          {/* Voice Vault Sidebar (Left, layered over/under chat) */}
          <div className={`absolute top-0 bottom-0 left-0 z-40 w-full sm:w-[400px] transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) pointer-events-auto ${showVoiceVault ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="h-full w-full bg-echo-dark/95 backdrop-blur-xl border-r border-white/5 shadow-2xl">
              <VoiceVault
                onClose={() => setShowVoiceVault(false)}
                isLocalVoiceEnabled={isLocalVoiceEnabled}
                onToggleLocalVoice={setIsLocalVoiceEnabled}
              />
              <button
                onClick={() => setShowVoiceVault(false)}
                className="absolute top-4 right-4 text-gray-500 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col relative z-10 w-full h-full">

            {/* Header */}
            <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-30 pointer-events-none">
              <div className="flex items-center gap-4 pointer-events-auto">
                {/* Mobile Menu Toggle */}
                <Tooltip content="Menu">
                  <button
                    onClick={() => setShowMobileMenu(!showMobileMenu)}
                    className={`sm:hidden p-3 rounded-xl transition-all duration-300 border backdrop-blur-md ${showMobileMenu ? 'bg-white/10 border-white/20 text-white' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Toggle mobile menu"
                    aria-expanded={showMobileMenu}
                  >
                    <Menu size={20} />
                  </button>
                </Tooltip>

                {/* New Chat */}
                <Tooltip content="New Chat (Fresh Knowledge)">
                  <button
                    onClick={handleNewChat}
                    className="p-3 rounded-xl transition-all duration-300 border backdrop-blur-md bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20 hover:text-green-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    aria-label="Start new conversation"
                  >
                    <Plus size={20} />
                  </button>
                </Tooltip>

                {/* History Toggle */}
                <Tooltip content="History / Memory Bank">
                  <button
                    onClick={() => {
                      loadConversations();
                      setIsHistoryOpen(true);
                    }}
                    className="p-3 rounded-xl transition-all duration-300 border backdrop-blur-md bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                    aria-label="Toggle history"
                  >
                    <Clock size={20} />
                  </button>
                </Tooltip>

                {/* Settings Vault Toggle */}
                <Tooltip content="Settings / Keys">
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-3 rounded-xl transition-all duration-300 border backdrop-blur-md bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary"
                    aria-label="Open settings"
                  >
                    <User size={20} />
                  </button>
                </Tooltip>

                {/* Voice Vault Toggle */}
                <Tooltip content="Voice Vault">
                  <button
                    onClick={() => {
                      setShowVoiceVault(!showVoiceVault);
                      setShowChat(false);
                      setShowMobileMenu(false);
                    }}
                    className={`p-3 rounded-xl transition-all duration-300 border backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary ${showVoiceVault ? 'bg-echo-primary text-white shadow-lg shadow-echo-primary/20' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Open voice vault"
                    aria-pressed={showVoiceVault}
                  >
                    <Lock size={20} />
                  </button>
                </Tooltip>

                {/* Chat Toggle */}
                <Tooltip content="Chat History">
                  <button
                    onClick={() => {
                      setShowChat(!showChat);
                      setShowVoiceVault(false);
                      setShowMobileMenu(false);
                    }}
                    className={`p-3 rounded-xl transition-all duration-300 border backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary ${showChat ? 'bg-white/10 border-white/20 text-white shadow-lg shadow-blue-500/10' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Open chat history"
                    aria-pressed={showChat}
                  >
                    <MessageSquare size={20} />
                  </button>
                </Tooltip>

                {/* Personalized Learning Toggle */}
                <Tooltip content="Personalized AI">
                  <button
                    onClick={() => {
                      setShowPersonalizedLearning(!showPersonalizedLearning);
                      setShowInterviewMode(false);
                      setShowMobileMenu(false);
                    }}
                    className={`p-3 rounded-xl transition-all duration-300 border backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary ${showPersonalizedLearning ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 shadow-lg shadow-purple-500/10' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Open personalized AI panel"
                    aria-pressed={showPersonalizedLearning}
                  >
                    <Brain size={20} />
                  </button>
                </Tooltip>

                {/* Ghost Mode Toggle */}
                <Tooltip content="Ghost Mode">
                  <button
                    onClick={() => {
                      setShowInterviewMode(!showInterviewMode);
                      setShowPersonalizedLearning(false);
                      setShowMobileMenu(false);
                    }}
                    className={`p-3 rounded-xl transition-all duration-300 border backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary ${showInterviewMode ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Open interview mode settings"
                    aria-pressed={showInterviewMode}
                  >
                    <User size={20} />
                  </button>
                </Tooltip>

                <div className="hidden sm:flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-tr from-green-500/20 to-emerald-400/20 backdrop-blur rounded-xl flex items-center justify-center border border-green-500/20 shadow-lg shadow-green-500/10" aria-hidden="true">
                    <Terminal size={20} className="text-green-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-white/90">ECHO</h1>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' :
                          status === ConnectionStatus.CONNECTING ? 'bg-amber-400 animate-pulse' :
                            'bg-slate-500'
                          }`}
                        role="status"
                        aria-label={status === ConnectionStatus.CONNECTED ? 'Connected' : status === ConnectionStatus.CONNECTING ? 'Connecting' : 'Disconnected'}
                      />
                      <span className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
                        {status === ConnectionStatus.CONNECTED ? 'System Online' :
                          status === ConnectionStatus.CONNECTING ? 'Connecting...' : 'Standby'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 pointer-events-auto">
                {/* Voice Select */}
                <div className="relative group hidden sm:block">
                  <label htmlFor="voice-select" className="sr-only">Select voice</label>
                  <select
                    id="voice-select"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="appearance-none bg-black/20 border border-white/5 text-sm text-gray-200 py-2.5 pl-4 pr-10 rounded-xl hover:bg-white/5 focus:outline-none focus-visible:border-echo-primary/50 focus-visible:ring-2 focus-visible:ring-echo-primary/50 transition-all cursor-pointer backdrop-blur-md"
                    disabled={status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING}
                    aria-label="Voice selection"
                  >
                    {VOICE_OPTIONS.map(voice => (
                      <option key={voice.id} value={voice.id} className="bg-echo-surface text-white">
                        Voice: {voice.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-500 group-hover:text-gray-300 transition-colors" aria-hidden="true">
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path></svg>
                  </div>
                </div>

                {/* Memory Toggle */}
                <Tooltip content="Memory Panel">
                  <button
                    onClick={() => {
                      setShowMemory(!showMemory);
                      setShowMobileMenu(false);
                    }}
                    className={`p-3 rounded-xl transition-all duration-300 border backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary ${showMemory ? 'bg-white/10 border-white/20 text-white shadow-lg shadow-purple-500/10' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5 hover:text-white'}`}
                    aria-label="Open memory panel"
                    aria-pressed={showMemory}
                  >
                    <Database size={20} />
                  </button>
                </Tooltip>
              </div>
            </header>

            {/* Mobile Menu */}
            <div className={`sm:hidden absolute top-20 left-4 z-40 w-64 transition-all duration-300 pointer-events-auto ${showMobileMenu ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
              <div className="bg-echo-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
                <h3 className="text-sm font-semibold text-white mb-3">Settings</h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="mobile-voice-select" className="block text-xs text-gray-400 mb-1">Voice</label>
                    <select
                      id="mobile-voice-select"
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="w-full bg-black/20 border border-white/10 text-sm text-gray-200 py-2 px-3 rounded-lg focus:outline-none focus-visible:border-echo-primary focus-visible:ring-1 focus-visible:ring-echo-primary"
                      disabled={status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING}
                    >
                      {VOICE_OPTIONS.map(voice => (
                        <option key={voice.id} value={voice.id} className="bg-echo-surface text-white">
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-xs text-gray-500">Status: <span className="text-gray-300">{status}</span></p>
                  </div>
                </div>
              </div>
            </div>

            {/* Visualizer Container */}
            <div className="flex-1 relative flex items-center justify-center">
              <div
                className="w-full h-full max-w-4xl max-h-[60vh] relative z-10 pointer-events-none flex items-center justify-center"
                role="img"
                aria-label={
                  status === ConnectionStatus.CONNECTED
                    ? volumeState.outputVolume > 5
                      ? "Echo is speaking"
                      : volumeState.inputVolume > 5
                        ? "You are speaking"
                        : "Listening for voice input"
                    : "Audio visualizer - not connected"
                }
              >
                <MatrixVisualizer
                  inputVolume={volumeState.inputVolume}
                  outputVolume={volumeState.outputVolume}
                  isActive={status === ConnectionStatus.CONNECTED}
                />
                {/* Recent Chats Overlay (Empty State) */}
                {status !== ConnectionStatus.CONNECTED && chatHistory.length === 0 && (
                  <RecentChatsWidget
                    conversations={conversations}
                    onSelect={handleSelectConversation}
                    onViewAll={() => setIsHistoryOpen(true)}
                  />
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-6 z-20 pointer-events-auto">

              <div className="flex items-center gap-2 sm:gap-4 p-2 sm:p-4 rounded-3xl bg-black/20 backdrop-blur-xl border border-white/5 shadow-2xl" role="group" aria-label="Audio controls">
                {/* Mic Toggle */}
                <div className="relative">
                  {status === ConnectionStatus.CONNECTED && !isMicMuted && (
                    <div
                      className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-echo-dark transition-all duration-300 ${isUserSpeaking ? 'bg-emerald-400 shadow-[0_0_10px_#34d399] scale-110' : 'bg-slate-600'}`}
                      aria-hidden="true"
                    />
                  )}
                  <Tooltip content={isMicMuted ? "Unmute Microphone (currently muted)" : "Mute Microphone"}>
                    <button
                      onClick={toggleMute}
                      disabled={status !== ConnectionStatus.CONNECTED}
                      className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${isMicMuted
                        ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/50 focus-visible:ring-red-500'
                        : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white ring-1 ring-white/10 focus-visible:ring-white'
                        } ${status !== ConnectionStatus.CONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
                      aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                      aria-pressed={isMicMuted}
                    >
                      {isMicMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
                    </button>
                  </Tooltip>
                </div>

                {/* Main Connect Button */}
                <Tooltip content={status === ConnectionStatus.CONNECTED ? "Disconnect from Echo" : "Connect to Echo"}>
                  <button
                    onClick={handleConnect}
                    disabled={status === ConnectionStatus.CONNECTING}
                    className={`group relative flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 rounded-full transition-all duration-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${status === ConnectionStatus.CONNECTED
                      ? 'bg-red-500 hover:bg-red-600 shadow-[0_0_30px_rgba(239,68,68,0.3)] focus-visible:ring-red-500'
                      : 'bg-white hover:bg-blue-50 shadow-[0_0_30px_rgba(255,255,255,0.1)] focus-visible:ring-white'
                      } ${status === ConnectionStatus.CONNECTING ? 'cursor-wait' : ''}`}
                    aria-label={status === ConnectionStatus.CONNECTED ? "Disconnect" : status === ConnectionStatus.CONNECTING ? "Connecting..." : "Connect"}
                    aria-busy={status === ConnectionStatus.CONNECTING}
                  >
                    {status === ConnectionStatus.CONNECTED ? (
                      <X className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                    ) : (
                      <div className="relative">
                        {status === ConnectionStatus.CONNECTING && (
                          <div className="absolute inset-0 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" aria-hidden="true" />
                        )}
                        <Mic className={`w-6 h-6 sm:w-8 sm:h-8 text-echo-dark transition-transform duration-300 ${status !== ConnectionStatus.CONNECTING ? 'group-hover:scale-110' : 'opacity-0'}`} />
                      </div>
                    )}
                  </button>
                </Tooltip>

                {/* Screen Share Toggle */}
                <Tooltip content={isScreenSharing ? "Stop screen sharing" : "Share your screen"}>
                  <button
                    onClick={handleScreenShare}
                    disabled={status !== ConnectionStatus.CONNECTED}
                    className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${isScreenSharing
                      ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)] focus-visible:ring-blue-500'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white ring-1 ring-white/10 focus-visible:ring-white'
                      } ${status !== ConnectionStatus.CONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label={isScreenSharing ? "Stop screen sharing" : "Start screen sharing"}
                    aria-pressed={isScreenSharing}
                  >
                    {isScreenSharing ? <MonitorOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Monitor className="w-5 h-5 sm:w-6 sm:h-6" />}
                  </button>
                </Tooltip>

                {/* Image Capture / Upload */}
                <Tooltip content="Analyze Image">
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={status !== ConnectionStatus.CONNECTED}
                    className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark bg-gradient-to-br from-green-500/10 to-emerald-500/10 text-green-400 hover:from-green-500/20 hover:to-emerald-500/20 ring-1 ring-green-500/30 hover:ring-green-500/50 focus-visible:ring-green-500 ${status !== ConnectionStatus.CONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Analyze image"
                  >
                    <Camera className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </Tooltip>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !serviceRef.current) return;
                    try {
                      await serviceRef.current.sendFile(file, 'Analyze this image. Identify objects, text, landmarks, products, plants, animals — anything visible. Be detailed and fast.');
                      success('📷 Photo captured — analyzing...');
                    } catch {
                      error('Failed to capture photo');
                    }
                    e.target.value = '';
                  }}
                />

                {/* File Upload */}
                <Tooltip content="Send File or Image to Echo">
                  <button
                    onClick={() => setShowFileUpload(true)}
                    disabled={status !== ConnectionStatus.CONNECTED}
                    className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${showFileUpload
                      ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white ring-1 ring-white/10'
                      } focus-visible:ring-white ${status !== ConnectionStatus.CONNECTED ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Upload file or capture image"
                  >
                    <Paperclip className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </Tooltip>

                {/* Stealth Mode Toggle */}
                <Tooltip content={isStealthMode ? "Disable Interview Mode" : "Enable Interview Mode (Stealth)"}>
                  <button
                    onClick={() => {
                      if (status === ConnectionStatus.CONNECTED) {
                        info("Please disconnect to change modes");
                        return;
                      }
                      setIsStealthMode(!isStealthMode);
                    }}
                    className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${isStealthMode
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)] focus-visible:ring-emerald-500'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white ring-1 ring-white/10 focus-visible:ring-white'
                      }`}
                    aria-label={isStealthMode ? "Disable Stealth Mode" : "Enable Stealth Mode"}
                    aria-pressed={isStealthMode}
                  >
                    <Ghost className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </Tooltip>

                {/* Translation Mode Toggle */}
                <Tooltip content={isTranslationMode ? "Disable Translation" : "Enable Translation Mode"}>
                  <button
                    onClick={() => {
                      if (status === ConnectionStatus.CONNECTED) {
                        info("Please disconnect to change modes");
                        return;
                      }
                      setIsTranslationMode(!isTranslationMode);
                    }}
                    className={`p-3 sm:p-4 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-echo-dark ${isTranslationMode
                      ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)] focus-visible:ring-blue-500'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white ring-1 ring-white/10 focus-visible:ring-white'
                      }`}
                    aria-label={isTranslationMode ? "Disable Translation Mode" : "Enable Translation Mode"}
                    aria-pressed={isTranslationMode}
                  >
                    <Globe className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </Tooltip>
              </div>

              <div className="text-center">
                <p
                  className="text-[10px] text-gray-400 font-mono tracking-[0.2em] uppercase opacity-70"
                  role="status"
                  aria-live="polite"
                >
                  {status === ConnectionStatus.CONNECTED
                    ? (isMicMuted ? 'Microphone Muted' : (isUserSpeaking ? 'Receiving Audio Input...' : 'Waiting for voice...'))
                    : status === ConnectionStatus.ERROR
                      ? 'Connection Error - Check Notifications'
                      : status === ConnectionStatus.CONNECTING
                        ? 'Connecting...'
                        : 'Press Center Button to Initialize'}
                </p>
                {/* Retry button for errors */}
                {status === ConnectionStatus.ERROR && micPermissionDenied && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleConnect}
                    className="mt-3"
                    aria-label="Retry connection"
                  >
                    Retry Connection
                  </Button>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Right Panel: Memory Sidebar */}
        <div className={`absolute top-0 bottom-0 right-0 z-30 w-full sm:w-[350px] transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) pointer-events-auto ${showMemory ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="h-full w-full bg-echo-dark/80 backdrop-blur-xl border-l border-white/5 shadow-2xl">
            <MemoryPanel memories={memories} onUpdate={handleManualMemoryUpdate} onClose={() => setShowMemory(false)} />
          </div>
        </div>

        {/* API Key Modal */}
        {
          (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') && (
            <div
              className="absolute inset-0 z-50 flex items-center justify-center bg-echo-dark/90 backdrop-blur-xl p-4"
              role="dialog"
              aria-labelledby="api-key-modal-title"
              aria-describedby="api-key-modal-description"
              aria-modal="true"
            >
              <div className="w-full max-w-md bg-echo-surface border border-white/10 rounded-2xl p-8 shadow-2xl">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="w-16 h-16 bg-echo-primary/20 rounded-full flex items-center justify-center mb-2" aria-hidden="true">
                    <Terminal size={32} className="text-echo-primary" />
                  </div>
                  <h2 id="api-key-modal-title" className="text-2xl font-bold text-white">Welcome to Echo</h2>
                  <p id="api-key-modal-description" className="text-gray-400 mb-4">To get started, please enter your Gemini API Key.</p>

                  <label htmlFor="api-key-input" className="sr-only">Gemini API Key</label>
                  <input
                    id="api-key-input"
                    type="password"
                    placeholder="Enter Gemini API Key"
                    autoFocus
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus-visible:border-echo-primary focus-visible:ring-2 focus-visible:ring-echo-primary transition-all"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val.length > 20) {
                          setApiKey(val);
                          localStorage.setItem('echo_api_key', val);
                          success("API key saved successfully");
                        } else {
                          error("API key appears too short. Please enter a valid key.");
                        }
                      }
                    }}
                    aria-required="true"
                    aria-describedby="api-key-help"
                  />
                  <p id="api-key-help" className="text-xs text-gray-500 mt-2">
                    Get your key at{' '}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-echo-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-echo-primary rounded"
                    >
                      Google AI Studio
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )
        }
      </KnowledgeDropZone>
    </div>
  );
}
