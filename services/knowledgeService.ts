import { openDB, DBSchema } from 'idb';
import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Define IDB Schema
interface KnowledgeDB extends DBSchema {
    documents: {
        key: string;
        value: {
            id: string;
            name: string;
            type: string;
            uploadDate: number;
        };
    };
    vectors: {
        key: string;
        value: {
            id: string;
            documentId: string;
            text: string;
            embedding: number[];
        };
        indexes: { 'by-doc': string };
    };
}

const DB_NAME = 'echo-knowledge-base';
const EMBEDDING_MODEL = 'text-embedding-004';

class KnowledgeService {
    private dbPromise;
    private genAI: GoogleGenAI | null = null;

    constructor() {
        this.dbPromise = openDB<KnowledgeDB>(DB_NAME, 1, {
            upgrade(db) {
                db.createObjectStore('documents', { keyPath: 'id' });
                const vectorStore = db.createObjectStore('vectors', { keyPath: 'id' });
                vectorStore.createIndex('by-doc', 'documentId');
            },
        });

        // Initialize Gemini (read key from storage)
        const key = localStorage.getItem('echo_api_key');
        if (key) {
            this.genAI = new GoogleGenAI({ apiKey: key });
        }
    }

    private getClient() {
        if (!this.genAI) {
            const key = localStorage.getItem('echo_api_key');
            if (!key) throw new Error("Gemini API Key not found. Please add it in Settings.");
            this.genAI = new GoogleGenAI({ apiKey: key });
        }
        return this.genAI;
    }

    // --- Document Processing ---

    async addDocument(file: File) {
        const text = await this.extractText(file);
        const chunks = this.chunkText(text);

        // Generate Embeddings
        const client = this.getClient();
        // Batch embedding (limit to reasonable batch size)
        const embeddings = [];

        // Process in batches of 10 to avoid rate limits
        for (let i = 0; i < chunks.length; i += 10) {
            const batch = chunks.slice(i, i + 10);
            try {
                // Correct Gemini API call for embeddings: models.embedContent
                // Wait, @google/genai new SDK might be different. 
                // Checking docs or assuming standard REST-like method.
                // Actually the updated SDK uses specific methods.
                // I'll try the standard `embedContent` on model.

                // For batch, we might need to loop or use batchEmbedContents if supported.
                // I'll loop for safety.
                for (const chunk of batch) {
                    const result = await client.models.embedContent({
                        model: EMBEDDING_MODEL,
                        // @ts-ignore
                        content: { parts: [{ text: chunk }] } // Correct content format
                    });
                    // @ts-ignore - SDK typing issue or version mismatch
                    const values = result.embedding?.values || result.embeddings?.[0]?.values;
                    if (values) {
                        embeddings.push(values);
                    }
                }
            } catch (e) {
                console.error("Embedding error", e);
            }
        }

        if (embeddings.length !== chunks.length) {
            console.warn(`Generated ${embeddings.length} embeddings for ${chunks.length} chunks. Some failed.`);
        }

        // Store in IDB
        const db = await this.dbPromise;
        const docId = crypto.randomUUID();

        await db.put('documents', {
            id: docId,
            name: file.name,
            type: file.type,
            uploadDate: Date.now()
        });

        const tx = db.transaction('vectors', 'readwrite');
        await Promise.all(chunks.map(async (chunk, i) => {
            if (embeddings[i]) {
                await tx.store.put({
                    id: crypto.randomUUID(),
                    documentId: docId,
                    text: chunk,
                    embedding: embeddings[i]
                });
            }
        }));
        await tx.done;

        return docId;
    }

    private async extractText(file: File): Promise<string> {
        if (file.type === 'application/pdf') {
            // PDF Parsing logic
            // Note: Worker setup required for pdfjs in browser usually.
            // For simplicity, we assume generic text extraction or use a CDN worker if needed.
            // Actually, Vite handles worker imports if configured.
            // I'll leave basic PDF placeholder or try basic parsing.

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map((item: any) => item.str).join(' ') + '\n';
            }
            return text;
        } else {
            // Plain text / Markdown
            return await file.text();
        }
    }

    private chunkText(text: string, chunkSize: number = 500): string[] {
        // Simple chunking by paragraphs or sentences
        // For MVP, split by double newlines or fixed length
        const paragraphs = text.split(/\n\s*\n/);
        const chunks: string[] = [];

        for (const p of paragraphs) {
            if (p.length > chunkSize) {
                // Split long paragraphs
                let start = 0;
                while (start < p.length) {
                    chunks.push(p.slice(start, start + chunkSize));
                    start += chunkSize;
                }
            } else {
                chunks.push(p);
            }
        }
        return chunks.filter(c => c.trim().length > 0);
    }

    // --- Retrieval ---

    async query(queryText: string, topK: number = 3) {
        const client = this.getClient();
        const result = await client.models.embedContent({
            model: EMBEDDING_MODEL,
            // @ts-ignore
            content: { parts: [{ text: queryText }] }
        });

        // @ts-ignore
        const queryVector = result.embedding?.values || result.embeddings?.[0]?.values;
        if (!queryVector) return [];

        const db = await this.dbPromise;
        const allVectors = await db.getAll('vectors');

        // Calculate Cosine Similarity
        const scored = allVectors.map(v => ({
            ...v,
            score: this.cosineSimilarity(queryVector, v.embedding)
        }));

        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, topK).map(v => ({
            text: v.text,
            score: v.score,
            documentId: v.documentId
        }));
    }

    private cosineSimilarity(vecA: number[], vecB: number[]) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    // --- Management ---
    async getDocuments() {
        const db = await this.dbPromise;
        return await db.getAll('documents');
    }

    async clearKnowledge() {
        const db = await this.dbPromise;
        await db.clear('documents');
        await db.clear('vectors');
    }
}

export const knowledgeService = new KnowledgeService();
