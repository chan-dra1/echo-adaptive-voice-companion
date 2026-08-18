/**
 * uploadHistoryService.ts
 *
 * A lightweight, encrypted log of every file the user has ever handed to
 * Echo — regardless of which of the two separate upload paths it went
 * through: the "+" button (FileUploadPopup → geminiLiveService.sendFile,
 * a one-shot ephemeral send with no persistence of its own) or a drag-and-
 * drop of a PDF/text file (KnowledgeDropZone → knowledgeService.addDocument,
 * which DOES persist the file into the knowledge base but only for that one
 * file type). Neither path gave the user a way to see "what have I sent
 * Echo" as a single list, which is exactly what this fixes — recorded here
 * regardless of path, shown together in FilesPanel's Uploads tab.
 */

import { getCached, setCached } from './cryptoService';

const HISTORY_KEY = 'echo_upload_history';
const MAX_ENTRIES = 200;

export interface UploadHistoryEntry {
    id: string;
    name: string;
    type: string;
    size: number;
    /** Which path handled it — informational, shown in the UI. */
    destination: 'knowledge' | 'chat';
    createdAt: number;
}

export function recordUpload(entry: Omit<UploadHistoryEntry, 'id' | 'createdAt'>): void {
    const list = getUploadHistory();
    const next: UploadHistoryEntry = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
    };
    setCached(HISTORY_KEY, [next, ...list].slice(0, MAX_ENTRIES));
}

export function getUploadHistory(): UploadHistoryEntry[] {
    const raw = getCached<UploadHistoryEntry[]>(HISTORY_KEY, []);
    return Array.isArray(raw) ? raw : [];
}

export function removeUploadEntry(id: string): void {
    setCached(HISTORY_KEY, getUploadHistory().filter(e => e.id !== id));
}

export function clearUploadHistory(): void {
    setCached(HISTORY_KEY, []);
}
