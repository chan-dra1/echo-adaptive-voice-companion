import React, { useRef, useState } from 'react';
import { Camera, Upload, X, FileText, Image, Search, Sparkles } from 'lucide-react';

interface FileUploadPopupProps {
    onSendFile: (file: File, instruction?: string) => Promise<void>;
    onClose: () => void;
    isConnected: boolean;
    initialFile?: File | null;
}

const ANALYSIS_MODES = [
    { id: 'quick', label: 'Quick Scan', icon: Search, prompt: 'Give a brief summary in 2-3 sentences. Be fast.' },
    { id: 'deep', label: 'Deep Review', icon: Sparkles, prompt: 'Do a thorough, deep review and research of this content. Analyze every detail — structure, data, patterns, issues, and insights. Be comprehensive.' },
    { id: 'custom', label: 'Custom', icon: FileText, prompt: '' },
];

export default function FileUploadPopup({ onSendFile, onClose, isConnected, initialFile }: FileUploadPopupProps) {
    const cameraRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
    const [preview, setPreview] = useState<string | null>(null);

    React.useEffect(() => {
        if (initialFile) {
            handleFileSelect(initialFile);
        }
    }, [initialFile]);
    const [mode, setMode] = useState('quick');
    const [customPrompt, setCustomPrompt] = useState('');
    const [sending, setSending] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const handleFileSelect = (file: File) => {
        setSelectedFile(file);
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => setPreview(reader.result as string);
            reader.readAsDataURL(file);
        } else {
            setPreview(null);
        }
    };

    const handleSend = async () => {
        if (!selectedFile) return;
        setSending(true);
        try {
            const instruction = mode === 'custom' ? customPrompt : ANALYSIS_MODES.find(m => m.id === mode)?.prompt;
            await onSendFile(selectedFile, instruction);
            onClose();
        } catch {
            setSending(false);
        }
    };

    const getFileIcon = (file: File) => {
        if (file.type.startsWith('image/')) return '📷';
        if (file.type === 'application/pdf') return '📄';
        if (file.type.includes('spreadsheet') || file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) return '📊';
        if (file.type.includes('word') || file.name.endsWith('.doc') || file.name.endsWith('.docx')) return '📝';
        return '📎';
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-[420px] max-w-[95vw] term-window animate-phosphor-in overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-dim)]">
                    <h3 className="font-hud text-[var(--text-primary)] font-semibold text-sm uppercase tracking-widest flex items-center gap-2">
                        <Upload size={16} className="text-[var(--accent-green)]" />
                        SEND TO ECHO
                    </h3>
                    <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* File Selection Zone */}
                {!selectedFile ? (
                    <div className="p-4 space-y-3">
                        {/* Drag & Drop Zone */}
                        <div
                            className={`border-2 border-dashed rounded p-8 text-center transition-all cursor-pointer ${dragOver
                                ? 'border-[var(--accent-green)] bg-[rgba(0,255,65,0.1)] shadow-[0_0_16px_rgba(0,255,65,0.25)]'
                                : 'border-[var(--border-green)] hover:border-[var(--accent-green)] bg-[rgba(0,255,65,0.03)]'
                                }`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setDragOver(false);
                                const file = e.dataTransfer.files[0];
                                if (file) handleFileSelect(file);
                            }}
                            onClick={() => fileRef.current?.click()}
                        >
                            <Upload size={32} className="mx-auto mb-3 text-[var(--accent-green)]" />
                            <p className="text-[var(--text-secondary)] text-sm font-term uppercase tracking-widest">DROP FILES TO INJECT</p>
                            <p className="text-[var(--text-tertiary)] text-xs mt-1">Images, PDFs, Code, Documents, CSV, etc.</p>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => cameraRef.current?.click()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded bg-[rgba(0,255,65,0.08)] border border-[var(--border-green)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.15)] transition-all text-xs font-term uppercase tracking-widest"
                            >
                                <Camera size={18} />
                                Camera
                            </button>
                            <button
                                onClick={() => fileRef.current?.click()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded bg-[rgba(43,217,107,0.08)] border border-[rgba(43,217,107,0.3)] text-[var(--accent-purple)] hover:bg-[rgba(43,217,107,0.15)] transition-all text-xs font-term uppercase tracking-widest"
                            >
                                <FileText size={18} />
                                Browse Files
                            </button>
                        </div>

                        {/* Hidden Inputs */}
                        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }} />
                        <input ref={fileRef} type="file" accept="*/*" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }} />
                    </div>
                ) : (
                    /* File Preview + Analysis Mode */
                    <div className="p-4 space-y-3">
                        {/* Preview */}
                        <div className="flex items-center gap-3 p-3 rounded bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)]">
                            {preview ? (
                                <img src={preview} alt="preview" className="w-14 h-14 rounded object-cover" />
                            ) : (
                                <div className="w-14 h-14 rounded bg-[rgba(0,255,65,0.08)] flex items-center justify-center text-2xl">
                                    {getFileIcon(selectedFile)}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-[var(--text-primary)] text-sm font-medium truncate">{selectedFile.name}</p>
                                <p className="text-[var(--text-tertiary)] text-xs">{formatSize(selectedFile.size)} • {selectedFile.type || 'unknown'}</p>
                            </div>
                            <button onClick={() => { setSelectedFile(null); setPreview(null); }}
                                className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] transition-colors p-1">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Analysis Mode */}
                        <div>
                            <p className="text-[var(--text-tertiary)] text-xs font-term mb-2 uppercase tracking-widest">Analysis Mode</p>
                            <div className="flex gap-2">
                                {ANALYSIS_MODES.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => setMode(m.id)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded text-xs font-term uppercase tracking-wider transition-all ${mode === m.id
                                            ? 'bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] border border-[var(--border-green)] shadow-[0_0_10px_rgba(0,255,65,0.15)]'
                                            : 'bg-[rgba(0,255,65,0.03)] text-[var(--text-tertiary)] border border-[var(--border-dim)] hover:bg-[rgba(0,255,65,0.08)] hover:text-[var(--text-primary)]'
                                            }`}
                                    >
                                        <m.icon size={14} />
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Custom Prompt */}
                        {mode === 'custom' && (
                            <textarea
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                placeholder="e.g., 'Deep review this resume and find weaknesses' or 'Extract all numbers from this document'"
                                className="w-full p-3 rounded bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] text-[var(--text-primary)] text-sm placeholder-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--border-green)] focus:ring-1 focus:ring-[var(--accent-green)]/30"
                                rows={3}
                                autoFocus
                            />
                        )}

                        {/* Send Button */}
                        <button
                            onClick={handleSend}
                            disabled={sending || !isConnected}
                            className="w-full py-3 rounded bg-[var(--accent-green)] text-black font-term uppercase tracking-widest text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_16px_rgba(0,255,65,0.3)]"
                        >
                            {sending ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    Analyze {mode === 'deep' ? '(Deep Review)' : mode === 'custom' ? '(Custom)' : '(Quick)'}
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
