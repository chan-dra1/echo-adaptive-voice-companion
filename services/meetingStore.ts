/**
 * meetingStore.ts
 *
 * IndexedDB persistence for Live Meeting Mode transcripts. Same idiom as
 * ragService.ts's echo_rag_db (openDB + upgrade callback + module-level
 * singleton handle), NOT cryptoService.setCached — a 60-minute meeting's
 * transcript can run to hundreds of KB, and setCached's persist() encrypts
 * and rewrites its ENTIRE key on every single call (see cryptoService.ts's
 * persist()), which would mean re-encrypting a growing multi-hundred-KB
 * blob on every chunk arrival. IndexedDB stores each chunk as its own row.
 *
 * Unlike ragService's *optional* encryptChunks flag, meeting transcript text
 * is ALWAYS encrypted here — this is someone else's speech, captured without
 * their direct participation in the recording action, and defaults matter.
 * If the vault is locked, chunk writes throw rather than silently falling
 * back to plaintext or silently dropping data — the caller (meetingCaptureService)
 * must refuse to start/continue recording on that error, never swallow it.
 */
import { openDB, IDBPDatabase } from 'idb';
import { encryptAsync, decryptAsync, isUnlocked } from './cryptoService';

const DB_NAME = 'echo_meeting_db';
const DB_VERSION = 1;

export type MeetingStatus = 'recording' | 'finalizing' | 'done' | 'aborted';
export type ChunkSpeaker = 'call' | 'me' | 'mixed' | 'unknown';

export interface MeetingRecord {
    id: string;
    title: string;
    startedAt: number;
    endedAt: number | null;
    status: MeetingStatus;
    chunkCount: number;
    /** Latest extraction result, updated as the meeting progresses. */
    runningSummary: string;
    actionItems: string[];
    decisions: string[];
    openQuestions: string[];
}

/** Stored row — `text` is ciphertext on disk (EVG1:-prefixed), decrypted on read. */
export interface MeetingChunkRecord {
    id: string;
    meetingId: string;
    index: number;
    text: string;
    speaker: ChunkSpeaker;
    startedAtMs: number;
    durationMs: number;
    addedAt: number;
}

let db: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
    if (db) return db;
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
            if (!database.objectStoreNames.contains('meetings')) {
                database.createObjectStore('meetings', { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains('chunks')) {
                const chunkStore = database.createObjectStore('chunks', { keyPath: 'id' });
                chunkStore.createIndex('by_meeting', 'meetingId');
                chunkStore.createIndex('by_meeting_index', ['meetingId', 'index']);
            }
        },
    });
    return db;
}

/** Whether the store is currently able to accept encrypted writes. Check
 *  this BEFORE starting a recording, not after the first chunk fails. */
export function canPersistMeetings(): boolean {
    return isUnlocked();
}

export async function createMeeting(title: string): Promise<MeetingRecord> {
    if (!isUnlocked()) throw new Error('Vault locked — cannot start a meeting recording.');
    const record: MeetingRecord = {
        id: crypto.randomUUID(),
        title,
        startedAt: Date.now(),
        endedAt: null,
        status: 'recording',
        chunkCount: 0,
        runningSummary: '',
        actionItems: [],
        decisions: [],
        openQuestions: [],
    };
    const database = await getDB();
    await database.put('meetings', record);
    return record;
}

export async function updateMeeting(id: string, patch: Partial<MeetingRecord>): Promise<void> {
    const database = await getDB();
    const existing = await database.get('meetings', id);
    if (!existing) throw new Error(`updateMeeting: no meeting with id ${id}`);
    await database.put('meetings', { ...existing, ...patch });
}

export async function getMeeting(id: string): Promise<MeetingRecord | undefined> {
    const database = await getDB();
    return database.get('meetings', id);
}

export async function listMeetings(): Promise<MeetingRecord[]> {
    const database = await getDB();
    const all: MeetingRecord[] = await database.getAll('meetings');
    return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteMeeting(id: string): Promise<void> {
    const database = await getDB();
    const tx = database.transaction(['meetings', 'chunks'], 'readwrite');
    await tx.objectStore('meetings').delete(id);
    const chunkStore = tx.objectStore('chunks');
    const idx = chunkStore.index('by_meeting');
    let cursor = await idx.openCursor(IDBKeyRange.only(id));
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;
}

/** Persist one transcribed chunk. Throws if the vault is locked — the
 *  caller must stop capture on this error, not retry silently in a loop
 *  (that would burn transcription API calls for data that can never save). */
export async function addChunk(
    meetingId: string,
    index: number,
    plaintextText: string,
    speaker: ChunkSpeaker,
    startedAtMs: number,
    durationMs: number,
): Promise<MeetingChunkRecord> {
    if (!isUnlocked()) throw new Error('Vault locked — cannot persist meeting transcript chunk.');
    const cipherText = await encryptAsync(plaintextText);
    const record: MeetingChunkRecord = {
        id: crypto.randomUUID(),
        meetingId,
        index,
        text: cipherText,
        speaker,
        startedAtMs,
        durationMs,
        addedAt: Date.now(),
    };
    const database = await getDB();
    await database.put('chunks', record);
    return record;
}

/** All chunks for a meeting, in order, with text DECRYPTED. If the vault is
 *  locked when this is called, ciphertext is returned as-is rather than
 *  thrown — same fail-open-to-unreadable-not-crash posture as ragService's
 *  decryptAsync, and critically NEVER raw JSON.parsed (see the EVG1: crash
 *  class this whole codebase already got bitten by once in TextChatBar.tsx). */
export async function getChunks(meetingId: string): Promise<MeetingChunkRecord[]> {
    const database = await getDB();
    const rows: MeetingChunkRecord[] = await database.getAllFromIndex('chunks', 'by_meeting', meetingId);
    rows.sort((a, b) => a.index - b.index);

    if (!isUnlocked()) return rows; // ciphertext as-is; caller must not treat as plaintext

    const decrypted = await Promise.all(rows.map(async (row) => {
        if (!row.text.startsWith('EVG1:')) return row; // legacy/unexpected — don't attempt decrypt
        const plain = await decryptAsync<string>(row.text, row.text);
        return { ...row, text: plain };
    }));
    return decrypted;
}

export async function getFullTranscript(meetingId: string): Promise<string> {
    const chunks = await getChunks(meetingId);
    return chunks.map((c) => c.text).join('\n');
}
