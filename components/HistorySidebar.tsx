import React, { useState, useMemo } from 'react';
import { X, Search, Trash2, MessageSquare, Calendar, ChevronRight } from 'lucide-react';
import { Conversation } from '../services/conversationService';

interface HistorySidebarProps {
    isOpen: boolean;
    onClose: () => void;
    conversations: Conversation[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
}

export default function HistorySidebar({
    isOpen,
    onClose,
    conversations,
    activeId,
    onSelect,
    onDelete
}: HistorySidebarProps) {
    const [searchTerm, setSearchTerm] = useState('');

    // Filter and Group Conversations
    const { groups: groupedConversations, hasResults } = useMemo(() => {
        const filtered = conversations.filter(c =>
            c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.messages.some(m => m.text.toLowerCase().includes(searchTerm.toLowerCase()))
        );

        const groups: { [key: string]: Conversation[] } = {
            'Today': [],
            'Yesterday': [],
            'Previous 7 Days': [],
            'Older': []
        };

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const yesterday = today - 86400000;
        const lastWeek = today - 7 * 86400000;

        filtered.forEach(c => {
            if (c.updatedAt >= today) {
                groups['Today'].push(c);
            } else if (c.updatedAt >= yesterday) {
                groups['Yesterday'].push(c);
            } else if (c.updatedAt >= lastWeek) {
                groups['Previous 7 Days'].push(c);
            } else {
                groups['Older'].push(c);
            }
        });

        return { groups, hasResults: filtered.length > 0 };
    }, [conversations, searchTerm]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Sidebar Panel */}
            <div className="relative w-full max-w-xs h-full bg-black/90 border-r border-green-500/20 shadow-[0_0_30px_rgba(0,255,0,0.1)] flex flex-col transform transition-transform duration-300 ease-in-out">

                {/* Header */}
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-green-400">
                        <Calendar size={20} />
                        <h2 className="font-mono font-bold text-lg tracking-wide">MEMORY BANK</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-green-400 transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Search memories..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                    {Object.entries(groupedConversations).map(([group, convos]) => (
                        convos.length > 0 && (
                            <div key={group} className="space-y-2">
                                <h3 className="text-xs font-mono text-green-500/70 uppercase tracking-widest pl-2 mb-2">{group}</h3>
                                <div className="space-y-1">
                                    {convos.map(convo => (
                                        <div
                                            key={convo.id}
                                            className={`group relative flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${activeId === convo.id
                                                ? 'bg-green-500/10 border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.1)]'
                                                : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'
                                                }`}
                                            onClick={() => onSelect(convo.id)}
                                        >
                                            <div className="flex-1 min-w-0 pr-8">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <MessageSquare size={14} className={activeId === convo.id ? 'text-green-400' : 'text-gray-500'} />
                                                    <span className={`text-sm font-medium truncate ${activeId === convo.id ? 'text-green-400' : 'text-gray-300'}`}>
                                                        {convo.title}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 font-mono truncate pl-6">
                                                    {new Date(convo.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </div>

                                            {/* Delete Button (visible on hover) */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm('Delete this conversation forever?')) {
                                                        onDelete(convo.id);
                                                    }
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full text-gray-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                                title="Delete conversation"
                                            >
                                                <Trash2 size={16} />
                                            </button>

                                            {activeId === convo.id && (
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none group-hover:opacity-0 delay-75 transition-opacity">
                                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    ))}

                    {!hasResults && (
                        <div className="text-center py-12 text-gray-600 font-mono text-sm">
                            <p>No memories found.</p>
                            {searchTerm && <p className="text-xs mt-2">Try a different search term.</p>}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 text-xs text-gray-600 font-mono text-center">
                    OPENCLAW PROTOCOL ACTIVE
                </div>
            </div>
        </div>
    );
}
