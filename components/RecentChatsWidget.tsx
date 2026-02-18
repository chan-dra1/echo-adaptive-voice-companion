import React from 'react';
import { Clock, MessageSquare, ArrowRight } from 'lucide-react';
import { Conversation } from '../services/conversationService';

interface RecentChatsWidgetProps {
    conversations: Conversation[];
    onSelect: (id: string) => void;
    onViewAll: () => void;
}

export default function RecentChatsWidget({ conversations, onSelect, onViewAll }: RecentChatsWidgetProps) {
    // Get top 3 recent conversations
    const recent = conversations.slice(0, 3);

    if (recent.length === 0) return null;

    return (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 w-full max-w-md px-6 animate-fade-in-up z-30 pointer-events-auto">
            <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-xl">
                <div className="flex items-center justify-between mb-3 px-2">
                    <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <Clock size={12} />
                        Recent Memories
                    </h3>
                    <button
                        onClick={onViewAll}
                        className="text-xs text-echo-primary hover:text-white transition-colors flex items-center gap-1"
                    >
                        View All <ArrowRight size={12} />
                    </button>
                </div>

                <div className="space-y-2">
                    {recent.map(chat => (
                        <button
                            key={chat.id}
                            onClick={() => onSelect(chat.id)}
                            className="w-full text-left p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 transition-all group flex items-start gap-3"
                        >
                            <div className="mt-1 p-1.5 rounded-lg bg-echo-primary/10 text-echo-primary group-hover:bg-echo-primary/20 transition-colors">
                                <MessageSquare size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h4 className="text-sm font-medium text-gray-200 group-hover:text-white truncate transition-colors">
                                    {chat.title}
                                </h4>
                                <p className="text-xs text-gray-500 truncate mt-0.5">
                                    {new Date(chat.updatedAt).toLocaleDateString()} • {new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
