/**
 * qa/shims.ts
 *
 * Echo's services/ modules are written for the browser (localStorage,
 * window, import.meta.env). This file installs the minimal set of globals
 * needed so those REAL modules can be imported and run under plain Node
 * (via `npx tsx`), with no test framework and no browser.
 *
 * IMPORTANT: this must be imported BEFORE any services/* module, since
 * several of them read `localStorage`/`window` at import time or from
 * top-level module state. See qa/run.ts for import order.
 *
 * Nothing here modifies files outside qa/ — it only patches the Node
 * global object for the lifetime of the qa process.
 */

/** Minimal synchronous localStorage polyfill (Node has no global localStorage). */
class MemoryStorage {
    private store = new Map<string, string>();

    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, String(value));
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
    key(index: number): string | null {
        return Array.from(this.store.keys())[index] ?? null;
    }
    get length(): number {
        return this.store.size;
    }
}

export function installBrowserShims(): void {
    if (!(globalThis as any).localStorage) {
        (globalThis as any).localStorage = new MemoryStorage();
    }
    if (!(globalThis as any).window) {
        // Only what llmRouter (window.location.origin for OpenRouter headers)
        // and supabaseClient (typeof window !== 'undefined' guard) touch.
        (globalThis as any).window = {
            location: { origin: 'http://localhost:5173' },
        };
    }
    // Node's global `crypto` (webcrypto) already provides randomUUID() and
    // subtle, which is all cryptoService/memoryService need — nothing to do.
}

/** Reset localStorage between scenarios so they can't leak state into each other. */
export function resetLocalStorage(): void {
    (globalThis as any).localStorage = new MemoryStorage();
}

// Auto-install on import. This file must be the FIRST thing qa/run.ts (and
// any scenario file, transitively) imports, so that by the time any
// services/* module is evaluated, localStorage/window already exist. ES
// module import statements evaluate in source order, so `import './shims'`
// as the first line of run.ts guarantees this regardless of whether
// scenarios are imported statically or dynamically afterwards.
installBrowserShims();
