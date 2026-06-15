/**
 * store.mjs — Echo Core encrypted state store.
 *
 * The single source of truth shared by the terminal REPL and the web
 * dashboard. All data lives in one AES-256-GCM encrypted file on disk
 * (~/.echo-core/state.enc). A random 32-byte data key is generated on first
 * run and stored at ~/.echo-core/key (mode 600) — "quick mode", mirroring the
 * web app's auto vault. Passphrase mode can wrap this key later.
 *
 * Collections (arrays of objects): drafts, campaigns, projects, memories,
 * history. Every mutation persists immediately and emits 'change' so the sync
 * hub can broadcast to connected clients.
 *
 * API:
 *   const store = await openStore();
 *   store.all('drafts')             → array
 *   store.add('drafts', item)       → item (with id+createdAt), persisted, emits
 *   store.remove('drafts', id)
 *   store.snapshot()                → { drafts, campaigns, ... } (full state)
 *   store.on('change', ({collection, op, item}) => ...)
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), '.echo-core');
const KEY_FILE = path.join(DIR, 'key');
const STATE_FILE = path.join(DIR, 'state.enc');

const COLLECTIONS = ['drafts', 'campaigns', 'projects', 'memories', 'history', 'schedules', 'tasks'];
const ENC_ALGO = 'aes-256-gcm';

function getOrCreateKey() {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE);
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    return key;
}

function emptyState() {
    const s = {};
    for (const c of COLLECTIONS) s[c] = [];
    return s;
}

function decrypt(key) {
    if (!fs.existsSync(STATE_FILE)) return emptyState();
    try {
        const raw = fs.readFileSync(STATE_FILE);
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const data = raw.subarray(28);
        const decipher = crypto.createDecipheriv(ENC_ALGO, key, iv);
        decipher.setAuthTag(tag);
        const json = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(json);
        // ensure all collections exist
        for (const c of COLLECTIONS) if (!Array.isArray(parsed[c])) parsed[c] = [];
        return parsed;
    } catch (e) {
        console.error('[store] decrypt failed — starting fresh:', e.message);
        return emptyState();
    }
}

function encrypt(key, state) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
    const json = Buffer.from(JSON.stringify(state), 'utf8');
    const enc = Buffer.concat([cipher.update(json), cipher.final()]);
    const tag = cipher.getAuthTag();
    fs.writeFileSync(STATE_FILE, Buffer.concat([iv, tag, enc]), { mode: 0o600 });
}

export async function openStore() {
    const key = getOrCreateKey();
    let state = decrypt(key);
    const emitter = new EventEmitter();
    let saveTimer = null;

    const persist = () => {
        // debounce rapid writes
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { encrypt(key, state); } catch (e) { console.error('[store] persist failed:', e.message); } }, 80);
    };

    const api = {
        collections: COLLECTIONS,

        all(collection) {
            if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection: ${collection}`);
            return state[collection].slice();
        },

        get(collection, id) {
            return (state[collection] || []).find(x => x.id === id);
        },

        add(collection, item) {
            if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection: ${collection}`);
            const full = {
                id: item.id || `${collection.slice(0, 2)}_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
                createdAt: item.createdAt || Date.now(),
                ...item,
            };
            state[collection].push(full);
            if (state[collection].length > 1000) state[collection] = state[collection].slice(-1000);
            persist();
            emitter.emit('change', { collection, op: 'add', item: full });
            return full;
        },

        update(collection, id, patch) {
            if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection: ${collection}`);
            const item = state[collection].find(x => x.id === id);
            if (!item) return null;
            Object.assign(item, patch, { id, updatedAt: Date.now() });
            persist();
            emitter.emit('change', { collection, op: 'update', item });
            return item;
        },

        remove(collection, id) {
            const before = state[collection].length;
            state[collection] = state[collection].filter(x => x.id !== id);
            if (state[collection].length !== before) {
                persist();
                emitter.emit('change', { collection, op: 'remove', item: { id } });
                return true;
            }
            return false;
        },

        snapshot() {
            const out = {};
            for (const c of COLLECTIONS) out[c] = state[c].slice();
            return out;
        },

        on(evt, fn) { emitter.on(evt, fn); return () => emitter.off(evt, fn); },

        get dir() { return DIR; },
    };

    return api;
}
