import React, { useState, useEffect } from 'react';
import { X, Lock, Key, Check, AlertTriangle, Github, Globe, Cpu } from 'lucide-react';
import Button from './Button';
import { useToast } from '../hooks/useToast';

interface SettingsVaultProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SettingsVault({ isOpen, onClose }: SettingsVaultProps) {
    const { success, error } = useToast();
    const [githubToken, setGithubToken] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [geminiApiKey, setGeminiApiKey] = useState('');

    // Load existing keys (masked)
    useEffect(() => {
        if (isOpen) {
            setGithubToken(localStorage.getItem('echo_github_token') || '');
            setSerpApiKey(localStorage.getItem('VITE_SERP_API_KEY') || ''); // Note: usually env, but supporting override
            setGeminiApiKey(localStorage.getItem('echo_api_key') || '');
        }
    }, [isOpen]);

    const handleSave = () => {
        try {
            if (githubToken) localStorage.setItem('echo_github_token', githubToken);
            if (serpApiKey) localStorage.setItem('VITE_SERP_API_KEY', serpApiKey); // This won't override vite env but can be used as fallback
            if (geminiApiKey) localStorage.setItem('echo_api_key', geminiApiKey);

            success('Settings saved securely');
            onClose();
            // Reload page to apply new API keys if necessary? Or just let services read from localStorage.
            // For Gemini API Key, App.tsx reads it on mount.
            window.location.reload();
        } catch (e) {
            error('Failed to save settings');
        }
    };

    const handleClear = (key: string) => {
        localStorage.removeItem(key);
        if (key === 'echo_github_token') setGithubToken('');
        if (key === 'VITE_SERP_API_KEY') setSerpApiKey('');
        if (key === 'echo_api_key') setGeminiApiKey('');
        success('Key cleared');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-md bg-black/90 border border-green-500/30 rounded-2xl shadow-[0_0_50px_rgba(0,255,0,0.1)] p-6 overflow-hidden">
                {/* Matrix Grid Background */}
                <div className="absolute inset-0 grid grid-cols-[repeat(20,minmax(0,1fr))] opacity-5 pointer-events-none">
                    {Array.from({ length: 400 }).map((_, i) => (
                        <div key={i} className="border-[0.5px] border-green-500/20" />
                    ))}
                </div>

                {/* Header */}
                <div className="relative flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3 text-green-400">
                        <div className="p-2 bg-green-500/10 rounded-lg">
                            <Lock size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold font-mono tracking-wider">SETTINGS VAULT</h2>
                            <p className="text-xs text-green-500/60 font-mono">SECURE KEY STORAGE</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="relative space-y-6">

                    <div className="bg-green-900/10 border border-green-500/20 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-green-400 mb-2 font-mono text-sm">
                            <AlertTriangle size={14} />
                            <span>SECURITY NOTICE</span>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">
                            Keys are stored locally in your browser's <code className="text-green-500/80">localStorage</code>.
                            They are never sent to any server other than the respective API providers.
                        </p>
                    </div>

                    <div className="space-y-4">
                        {/* GitHub Token */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                                <Github size={16} />
                                <span>GitHub Personal Access Token</span>
                            </label>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={githubToken}
                                    onChange={(e) => setGithubToken(e.target.value)}
                                    placeholder="ghp_xxxxxxxxxxxx"
                                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-10 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono"
                                />
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-green-400 transition-colors" size={16} />
                                {githubToken && (
                                    <button
                                        onClick={() => handleClear('echo_github_token')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Gemini API Key */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                                <Cpu size={16} />
                                <span>Gemini API Key</span>
                            </label>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={geminiApiKey}
                                    onChange={(e) => setGeminiApiKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-10 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono"
                                />
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-green-400 transition-colors" size={16} />
                                {geminiApiKey && (
                                    <button
                                        onClick={() => handleClear('echo_api_key')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* SerpAPI Key */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                                <Globe size={16} />
                                <span>SerpAPI Key (Web Search)</span>
                            </label>
                            <div className="relative group">
                                <input
                                    type="password"
                                    value={serpApiKey}
                                    onChange={(e) => setSerpApiKey(e.target.value)}
                                    placeholder="Enter key to enable real-time search..."
                                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-10 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono"
                                />
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-green-400 transition-colors" size={16} />
                                {serpApiKey && (
                                    <button
                                        onClick={() => handleClear('VITE_SERP_API_KEY')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button
                            onClick={handleSave}
                            variant="primary"
                            className="w-full justify-center group"
                        >
                            <Check className="mr-2 group-hover:scale-110 transition-transform" size={18} />
                            Save Securely & Reload
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
