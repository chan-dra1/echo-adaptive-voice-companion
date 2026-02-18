/**
 * Conversation Management Service
 * Handles multiple conversations with fresh or shared knowledge.
 * Each conversation has its own chat history.
 * Shared knowledge persists across all conversations.
 */

export interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ConversationMessage[];
    /** Whether knowledge from this convo should be shared globally */
    shareKnowledge: boolean;
}

export interface ConversationMessage {
    role: 'user' | 'ai';
    text: string;
    timestamp: number;
}

export interface SharedKnowledge {
    facts: string[];
    preferences: string[];
    topics: string[];
}

const CONVERSATIONS_KEY = 'echo_conversations';
const ACTIVE_CONVO_KEY = 'echo_active_conversation';
const SHARED_KNOWLEDGE_KEY = 'echo_shared_knowledge';

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Get all conversations */
export function getConversations(): Conversation[] {
    try {
        return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || '[]');
    } catch {
        return [];
    }
}

/** Save conversations list */
function saveConversations(conversations: Conversation[]): void {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

/** Get the active conversation ID */
export function getActiveConversationId(): string | null {
    return localStorage.getItem(ACTIVE_CONVO_KEY);
}

/** Set the active conversation */
export function setActiveConversationId(id: string): void {
    localStorage.setItem(ACTIVE_CONVO_KEY, id);
}

/** Create a new conversation */
export function createConversation(title?: string): Conversation {
    const convo: Conversation = {
        id: generateId(),
        title: title || `Chat ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        shareKnowledge: true,
    };
    const all = getConversations();
    all.unshift(convo);
    saveConversations(all);
    setActiveConversationId(convo.id);
    return convo;
}

/** Get a specific conversation */
export function getConversation(id: string): Conversation | undefined {
    return getConversations().find(c => c.id === id);
}

/** Add a message to a conversation */
export function addMessageToConversation(
    convoId: string,
    role: 'user' | 'ai',
    text: string
): void {
    const all = getConversations();
    const convo = all.find(c => c.id === convoId);
    if (!convo) return;

    convo.messages.push({ role, text, timestamp: Date.now() });
    convo.updatedAt = Date.now();

    // Auto-title from first user message
    if (!convo.title.startsWith('Chat ') || convo.messages.length > 1) {
        // keep existing title
    } else if (role === 'user' && convo.messages.length === 1) {
        convo.title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    }

    saveConversations(all);
}

/** Delete a conversation */
export function deleteConversation(id: string): void {
    const all = getConversations().filter(c => c.id !== id);
    saveConversations(all);

    if (getActiveConversationId() === id) {
        if (all.length > 0) {
            setActiveConversationId(all[0].id);
        } else {
            localStorage.removeItem(ACTIVE_CONVO_KEY);
        }
    }
}

/** Get shared knowledge */
export function getSharedKnowledge(): SharedKnowledge {
    try {
        return JSON.parse(localStorage.getItem(SHARED_KNOWLEDGE_KEY) || '{"facts":[],"preferences":[],"topics":[]}');
    } catch {
        return { facts: [], preferences: [], topics: [] };
    }
}

/** Add to shared knowledge */
export function addSharedKnowledge(type: 'facts' | 'preferences' | 'topics', value: string): void {
    const knowledge = getSharedKnowledge();
    if (!knowledge[type].includes(value)) {
        knowledge[type].push(value);
        // Keep last 50 of each type
        if (knowledge[type].length > 50) {
            knowledge[type] = knowledge[type].slice(-50);
        }
        localStorage.setItem(SHARED_KNOWLEDGE_KEY, JSON.stringify(knowledge));
    }
}

/** Build a knowledge context string for the AI */
export function buildKnowledgeContext(): string {
    const knowledge = getSharedKnowledge();
    const parts: string[] = [];

    if (knowledge.facts.length > 0) {
        parts.push(`Known facts about the user: ${knowledge.facts.join('; ')}`);
    }
    if (knowledge.preferences.length > 0) {
        parts.push(`User preferences: ${knowledge.preferences.join('; ')}`);
    }
    if (knowledge.topics.length > 0) {
        parts.push(`Topics discussed: ${knowledge.topics.join(', ')}`);
    }

    return parts.length > 0
        ? `\n\n[SHARED KNOWLEDGE FROM PREVIOUS CONVERSATIONS]\n${parts.join('\n')}\n[END SHARED KNOWLEDGE]`
        : '';
}
