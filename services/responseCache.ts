// MOBILE-AGENT: tiny in-memory LRU cache for idempotent LLM responses.
//
// Used to dedupe rapid identical "read-only" tool reasoning calls — for
// example, repeatedly asking "what time is it?" within a few seconds.
//
// NOT for streaming responses, NOT for anything with side effects.

const MAX_ENTRIES = 50;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
    value: string;
    expiresAt: number;
}

const store = new Map<string, CacheEntry>();

/**
 * djb2 string hash — fast, dependency-free, sufficient for keying messages.
 * Not cryptographic; never use for security.
 */
function djb2(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    // Force unsigned and base36 for compactness
    return (hash >>> 0).toString(36);
}

export interface CacheKeyParts {
    model: string;
    messages: Array<{ role: string; content: string }>;
    /** Optional task tag to namespace caches (e.g. "tool_reason"). */
    tag?: string;
}

export function makeKey(parts: CacheKeyParts): string {
    const payload = JSON.stringify({
        m: parts.model,
        t: parts.tag || '',
        c: parts.messages.map(x => `${x.role[0]}:${x.content}`).join('\u0001'),
    });
    return djb2(payload);
}

function evictExpired(now: number): void {
    for (const [k, v] of store) {
        if (v.expiresAt <= now) store.delete(k);
    }
}

function evictIfFull(): void {
    while (store.size >= MAX_ENTRIES) {
        // Map iteration is insertion order — oldest is the first key.
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        store.delete(oldestKey);
    }
}

export function get(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
    }
    // Promote to most-recent by re-inserting.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
}

export function set(key: string, value: string, ttlMs: number = TTL_MS): void {
    const now = Date.now();
    evictExpired(now);
    evictIfFull();
    store.set(key, { value, expiresAt: now + ttlMs });
}

export function clear(): void {
    store.clear();
}

export function size(): number {
    return store.size;
}

export const responseCache = { get, set, makeKey, clear, size };
