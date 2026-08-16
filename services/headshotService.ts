/**
 * headshotService.ts
 *
 * Local, encrypted storage for Headshot Studio: reference photos captured
 * from the camera and the professional headshots Gemini generates from
 * them. Stored in IndexedDB, each image encrypted with the app's
 * already-unlocked vault DEK (cryptoService.encryptAsync/decryptAsync) —
 * no second password, nothing leaves the device except the one Gemini API
 * call to generate an image, and nothing here is ever auto-deleted; only
 * an explicit deleteHeadshot() call removes a record.
 */

import { openDB, IDBPDatabase } from 'idb';
import { encryptAsync, decryptAsync } from './cryptoService';

const DB_NAME = 'echo_headshot_studio';
const STORE = 'headshots';

interface StoredRecord {
    id: string;
    createdAt: number;
    style: string;
    /** Ciphertext of the generated headshot's base64 image data. */
    encryptedImage: string;
    encryptedMimeType: string;
    /** Ciphertext of the reference photo used, kept so a headshot can be regenerated without recapturing. */
    encryptedSource?: string;
    encryptedSourceMimeType?: string;
}

export interface Headshot {
    id: string;
    createdAt: number;
    style: string;
    /** Ready-to-render data URL. */
    imageUrl: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, 1, {
            upgrade(database) {
                if (!database.objectStoreNames.contains(STORE)) {
                    database.createObjectStore(STORE, { keyPath: 'id' });
                }
            },
        });
    }
    return dbPromise;
}

export async function saveHeadshot(opts: {
    imageBase64: string;
    mimeType: string;
    style: string;
    sourceBase64?: string;
    sourceMimeType?: string;
}): Promise<Headshot> {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const record: StoredRecord = {
        id,
        createdAt,
        style: opts.style,
        encryptedImage: await encryptAsync(opts.imageBase64),
        encryptedMimeType: await encryptAsync(opts.mimeType),
        ...(opts.sourceBase64 ? { encryptedSource: await encryptAsync(opts.sourceBase64) } : {}),
        ...(opts.sourceMimeType ? { encryptedSourceMimeType: await encryptAsync(opts.sourceMimeType) } : {}),
    };
    const conn = await db();
    await conn.put(STORE, record);
    return { id, createdAt, style: opts.style, imageUrl: `data:${opts.mimeType};base64,${opts.imageBase64}` };
}

export async function listHeadshots(): Promise<Headshot[]> {
    const conn = await db();
    const records: StoredRecord[] = await conn.getAll(STORE);
    const out: Headshot[] = [];
    for (const r of records) {
        try {
            const imageBase64 = await decryptAsync<string>(r.encryptedImage, '');
            const mimeType = await decryptAsync<string>(r.encryptedMimeType, 'image/png');
            if (!imageBase64) continue;
            out.push({ id: r.id, createdAt: r.createdAt, style: r.style, imageUrl: `data:${mimeType};base64,${imageBase64}` });
        } catch {
            // Skip a record that fails to decrypt rather than breaking the whole gallery.
        }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteHeadshot(id: string): Promise<void> {
    const conn = await db();
    await conn.delete(STORE, id);
}

/** Retrieve the original reference photo for a headshot, if one was kept (for regenerating in a new style). */
export async function getHeadshotSource(id: string): Promise<{ data: string; mimeType: string } | null> {
    const conn = await db();
    const r: StoredRecord | undefined = await conn.get(STORE, id);
    if (!r?.encryptedSource) return null;
    const data = await decryptAsync<string>(r.encryptedSource, '');
    const mimeType = await decryptAsync<string>(r.encryptedSourceMimeType || '', 'image/jpeg');
    if (!data) return null;
    return { data, mimeType };
}

export async function countHeadshots(): Promise<number> {
    const conn = await db();
    return conn.count(STORE);
}
