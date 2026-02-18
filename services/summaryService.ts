import { openDB, DBSchema } from 'idb';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';

interface SummaryDB extends DBSchema {
    summaries: {
        key: string;
        value: {
            id: string;
            timestamp: number;
            summary: string;
            topics: string[];
        };
        indexes: { 'by-date': number };
    };
}

const DB_NAME = 'echo-summaries';
const MODEL_NAME = 'gemini-2.0-flash-exp';

class SummaryService {
    private dbPromise;
    private genAI: GoogleGenAI | null = null;

    constructor() {
        this.dbPromise = openDB<SummaryDB>(DB_NAME, 1, {
            upgrade(db) {
                const store = db.createObjectStore('summaries', { keyPath: 'id' });
                store.createIndex('by-date', 'timestamp');
            },
        });

        const key = localStorage.getItem('echo_api_key');
        if (key) {
            this.genAI = new GoogleGenAI({ apiKey: key });
        }
    }

    private getClient() {
        if (!this.genAI) {
            const key = localStorage.getItem('echo_api_key');
            if (!key) throw new Error("Gemini API Key not found");
            this.genAI = new GoogleGenAI({ apiKey: key });
        }
        return this.genAI;
    }

    async summarizeSession(history: ChatMessage[]): Promise<string> {
        if (history.length < 2) return ""; // Too short

        const client = this.getClient();
        const transcript = history.map(m => `${m.role}: ${m.text}`).join('\n');

        const prompt = `
    Analyze the following conversation history between a User and an AI (Echo).
    Create a concise summary of the key topics discussed, user preferences revealed, and any important facts.
    The summary should be written as a memory implementation for the AI to recall later.
    Format:
    - Summary paragraph
    - Key topics (comma separated)
    
    Conversation:
    ${transcript}
    `;

        try {
            const response = await client.models.generateContent({
                model: MODEL_NAME,
                contents: { role: 'user', parts: [{ text: prompt }] } // Correct format
            });

            // @ts-ignore
            const text = response.response?.text?.() || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (!text) return "";

            // Simple parsing (assuming concise output)
            const summary = text;

            // Store
            const db = await this.dbPromise;
            await db.put('summaries', {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                summary: summary,
                topics: [] // Parsing topics would require more strict JSON or regex, for now store whole text
            });

            return summary;
        } catch (e) {
            console.error("Summarization failed", e);
            return "";
        }
    }

    async getRecentSummaries(limit: number = 5) {
        const db = await this.dbPromise;
        const all = await db.getAllFromIndex('summaries', 'by-date');
        return all.reverse().slice(0, limit);
    }

    async getContextString(): Promise<string> {
        const summaries = await this.getRecentSummaries(5);
        if (summaries.length === 0) return "";

        return `
[PAST CONVERSATION SUMMARIES]
${summaries.map(s => `[${new Date(s.timestamp).toLocaleDateString()}]: ${s.summary}`).join('\n\n')}
`;
    }
}

export const summaryService = new SummaryService();
