/**
 * dynamicSkillRunner.ts
 *
 * Runs user-approved JavaScript skills inside a sandboxed Web Worker.
 *
 *  - Worker is created from an in-memory Blob URL containing a small RPC
 *    harness plus the skill code.
 *  - Capability proxy whitelists:
 *      * fetch — only to domains in the user-approved allowlist.
 *      * console.log
 *      * crypto.randomUUID
 *      * structured-cloneable return values (JSON-safe).
 *  - Denied: direct DOM access (not available in a Worker anyway),
 *    `eval`, `Function` constructor, `importScripts`, localStorage,
 *    indexedDB, XMLHttpRequest, WebSocket, OffscreenCanvas, etc. The
 *    harness deletes globalThis entries before importing the skill.
 *
 * RPC protocol (worker ↔ main):
 *   main → worker: { id, type: 'invoke', toolName, args }
 *   worker → main: { id, type: 'result', value | error }
 *   worker → main: { id, type: 'fetch', url, init }       (waits on response)
 *   main  → worker: { id, type: 'fetch_response', ok, status, body }
 */

export interface SkillPermissions {
    /** Fully-qualified hostnames or scheme-host prefixes that fetch() may target. */
    fetchAllowlist: string[];
}

interface PendingInvocation {
    resolve: (val: any) => void;
    reject: (err: Error) => void;
}

const WORKER_HARNESS = `/* echo dynamic-skill worker harness */
const __pendingFetches = new Map();
let __fetchSeq = 0;
let __allow = [];

self.console = { log: (...a) => self.postMessage({ type: 'log', args: a }) };

const originalFetch = self.fetch?.bind(self);

self.fetch = function(input, init) {
  return new Promise((resolve, reject) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      let ok = false;
      try {
        const u = new URL(url, 'http://x');
        const allowed = __allow.some(a => u.host === a || u.host.endsWith('.' + a) || url.startsWith(a));
        ok = allowed;
      } catch { ok = false; }
      if (!ok) {
        reject(new Error('Fetch denied by skill sandbox: ' + url));
        return;
      }
      const id = ++__fetchSeq;
      __pendingFetches.set(id, { resolve, reject });
      self.postMessage({ type: 'fetch', id, url, init });
    } catch (e) {
      reject(e);
    }
  });
};

// Lock down dangerous globals
try { delete self.XMLHttpRequest; } catch {}
try { delete self.WebSocket; } catch {}
try { delete self.indexedDB; } catch {}
try { delete self.OffscreenCanvas; } catch {}
try { delete self.importScripts; } catch {}
try { self.eval = () => { throw new Error('eval disabled in skill sandbox'); }; } catch {}
try { self.Function = function() { throw new Error('Function ctor disabled in skill sandbox'); }; } catch {}

let __skillModule = null;

self.onmessage = async function(ev) {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    __allow = Array.isArray(msg.allow) ? msg.allow : [];
    try {
      __skillModule = (new (Object.getPrototypeOf(async function(){}).constructor)('module', msg.code + '\\nreturn (typeof skill !== "undefined") ? skill : (typeof module !== "undefined" && module.exports) ? module.exports : null;'))(
        { exports: {} }
      );
      __skillModule = await __skillModule;
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'init_error', error: String(e && e.message || e) });
    }
    return;
  }
  if (msg.type === 'fetch_response') {
    const p = __pendingFetches.get(msg.id);
    if (!p) return;
    __pendingFetches.delete(msg.id);
    if (msg.error) { p.reject(new Error(msg.error)); return; }
    p.resolve({
      ok: msg.ok,
      status: msg.status,
      text: async () => msg.body,
      json: async () => { try { return JSON.parse(msg.body); } catch (e) { throw new Error('Invalid JSON in response'); } },
    });
    return;
  }
  if (msg.type === 'invoke') {
    try {
      if (!__skillModule || typeof __skillModule.execute !== 'function') {
        throw new Error('Skill has no execute() function');
      }
      const value = await __skillModule.execute(msg.toolName, msg.args);
      self.postMessage({ type: 'result', id: msg.id, value });
    } catch (e) {
      self.postMessage({ type: 'result', id: msg.id, error: String(e && e.message || e) });
    }
  }
};
`;

class SkillWorkerInstance {
    private worker: Worker | null = null;
    private blobUrl: string;
    private ready: Promise<void>;
    private pending = new Map<number, PendingInvocation>();
    private seq = 0;
    private allowlist: string[];

    constructor(jsCode: string, perms: SkillPermissions) {
        this.allowlist = perms.fetchAllowlist || [];
        const combined = `${WORKER_HARNESS}\n/* user skill code below */\n${jsCode}\n`;
        const blob = new Blob([combined], { type: 'text/javascript' });
        this.blobUrl = URL.createObjectURL(blob);

        this.worker = new Worker(this.blobUrl, { type: 'classic' });
        this.worker.onmessage = this.onMessage.bind(this);
        this.worker.onerror = (e) => {
            console.error('[skill-worker] uncaught error:', e.message);
        };

        this.ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Skill init timeout')), 5000);
            this.worker!.addEventListener('message', (ev) => {
                if (ev.data?.type === 'ready') { clearTimeout(timer); resolve(); }
                if (ev.data?.type === 'init_error') { clearTimeout(timer); reject(new Error(ev.data.error)); }
            });
        });

        this.worker.postMessage({ type: 'init', code: jsCode, allow: this.allowlist });
    }

    private async onMessage(ev: MessageEvent) {
        const msg = ev.data || {};
        if (msg.type === 'log') {
            console.log('[skill]', ...msg.args);
            return;
        }
        if (msg.type === 'fetch') {
            const { id, url, init } = msg;
            try {
                const res = await fetch(url, init);
                const body = await res.text();
                this.worker?.postMessage({
                    type: 'fetch_response', id, ok: res.ok, status: res.status, body,
                });
            } catch (e: any) {
                this.worker?.postMessage({
                    type: 'fetch_response', id, error: String(e?.message || e),
                });
            }
            return;
        }
        if (msg.type === 'result') {
            const p = this.pending.get(msg.id);
            if (!p) return;
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.value);
        }
    }

    async invoke(toolName: string, args: any): Promise<any> {
        await this.ready;
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('Skill invocation timed out (30s)'));
                }
            }, 30_000);
            this.worker?.postMessage({ type: 'invoke', id, toolName, args });
            // ensure timer is cleared on resolve/reject
            const p = this.pending.get(id);
            if (p) {
                const orig = p.resolve;
                p.resolve = (v) => { clearTimeout(timer); orig(v); };
                const origRej = p.reject;
                p.reject = (e) => { clearTimeout(timer); origRej(e); };
            }
        });
    }

    dispose(): void {
        this.worker?.terminate();
        this.worker = null;
        try { URL.revokeObjectURL(this.blobUrl); } catch { /* noop */ }
        this.pending.clear();
    }
}

const instances = new Map<string, SkillWorkerInstance>();

export function getOrCreateWorker(skillId: string, jsCode: string, perms: SkillPermissions): SkillWorkerInstance {
    const existing = instances.get(skillId);
    if (existing) return existing;
    const inst = new SkillWorkerInstance(jsCode, perms);
    instances.set(skillId, inst);
    return inst;
}

export function disposeWorker(skillId: string): void {
    const inst = instances.get(skillId);
    if (inst) {
        inst.dispose();
        instances.delete(skillId);
    }
}

export function disposeAllWorkers(): void {
    for (const [id, inst] of instances.entries()) {
        inst.dispose();
        instances.delete(id);
    }
}
