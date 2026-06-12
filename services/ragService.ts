/**
 * ragService.ts — Echo's Retrieval-Augmented Generation engine.
 *
 * Architecture:
 *  1. Documents/text → chunked → each chunk embedded → stored in IndexedDB
 *  2. At query time → query embedded → top-k chunks retrieved by cosine sim
 *  3. Retrieved chunks injected into system prompt before sending to Gemini
 *
 * Storage: IndexedDB (idb library, already in package.json)
 *   DB name:  echo_rag_db
 *   Stores:
 *     'chunks'  — text chunk + embedding vector + metadata
 *     'sources' — document-level metadata (title, type, date added)
 *
 * All embeddings live entirely on-device. The vectors never leave the browser.
 * Text chunks are stored as plaintext in IndexedDB (vectors are useless without
 * the model). For higher security, the optional `encryptChunks` flag will
 * encrypt text via the vault DEK — vectors stay plaintext since they're
 * meaningless without context.
 */

import { openDB, IDBPDatabase } from 'idb';
import { embed, cosineSim, serializeVec, deserializeVec } from './embeddingService';
import { encryptAsync, decryptAsync, isUnlocked } from './cryptoService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChunkSource = 'document' | 'conversation' | 'memory' | 'note' | 'web';

export interface RagSource {
    id: string;               // uuid
    title: string;
    type: ChunkSource;
    addedAt: number;
    chunkCount: number;
    sizeChars: number;
    preview: string;          // first 120 chars
}

export interface RagChunk {
    id: string;               // uuid
    sourceId: string;
    text: string;             // plaintext (or cipher if encryptChunks)
    vecB64: string;           // serialized Float32Array
    chunkIndex: number;       // position in source doc
    addedAt: number;
}

export interface RetrievedChunk {
    chunk: RagChunk;
    score: number;            // 0..1 cosine similarity
    source: RagSource;
}

// ── DB setup ──────────────────────────────────────────────────────────────────

const DB_NAME    = 'echo_rag_db';
const DB_VERSION = 1;

let db: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
    if (db) return db;
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
            if (!database.objectStoreNames.contains('chunks')) {
                const chunkStore = database.createObjectStore('chunks', { keyPath: 'id' });
                chunkStore.createIndex('by_source', 'sourceId');
                chunkStore.createIndex('by_date', 'addedAt');
            }
            if (!database.objectStoreNames.contains('sources')) {
                database.createObjectStore('sources', { keyPath: 'id' });
            }
        },
    });
    return db;
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks.
 * - chunkSize: target characters per chunk (default 600 — ~150 tokens)
 * - overlap:   character overlap between adjacent chunks (default 100)
 *
 * Splits on sentence boundaries when possible to avoid cutting mid-thought.
 */
export function chunkText(
    text: string,
    chunkSize = 600,
    overlap = 100,
): string[] {
    // Normalize whitespace
    const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (normalized.length <= chunkSize) return [normalized];

    // Split into sentences (rough heuristic)
    const sentences = normalized.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [normalized];

    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
        if ((current + sentence).length > chunkSize && current.length > 0) {
            chunks.push(current.trim());
            // Overlap: carry last `overlap` chars into next chunk
            current = current.slice(-overlap) + sentence;
        } else {
            current += sentence;
        }
    }
    if (current.trim().length > 0) chunks.push(current.trim());

    return chunks.filter(c => c.length > 20); // drop tiny fragments
}

// ── Ingest ────────────────────────────────────────────────────────────────────

export interface IngestOptions {
    title: string;
    type: ChunkSource;
    encryptText?: boolean;     // encrypt chunk text with vault DEK
    onProgress?: (done: number, total: number) => void;
}

/**
 * Ingest a document: chunk it, embed each chunk, store in IndexedDB.
 * Returns the created RagSource record.
 */
export async function ingestText(
    text: string,
    opts: IngestOptions,
): Promise<RagSource> {
    const database = await getDB();
    const sourceId = crypto.randomUUID();
    const chunks   = chunkText(text);
    const now      = Date.now();

    const source: RagSource = {
        id:         sourceId,
        title:      opts.title,
        type:       opts.type,
        addedAt:    now,
        chunkCount: chunks.length,
        sizeChars:  text.length,
        preview:    text.slice(0, 120),
    };

    // Persist source record
    await database.put('sources', source);

    // Embed + persist each chunk
    for (let i = 0; i < chunks.length; i++) {
        const rawText = chunks[i];

        // Optionally encrypt text (vectors stay plaintext — they're meaningless without context)
        let storedText = rawText;
        if (opts.encryptText && isUnlocked()) {
            storedText = await encryptAsync(rawText);
        }

        const vec    = await embed(rawText);
        const vecB64 = serializeVec(vec);

        const chunk: RagChunk = {
            id:         crypto.randomUUID(),
            sourceId,
            text:       storedText,
            vecB64,
            chunkIndex: i,
            addedAt:    now,
        };

        await database.put('chunks', chunk);
        opts.onProgress?.(i + 1, chunks.length);
    }

    return source;
}

/**
 * Quick ingest a short string (single memory entry, note, etc.) as one chunk.
 */
export async function ingestMemory(
    key: string,
    value: string,
    opts?: Partial<IngestOptions>,
): Promise<void> {
    await ingestText(`${key}: ${value}`, {
        title: key,
        type: 'memory',
        ...opts,
    });
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface QueryOptions {
    topK?:      number;    // default 5
    threshold?: number;    // minimum score 0..1 (default 0.30)
    sourceType?: ChunkSource;  // filter to specific type
    sourceId?:   string;       // filter to specific document
    decryptText?: boolean;     // decrypt chunk text if it was encrypted
}

/**
 * Find the most relevant chunks for a query string.
 * Returns chunks sorted by cosine similarity, highest first.
 */
export async function query(
    queryText: string,
    opts: QueryOptions = {},
): Promise<RetrievedChunk[]> {
    const { topK = 5, threshold = 0.30, sourceType, sourceId, decryptText = true } = opts;

    const database = await getDB();

    // Embed the query
    const queryVec = await embed(queryText);

    // Load all chunks (or filtered subset)
    let rawChunks: RagChunk[];
    if (sourceId) {
        rawChunks = await database.getAllFromIndex('chunks', 'by_source', sourceId);
    } else {
        rawChunks = await database.getAll('chunks');
    }

    if (rawChunks.length === 0) return [];

    // Filter by source type if requested
    let filteredChunks = rawChunks;
    if (sourceType) {
        const sources = await database.getAll('sources') as RagSource[];
        const sourceIds = new Set(sources.filter(s => s.type === sourceType).map(s => s.id));
        filteredChunks = rawChunks.filter(c => sourceIds.has(c.sourceId));
    }

    // Score all chunks
    const scored: { chunk: RagChunk; score: number }[] = [];
    for (const chunk of filteredChunks) {
        const chunkVec = deserializeVec(chunk.vecB64);
        const score    = cosineSim(queryVec, chunkVec);
        if (score >= threshold) scored.push({ chunk, score });
    }

    // Sort descending and take topK
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, topK);

    if (topChunks.length === 0) return [];

    // Load source metadata
    const sourceCache = new Map<string, RagSource>();
    for (const { chunk } of topChunks) {
        if (!sourceCache.has(chunk.sourceId)) {
            const src = await database.get('sources', chunk.sourceId) as RagSource | undefined;
            if (src) sourceCache.set(chunk.sourceId, src);
        }
    }

    // Optionally decrypt text
    const result: RetrievedChunk[] = [];
    for (const { chunk, score } of topChunks) {
        let text = chunk.text;
        if (decryptText && isUnlocked() && text.startsWith('EVG1:')) {
            text = await decryptAsync<string>(text, chunk.text);
        }

        const source = sourceCache.get(chunk.sourceId);
        if (!source) continue;

        result.push({
            chunk: { ...chunk, text },
            score,
            source,
        });
    }

    return result;
}

/**
 * Format retrieved chunks into a compact context block for the system prompt.
 * Kept under ~800 tokens total.
 */
export function formatRagContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return '';

    const lines: string[] = [
        '[RETRIEVED KNOWLEDGE — from your personal vault]',
        `(${chunks.length} relevant passages found — most relevant first)`,
        '',
    ];

    for (const { chunk, score, source } of chunks) {
        const pct = Math.round(score * 100);
        lines.push(`--- Source: "${source.title}" [${source.type}] (${pct}% match) ---`);
        lines.push(chunk.text.trim());
        lines.push('');
    }

    lines.push('[END RETRIEVED KNOWLEDGE]');
    lines.push('Use the above passages to answer accurately. Cite the source title if helpful.');

    return lines.join('\n');
}

// ── Management ────────────────────────────────────────────────────────────────

export async function getAllSources(): Promise<RagSource[]> {
    const database = await getDB();
    const sources = await database.getAll('sources') as RagSource[];
    return sources.sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteSource(sourceId: string): Promise<void> {
    const database = await getDB();
    // Delete all chunks for this source
    const chunks = await database.getAllFromIndex('chunks', 'by_source', sourceId) as RagChunk[];
    const tx = database.transaction(['chunks', 'sources'], 'readwrite');
    for (const chunk of chunks) tx.objectStore('chunks').delete(chunk.id);
    tx.objectStore('sources').delete(sourceId);
    await tx.done;
}

export async function getChunkCount(): Promise<number> {
    const database = await getDB();
    return database.count('chunks');
}

export async function clearAllRag(): Promise<void> {
    const database = await getDB();
    await database.clear('chunks');
    await database.clear('sources');
}

/**
 * Archive old conversation messages into the RAG store so they can be
 * retrieved semantically later (rather than injecting them all into context).
 * Call this when a conversation is "closed" or older than N days.
 */
export async function archiveConversation(
    conversationId: string,
    title: string,
    messages: { role: string; text: string; timestamp: number }[],
): Promise<void> {
    // Combine messages into a readable transcript
    const transcript = messages
        .map(m => `${m.role === 'ai' ? 'Echo' : 'User'}: ${m.text}`)
        .join('\n');

    await ingestText(transcript, {
        title: `Conversation: ${title}`,
        type: 'conversation',
    });
}
