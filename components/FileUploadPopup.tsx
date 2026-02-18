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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-[420px] max-w-[95vw] bg-[#0a0f1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-slide-up">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                        <Upload size={18} className="text-cyan-400" />
                        Send to Echo
                    </h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* File Selection Zone */}
                {!selectedFile ? (
                    <div className="p-4 space-y-3">
                        {/* Drag & Drop Zone */}
                        <div
                            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${dragOver
                                ? 'border-cyan-400 bg-cyan-400/10'
                                : 'border-white/20 hover:border-white/40 bg-white/5'
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
                            <Upload size={32} className="mx-auto mb-3 text-gray-400" />
                            <p className="text-gray-300 text-sm font-medium">Drop any file here</p>
                            <p className="text-gray-500 text-xs mt-1">Images, PDFs, Code, Documents, CSV, etc.</p>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => cameraRef.current?.click()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-300 hover:from-cyan-500/30 hover:to-blue-500/30 transition-all text-sm font-medium"
                            >
                                <Camera size={18} />
                                Camera
                            </button>
                            <button
                                onClick={() => fileRef.current?.click()}
                                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-300 hover:from-purple-500/30 hover:to-pink-500/30 transition-all text-sm font-medium"
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
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                            {preview ? (
                                <img src={preview} alt="preview" className="w-14 h-14 rounded-lg object-cover" />
                            ) : (
                                <div className="w-14 h-14 rounded-lg bg-white/10 flex items-center justify-center text-2xl">
                                    {getFileIcon(selectedFile)}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium truncate">{selectedFile.name}</p>
                                <p className="text-gray-400 text-xs">{formatSize(selectedFile.size)} • {selectedFile.type || 'unknown'}</p>
                            </div>
                            <button onClick={() => { setSelectedFile(null); setPreview(null); }}
                                className="text-gray-500 hover:text-red-400 transition-colors p-1">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Analysis Mode */}
                        <div>
                            <p className="text-gray-400 text-xs font-medium mb-2 uppercase tracking-wider">Analysis Mode</p>
                            <div className="flex gap-2">
                                {ANALYSIS_MODES.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => setMode(m.id)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-medium transition-all ${mode === m.id
                                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                                            : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-white'
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
                                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                                rows={3}
                                autoFocus
                            />
                        )}

                        {/* Send Button */}
                        <button
                            onClick={handleSend}
                            disabled={sending || !isConnected}
                            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                        >
                            {sending ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
