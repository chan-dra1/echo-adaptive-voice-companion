/**
 * cryptoService.ts
 *
 * Unified vault crypto for Echo.
 *
 *  - Uses Web Crypto (SubtleCrypto) AES-GCM 256.
 *  - Master key derived via PBKDF2(SHA-256, 250k iters) from either:
 *      a) a user passphrase, OR
 *      b) an auto-generated random secret persisted in localStorage
 *         ("quick mode" — better than the old hard-coded shared constant,
 *          but warn the user).
 *  - A Data Encryption Key (DEK) is generated once, wrapped with the master
 *    key, and stored alongside the salt. This way, rotating the passphrase
 *    only needs to rewrap the DEK rather than re-encrypt every blob.
 *  - For backwards compatibility with the existing synchronous getters
 *    (getMemories(), getConversations(), ...) we cache decrypted values in
 *    memory after the vault unlocks. Writes update the cache synchronously
 *    and persist asynchronously (encrypted) to localStorage.
 *
 * Public API surface (kept intentionally small):
 *
 *  - initVault({ passphrase?, autoMode? }): Promise<void>
 *  - changePassphrase(oldPp, newPp): Promise<void>
 *  - isUnlocked(): boolean
 *  - hasVault(): boolean
 *  - getVaultMode(): 'auto' | 'passphrase' | 'locked'
 *  - getCached<T>(key, fallback): T
 *  - setCached(key, value): void   (sync, queues async persist)
 *  - removeCached(key): void
 *  - encryptAsync(data): Promise<string>
 *  - decryptAsync(ct, fallback): Promise<T>
 *  - lockVault(): void
 *
 * Migration:
 *
 *  When initVault() unlocks, it also looks at any well-known legacy keys
 *  that were encrypted with the previous shared CryptoJS constant
 *  ('echo_secure_storage_v1') and re-encrypts them with the new scheme.
 */

import CryptoJS from 'crypto-js';

const SALT_KEY = 'echo_vault_salt_v2';
const WRAPPED_DEK_KEY = 'echo_vault_dek_v2';
const VAULT_MODE_KEY = 'echo_vault_mode_v2'; // 'auto' | 'passphrase'
const AUTO_SECRET_KEY = 'echo_vault_auto_secret_v2';
const LEGACY_CRYPTOJS_KEY = 'echo_secure_storage_v1';
const PBKDF2_ITERS = 250_000;
const ENC_PREFIX = 'EVG1:'; // EchoVault GCM v1 prefix

// Known storage keys we eagerly decrypt + cache on unlock so that the rest of
// the app can keep using synchronous getters.
const KNOWN_KEYS: string[] = [
    'echo_long_term_memory',
    'echo_conversations',
    'echo_shared_knowledge',
    'echo_reminders',
    'echo_background_tasks',
    'echo_task_missions',
    'echo_project_ops_projects',
    'echo_marketing_plan_history',
    'echo_folders',
    'echo_folder_items',
    'echo_style_examples',
    'echo_dynamic_skill_acl',
];

interface VaultState {
    dek: CryptoKey | null;
    mode: 'auto' | 'passphrase' | 'locked';
    cache: Map<string, any>;
}

const state: VaultState = {
    dek: null,
    mode: 'locked',
    cache: new Map(),
};

const subtle = (): SubtleCrypto => {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('Web Crypto API is not available in this environment.');
    }
    return crypto.subtle;
};

function bytesToB64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

async function deriveKEK(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const pwKey = await subtle().importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
    );
    return subtle().deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
        pwKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
    );
}

async function generateDEK(): Promise<CryptoKey> {
    return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function wrapDEK(dek: CryptoKey, kek: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
    const wrappedBytes = new Uint8Array(wrapped);
    const out = new Uint8Array(iv.length + wrappedBytes.length);
    out.set(iv);
    out.set(wrappedBytes, iv.length);
    return bytesToB64(out);
}

async function unwrapDEK(wrappedB64: string, kek: CryptoKey): Promise<CryptoKey> {
    const raw = b64ToBytes(wrappedB64);
    const iv = raw.slice(0, 12);
    const wrappedKey = raw.slice(12);
    return subtle().unwrapKey(
        'raw',
        wrappedKey,
        kek,
        { name: 'AES-GCM', iv },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
}

async function encryptWithDEK(plaintext: string, dek: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, dek, data);
    const ctBytes = new Uint8Array(ct);
    const out = new Uint8Array(iv.length + ctBytes.length);
    out.set(iv);
    out.set(ctBytes, iv.length);
    return ENC_PREFIX + bytesToB64(out);
}

async function decryptWithDEK(ciphertext: string, dek: CryptoKey): Promise<string> {
    const raw = b64ToBytes(ciphertext.slice(ENC_PREFIX.length));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, dek, data);
    return new TextDecoder().decode(pt);
}

function getOrCreateSalt(): Uint8Array {
    const existing = localStorage.getItem(SALT_KEY);
    if (existing) return b64ToBytes(existing);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(SALT_KEY, bytesToB64(salt));
    return salt;
}

function getOrCreateAutoSecret(): string {
    let s = localStorage.getItem(AUTO_SECRET_KEY);
    if (!s) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        s = bytesToB64(bytes);
        localStorage.setItem(AUTO_SECRET_KEY, s);
    }
    return s;
}

function tryParseLegacy<T>(stored: string | null, fallback: T): T {
    if (!stored) return fallback;
    // Already migrated → can't parse here.
    if (stored.startsWith(ENC_PREFIX)) return fallback;
    try {
        const bytes = CryptoJS.AES.decrypt(stored, LEGACY_CRYPTOJS_KEY);
        const txt = bytes.toString(CryptoJS.enc.Utf8);
        return JSON.parse(txt);
    } catch {
        try { return JSON.parse(stored); } catch { return fallback; }
    }
}

async function migrateLegacy(): Promise<void> {
    if (!state.dek) return;
    for (const key of KNOWN_KEYS) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        if (raw.startsWith(ENC_PREFIX)) {
            // already new-format; just decrypt into cache
            try {
                const pt = await decryptWithDEK(raw, state.dek);
                state.cache.set(key, JSON.parse(pt));
            } catch (e) {
                console.warn(`[crypto] failed to decrypt ${key}:`, e);
            }
            continue;
        }
        // legacy → migrate
        const value = tryParseLegacy<unknown>(raw, null);
        if (value === null || value === undefined) continue;
        state.cache.set(key, value);
        try {
            const ct = await encryptWithDEK(JSON.stringify(value), state.dek);
            localStorage.setItem(key, ct);
            console.log(`[crypto] migrated legacy storage key → ${key}`);
        } catch (e) {
            console.warn(`[crypto] failed to migrate ${key}:`, e);
        }
    }
}

/* ─────────── Public API ─────────── */

export function hasVault(): boolean {
    return !!localStorage.getItem(WRAPPED_DEK_KEY) && !!localStorage.getItem(SALT_KEY);
}

export function getVaultMode(): 'auto' | 'passphrase' | 'locked' {
    if (state.mode === 'locked') {
        const stored = localStorage.getItem(VAULT_MODE_KEY);
        if (stored === 'auto' || stored === 'passphrase') return stored;
    }
    return state.mode;
}

export function isUnlocked(): boolean { return !!state.dek; }

export interface InitVaultOptions {
    passphrase?: string;        // explicit user passphrase
    autoMode?: boolean;         // skip passphrase, use random secret
}

export async function initVault(opts: InitVaultOptions = {}): Promise<void> {
    if (state.dek) return; // already unlocked

    const forceQuick = !!opts.autoMode;

    // Quick mode never blocks on a passphrase vault — wipe and start fresh.
    if (forceQuick && localStorage.getItem(VAULT_MODE_KEY) === 'passphrase') {
        resetVaultKeys();
    }

    const salt = getOrCreateSalt();
    let secret = opts.passphrase;
    let chosenMode: 'auto' | 'passphrase';

    if (!secret) {
        const storedMode = localStorage.getItem(VAULT_MODE_KEY) as 'auto' | 'passphrase' | null;
        if (storedMode === 'passphrase' && !forceQuick) {
            throw new Error('Vault is locked with a passphrase. Please unlock.');
        }
        secret = getOrCreateAutoSecret();
        chosenMode = 'auto';
    } else {
        chosenMode = 'passphrase';
    }

    const kek = await deriveKEK(secret, salt);
    const wrappedDek = localStorage.getItem(WRAPPED_DEK_KEY);

    if (wrappedDek) {
        try {
            state.dek = await unwrapDEK(wrappedDek, kek);
        } catch {
            if (!forceQuick) {
                throw new Error('Incorrect passphrase or corrupted vault.');
            }
            // Stale passphrase wrap or corrupt DEK — recreate a quick-mode vault.
            resetVaultKeys();
            const freshSalt = getOrCreateSalt();
            const freshSecret = getOrCreateAutoSecret();
            const freshKek = await deriveKEK(freshSecret, freshSalt);
            const dek = await generateDEK();
            localStorage.setItem(WRAPPED_DEK_KEY, await wrapDEK(dek, freshKek));
            state.dek = dek;
            chosenMode = 'auto';
        }
    } else {
        const dek = await generateDEK();
        localStorage.setItem(WRAPPED_DEK_KEY, await wrapDEK(dek, kek));
        state.dek = dek;
    }

    localStorage.setItem(VAULT_MODE_KEY, chosenMode);
    state.mode = chosenMode;

    await migrateLegacy();
}

export async function changePassphrase(oldPp: string | null, newPp: string): Promise<void> {
    // Verify current key works (unlock if needed)
    if (!state.dek) {
        if (oldPp === null) {
            await initVault({ autoMode: true });
        } else {
            await initVault({ passphrase: oldPp });
        }
    }
    if (!state.dek) throw new Error('Vault could not be opened.');

    // Rotate KEK by re-wrapping the existing DEK with the new passphrase.
    // We also rotate the salt for hygiene.
    const newSalt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(SALT_KEY, bytesToB64(newSalt));

    const newKek = await deriveKEK(newPp, newSalt);
    const wrapped = await wrapDEK(state.dek, newKek);
    localStorage.setItem(WRAPPED_DEK_KEY, wrapped);
    localStorage.setItem(VAULT_MODE_KEY, 'passphrase');
    state.mode = 'passphrase';
    // Auto-secret no longer trusted.
    localStorage.removeItem(AUTO_SECRET_KEY);
}

export function lockVault(): void {
    state.dek = null;
    state.cache.clear();
    state.mode = 'locked';
}

/** Wipe vault key material so a fresh Quick Mode vault can be created. */
export function resetVaultKeys(): void {
    lockVault();
    localStorage.removeItem(WRAPPED_DEK_KEY);
    localStorage.removeItem(VAULT_MODE_KEY);
    localStorage.removeItem(AUTO_SECRET_KEY);
    localStorage.removeItem(SALT_KEY);
}

/* ─────────── Biometric (WebAuthn PRF) wrap ───────────
 *
 * A passkey's PRF output acts as a second "passphrase": we derive a KEK
 * from it and keep a SECOND wrapped copy of the same DEK. Either path
 * (passphrase or biometric) unwraps the identical DEK, so data is
 * readable regardless of which unlock method was used.
 */

const BIO_DEK_KEY  = 'echo_vault_dek_bio_v1';
const BIO_SALT_KEY = 'echo_vault_bio_salt_v1';

export function hasBiometricWrap(): boolean {
    return !!localStorage.getItem(BIO_DEK_KEY);
}

export function removeBiometricWrap(): void {
    localStorage.removeItem(BIO_DEK_KEY);
    localStorage.removeItem(BIO_SALT_KEY);
}

/** Wrap the currently-unlocked DEK with a key derived from the PRF secret. */
export async function wrapDekForBiometric(prfSecretB64: string): Promise<void> {
    if (!state.dek) throw new Error('Vault must be unlocked before enrolling biometrics.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(BIO_SALT_KEY, bytesToB64(salt));
    const kek = await deriveKEK(prfSecretB64, salt);
    const wrapped = await wrapDEK(state.dek, kek);
    localStorage.setItem(BIO_DEK_KEY, wrapped);
}

/** Unlock the vault using the PRF secret from a successful passkey assertion. */
export async function unlockWithBiometricSecret(prfSecretB64: string): Promise<void> {
    if (state.dek) return; // already unlocked
    const wrapped = localStorage.getItem(BIO_DEK_KEY);
    const saltB64 = localStorage.getItem(BIO_SALT_KEY);
    if (!wrapped || !saltB64) throw new Error('No biometric enrollment found.');
    const kek = await deriveKEK(prfSecretB64, b64ToBytes(saltB64));
    try {
        state.dek = await unwrapDEK(wrapped, kek);
    } catch {
        throw new Error('Biometric unlock failed — key mismatch.');
    }
    const storedMode = localStorage.getItem(VAULT_MODE_KEY) as 'auto' | 'passphrase' | null;
    state.mode = storedMode || 'passphrase';
    await migrateLegacy();
}

/* sync cache accessors used by the rest of the app */

export function getCached<T>(key: string, fallback: T): T {
    if (state.cache.has(key)) return state.cache.get(key) as T;
    return fallback;
}

export function setCached(key: string, value: any): void {
    state.cache.set(key, value);
    void persist(key, value);
}

export function removeCached(key: string): void {
    state.cache.delete(key);
    localStorage.removeItem(key);
}

async function persist(key: string, value: any): Promise<void> {
    if (!state.dek) {
        // Vault not unlocked → don't write plaintext, drop it.
        console.warn('[crypto] persist skipped — vault locked. Key:', key);
        return;
    }
    try {
        const ct = await encryptWithDEK(JSON.stringify(value), state.dek);
        localStorage.setItem(key, ct);
    } catch (e) {
        console.error('[crypto] persist failed for', key, e);
    }
}

/* Async helpers for blobs that aren't part of the cached set */

export async function encryptAsync(data: any): Promise<string> {
    if (!state.dek) throw new Error('Vault locked.');
    return encryptWithDEK(JSON.stringify(data), state.dek);
}

export async function decryptAsync<T>(ct: string | null, fallback: T): Promise<T> {
    if (!ct) return fallback;
    if (!state.dek) return fallback;
    try {
        if (!ct.startsWith(ENC_PREFIX)) {
            // legacy → try crypto-js fallback
            return tryParseLegacy<T>(ct, fallback);
        }
        const pt = await decryptWithDEK(ct, state.dek);
        return JSON.parse(pt);
    } catch (e) {
        console.warn('[crypto] decryptAsync failed:', e);
        return fallback;
    }
}
