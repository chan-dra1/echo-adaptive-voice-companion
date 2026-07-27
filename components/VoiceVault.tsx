import React, { useState, useRef, useCallback } from 'react';
import { Mic, Save, Trash2, Lock, Play, Square, AlertCircle, X } from 'lucide-react';
import { AudioStorageService } from '../services/audioStorageService';
import Tooltip from './Tooltip';
import Button from './Button';

// Pre-defined sentences for phonetic balance
const TRAINING_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "I am Echo, your adaptive AI companion.",
    "Please call Stella. Ask her to bring these things with her from the store.",
    "Six spoons of fresh snow peas, five thick slabs of blue cheese.",
    "We also need a small plastic snake and a big toy frog for the kids.",
    "She can scoop these things into three red bags, and we will go meet her Wednesday.",
    "Technology is best when it brings people together.",
    "The view from the lighthouse was breathtakingly beautiful at sunset.",
    "Artificial intelligence is transforming the way we work and live.",
    "Voice cloning technology requires high-quality audio samples."
];

interface VoiceVaultProps {
    onClose: () => void;
    isLocalVoiceEnabled: boolean;
    onToggleLocalVoice: (enabled: boolean) => void;
}

export const VoiceVault: React.FC<VoiceVaultProps> = ({ onClose, isLocalVoiceEnabled, onToggleLocalVoice }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [recordings, setRecordings] = useState<any[]>([]);
    const [password, setPassword] = useState('');
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [storageService, setStorageService] = useState<AudioStorageService | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize Storage Service on Unlock
    const handleUnlock = () => {
        if (password.length < 12) {
            setError('Password must be at least 12 characters for security');
            return;
        }
        const service = new AudioStorageService(password);
        setStorageService(service);
        setPassword(''); // Clear password from state immediately for security
        setIsUnlocked(true);
        loadRecordings(service);
    };

    const loadRecordings = async (service: AudioStorageService) => {
        const data = await service.getAllRecordings();
        setRecordings(data);
    };

    const startRecording = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.onerror = (e) => {
                console.error('MediaRecorder error:', e);
                setError('Recording failed. Please try again.');
                setIsRecording(false);
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err: any) {
            console.error("Error accessing mic:", err);
            if (err.name === 'NotAllowedError') {
                setError('Microphone permission denied. Please allow access in your browser settings.');
            } else if (err.name === 'NotFoundError') {
                setError('No microphone found. Please connect a microphone.');
            } else {
                setError(`Microphone error: ${err.message || 'Unknown error'}`);
            }
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    const saveRecording = useCallback(async () => {
        if (!storageService || !audioBlob) return;

        try {
            setError(null);
            await storageService.saveRecording(
                crypto.randomUUID(),
                audioBlob,
                TRAINING_SENTENCES[currentStep]
            );

            await loadRecordings(storageService);
            setAudioBlob(null);
            setAudioUrl(null);

            // Auto-advance
            if (currentStep < TRAINING_SENTENCES.length - 1) {
                setCurrentStep(prev => prev + 1);
            }
        } catch (err: any) {
            console.error('Failed to save recording:', err);
            setError(`Failed to save recording: ${err.message || 'Unknown error'}`);
        }
    }, [storageService, audioBlob, currentStep]);

    const deleteRecording = useCallback(async (id: string) => {
        if (!storageService) return;
        if (window.confirm('Are you sure you want to delete this recording?')) {
            try {
                await storageService.deleteRecording(id);
                await loadRecordings(storageService);
            } catch (err: any) {
                console.error('Failed to delete recording:', err);
                setError(`Failed to delete: ${err.message || 'Unknown error'}`);
            }
        }
    }, [storageService]);

    const playAudio = useCallback(() => {
        if (audioUrl && !isPlaying) {
            const audio = new Audio(audioUrl);
            audioRef.current = audio;
            audio.onended = () => setIsPlaying(false);
            audio.onerror = () => {
                setError('Failed to play audio.');
                setIsPlaying(false);
            };
            audio.play();
            setIsPlaying(true);
        }
    }, [audioUrl, isPlaying]);

    const discardRecording = useCallback(() => {
        setAudioBlob(null);
        setAudioUrl(null);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        setIsPlaying(false);
    }, []);

    // Login Screen
    if (!isUnlocked) {
        return (
            <div className="term-window flex flex-col items-center justify-center p-8 h-full space-y-6 text-center font-mono text-[var(--accent-green)] animate-phosphor-in">
                <div className="w-16 h-16 bg-[rgba(0,255,65,0.1)] rounded-full flex items-center justify-center border border-[var(--border-green)]">
                    <Lock size={32} className="text-[var(--accent-green)]" />
                </div>
                <h2 className="text-2xl font-hud font-bold tracking-widest uppercase text-glow-green">Vault_Locked</h2>
                <p className="text-[var(--accent-green)]/60 text-xs font-mono">ENTER_ENCRYPTION_KEY_FOR_VOICE_CACHE</p>
                <input
                    type="password"
                    placeholder="KEY_REQUIRED"
                    className="bg-[var(--bg-base)] border border-[var(--border-green)] rounded-lg px-4 py-3 text-[var(--accent-green)] text-center focus:outline-none focus:border-[var(--accent-green)] font-mono"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                />
                <button
                    onClick={handleUnlock}
                    disabled={password.length < 4}
                    className="btn-term solid disabled:opacity-20"
                >
                    ACCESS_VAULT
                </button>
                <button
                  onClick={onClose}
                  className="mt-4 text-[var(--accent-green)]/40 hover:text-[var(--accent-green)] text-xs font-mono underline uppercase"
                >
                  Return_To_Terminal
                </button>
            </div>
        );
    }

    return (
        <div className="term-window h-full flex flex-col p-6 space-y-6 overflow-y-auto animate-phosphor-in" role="region" aria-label="Voice vault">
            <div className="term-titlebar !justify-between -mx-6 -mt-6 mb-2">
                <div className="flex items-center gap-2">
                    <span className="term-dots" />
                    <Lock size={14} className="text-[var(--accent-green)]" aria-hidden="true" />
                    <span className="font-hud text-xs tracking-widest uppercase text-[var(--accent-green)]">VOICE.VAULT</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-hud text-[var(--accent-green)]/60 bg-[rgba(0,255,65,0.08)] px-2 py-1 rounded border border-[var(--border-green)] uppercase tracking-widest" role="status">
                        ENCRYPTED_LOCAL
                    </span>
                    <button
                      onClick={onClose}
                      className="p-2 hover:bg-[rgba(0,255,65,0.1)] rounded text-[var(--accent-green)] border border-[var(--border-green)]"
                      aria-label="Close"
                    >
                      <X size={20} />
                    </button>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-[rgba(255,59,92,0.1)] border border-[var(--accent-red)]/30 rounded-lg p-3 flex items-start gap-2" role="alert">
                    <AlertCircle size={16} className="text-[var(--accent-red)] flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-sm text-[var(--accent-red)]">{error}</p>
                    </div>
                    <button
                        onClick={() => setError(null)}
                        className="text-[var(--accent-red)] hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-red)] rounded"
                        aria-label="Dismiss error"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Mode Toggle */}
            <div className="bg-[rgba(0,255,65,0.04)] p-4 rounded-xl border border-[var(--border-dim)] flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-sm font-hud font-semibold uppercase tracking-wide text-[var(--text-primary)]">Voice Cloning Mode</h3>
                    <p className="text-xs text-[var(--text-tertiary)]">Use local Python server for TTS</p>
                </div>
                <button
                    onClick={() => onToggleLocalVoice(!isLocalVoiceEnabled)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${isLocalVoiceEnabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--surface-3)]'}`}
                >
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-[var(--bg-base)] rounded-full transition-transform ${isLocalVoiceEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>

            {/* Progress */}
            <div className="w-full bg-[rgba(0,255,65,0.06)] rounded-full h-2">
                <div
                    className="bg-[var(--accent-green)] h-2 rounded-full transition-all duration-500"
                    style={{ width: `${(recordings.length / TRAINING_SENTENCES.length) * 100}%` }}
                />
            </div>
            <p className="text-xs text-center font-mono text-[var(--text-tertiary)]">
                {recordings.length} / {TRAINING_SENTENCES.length} Samples Collected
            </p>

            {/* Recording Area */}
            {currentStep < TRAINING_SENTENCES.length ? (
                <div className="bg-[rgba(0,255,65,0.04)] p-6 rounded-2xl border border-[var(--border-dim)] space-y-6">
                    <div>
                        <p className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] text-center mb-2">
                            Sentence {currentStep + 1} of {TRAINING_SENTENCES.length}
                        </p>
                        <p className="text-lg font-medium text-center text-[var(--text-primary)]/90 leading-relaxed">
                            "{TRAINING_SENTENCES[currentStep]}"
                        </p>
                    </div>

                    <div className="flex justify-center gap-4" role="group" aria-label="Recording controls">
                        {!isRecording && !audioBlob && (
                            <Tooltip content="Start recording">
                                <button
                                    onClick={startRecording}
                                    className="w-16 h-16 rounded-full bg-[rgba(255,59,92,0.15)] text-[var(--accent-red)] flex items-center justify-center hover:bg-[rgba(255,59,92,0.25)] transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-red)]/50"
                                    aria-label="Start recording"
                                >
                                    <Mic size={32} />
                                </button>
                            </Tooltip>
                        )}

                        {isRecording && (
                            <Tooltip content="Stop recording">
                                <button
                                    onClick={stopRecording}
                                    className="w-16 h-16 rounded-full bg-[var(--accent-red)] text-[var(--bg-base)] flex items-center justify-center animate-pulse focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-red)]"
                                    aria-label="Stop recording"
                                >
                                    <Square size={32} fill="currentColor" />
                                </button>
                            </Tooltip>
                        )}

                        {audioBlob && (
                            <>
                                <Tooltip content={isPlaying ? "Playing..." : "Play recording"}>
                                    <button
                                        onClick={playAudio}
                                        disabled={isPlaying}
                                        className="w-16 h-16 rounded-full bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] flex items-center justify-center hover:bg-[rgba(0,255,65,0.25)] disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-green)]/50"
                                        aria-label="Play recording"
                                    >
                                        <Play size={32} fill="currentColor" />
                                    </button>
                                </Tooltip>

                                <Tooltip content="Save recording">
                                    <button
                                        onClick={saveRecording}
                                        className="w-16 h-16 rounded-full bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] flex items-center justify-center hover:bg-[rgba(0,255,65,0.25)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-green)]/50"
                                        aria-label="Save recording"
                                    >
                                        <Save size={32} />
                                    </button>
                                </Tooltip>

                                <Tooltip content="Discard recording">
                                    <button
                                        onClick={discardRecording}
                                        className="w-16 h-16 rounded-full bg-[rgba(214,255,224,0.08)] text-[var(--text-tertiary)] flex items-center justify-center hover:bg-[rgba(214,255,224,0.14)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--text-tertiary)]/50"
                                        aria-label="Discard recording"
                                    >
                                        <Trash2 size={24} />
                                    </button>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>
            ) : (
                <div className="p-6 bg-[rgba(0,255,65,0.08)] border border-[var(--border-green)] rounded-2xl text-center" role="status">
                    <h3 className="text-[var(--accent-green)] font-hud font-bold uppercase tracking-wide mb-2">Collection Complete!</h3>
                    <p className="text-sm text-[var(--text-tertiary)]">You have enough samples to train your voice model.</p>
                </div>
            )}

            {/* List of Recordings */}
            <div className="space-y-2">
                <h3 className="text-sm font-hud font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Saved Samples</h3>
                {recordings.length > 0 ? (
                    <ul className="space-y-2" role="list">
                        {recordings.map((rec: any, i: number) => (
                            <li key={rec.id} className="flex justify-between items-center bg-[rgba(0,255,65,0.03)] p-3 rounded-lg border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.06)] transition-colors">
                                <span className="text-sm text-[var(--text-secondary)] truncate max-w-[200px]">
                                    {i + 1}. {rec.transcript.substring(0, 30)}...
                                </span>
                                <Tooltip content="Delete recording">
                                    <button
                                        onClick={() => deleteRecording(rec.id)}
                                        className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-red)]"
                                        aria-label={`Delete recording ${i + 1}`}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </Tooltip>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-[var(--text-tertiary)] italic text-center py-4" role="status">
                        No recordings yet. Start recording above to create your first sample.
                    </p>
                )}
            </div>
        </div>
    );
};

export default React.memo(VoiceVault);
