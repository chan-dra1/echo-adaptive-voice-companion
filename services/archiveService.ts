import { ChatTurn } from './echoChatService';

const SERVER_URL = 'http://localhost:8000';

export interface ConversationArchive {
    id: string;
    updatedAt: number;
    history: ChatTurn[];
}

class ArchiveService {
    /**
     * Appends or overwrites the conversation history to the local disk.
     */
    async saveConversation(id: string, history: ChatTurn[]) {
        try {
            const data: ConversationArchive = {
                id,
                updatedAt: Date.now(),
                history
            };

            const payload = {
                path: `server_data/conversations/${id}/history.json`,
                content: JSON.stringify(data, null, 2)
            };

            const res = await fetch(`${SERVER_URL}/fs/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                console.warn('Failed to save conversation to disk via server.py', await res.text());
            }
        } catch (e) {
            console.error('ArchiveService save error:', e);
        }
    }

    /**
     * Retrieves a specific conversation history from disk.
     */
    async getConversation(id: string): Promise<ConversationArchive | null> {
        try {
            const payload = {
                path: `server_data/conversations/${id}/history.json`
            };

            const res = await fetch(`${SERVER_URL}/fs/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) return null;

            const data = await res.json();
            if (data.content) {
                return JSON.parse(data.content) as ConversationArchive;
            }
            return null;
        } catch (e) {
            console.error('ArchiveService read error:', e);
            return null;
        }
    }

    /**
     * Lists all saved conversation IDs by reading the directory names.
     */
    async listConversations(): Promise<string[]> {
        try {
            const payload = {
                path: 'server_data/conversations'
            };

            const res = await fetch(`${SERVER_URL}/fs/list`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) return [];

            const data = await res.json();
            if (data.files && Array.isArray(data.files)) {
                // Extract unique directory names from the files list
                // Files look like "id/history.json", so we want the "id" part
                const ids = new Set<string>();
                for (const file of data.files) {
                    const parts = file.split('/');
                    if (parts.length > 0 && parts[0]) {
                        ids.add(parts[0]);
                    }
                }
                return Array.from(ids);
            }
            return [];
        } catch (e) {
            console.error('ArchiveService list error:', e);
            return [];
        }
    }
}

export const archiveService = new ArchiveService();
