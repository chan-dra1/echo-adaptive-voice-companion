/**
 * webauthnService.ts — Biometric vault unlock via WebAuthn PRF.
 *
 * Uses the WebAuthn PRF (pseudo-random function) extension to derive a
 * stable 32-byte secret from a platform passkey (Touch ID / Face ID /
 * Windows Hello). That secret never leaves the authenticator's control
 * flow — it is only released after a successful biometric check, and we
 * use it to unwrap the vault DEK (see cryptoService.wrapDekForBiometric).
 *
 * Flow:
 *   enrollBiometric()  — while vault is unlocked: create passkey → get PRF
 *                        secret → wrap DEK with it. One-time setup.
 *   unlockBiometric()  — on app start: assert passkey (biometric prompt)
 *                        → PRF secret → unwrap DEK.
 *
 * Browser support: Chrome/Edge 116+, Safari 18+ (PRF extension).
 * If PRF is unsupported, enrollment fails gracefully and the user keeps
 * using their passphrase.
 */

import { wrapDekForBiometric, unlockWithBiometricSecret, hasBiometricWrap, removeBiometricWrap } from './cryptoService';

const CRED_ID_KEY = 'echo_webauthn_cred_id';
// Fixed PRF eval input — the authenticator mixes this with its internal
// per-credential key, so the output is unique per passkey but stable.
const PRF_INPUT = new TextEncoder().encode('echo-vault-prf-v1');

function bufToB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
function b64ToBuf(b64: string): ArrayBuffer {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.buffer;
}

/** Quick capability check — platform authenticator + PRF likely available. */
export async function isBiometricAvailable(): Promise<boolean> {
    try {
        if (!window.PublicKeyCredential) return false;
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

export function isBiometricEnrolled(): boolean {
    return hasBiometricWrap() && !!localStorage.getItem(CRED_ID_KEY);
}

export function unenrollBiometric(): void {
    removeBiometricWrap();
    localStorage.removeItem(CRED_ID_KEY);
}

/**
 * Enroll: create a passkey with the PRF extension and wrap the DEK with
 * the PRF output. Vault must already be unlocked.
 * Returns true on success; throws with a readable message otherwise.
 */
export async function enrollBiometric(userName = 'Echo User'): Promise<boolean> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId    = crypto.getRandomValues(new Uint8Array(16));

    const cred = await navigator.credentials.create({
        publicKey: {
            challenge,
            rp: { name: 'Echo Companion', id: location.hostname },
            user: { id: userId, name: userName, displayName: userName },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },   // ES256
                { type: 'public-key', alg: -257 }, // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                residentKey: 'required',
            },
            extensions: { prf: { eval: { first: PRF_INPUT } } } as any,
            timeout: 60_000,
        },
    }) as PublicKeyCredential | null;

    if (!cred) throw new Error('Passkey creation was cancelled.');

    const ext = cred.getClientExtensionResults() as any;
    let prfSecret: ArrayBuffer | undefined = ext?.prf?.results?.first;

    localStorage.setItem(CRED_ID_KEY, bufToB64(cred.rawId));

    if (!prfSecret) {
        // Some authenticators only release PRF output on get(), not create().
        // Do an immediate assertion to fetch it.
        prfSecret = await assertAndGetPrf();
    }
    if (!prfSecret) {
        localStorage.removeItem(CRED_ID_KEY);
        throw new Error('This device\'s authenticator does not support the PRF extension. Keep using your passphrase.');
    }

    await wrapDekForBiometric(bufToB64(prfSecret));
    return true;
}

async function assertAndGetPrf(): Promise<ArrayBuffer | undefined> {
    const credIdB64 = localStorage.getItem(CRED_ID_KEY);
    if (!credIdB64) throw new Error('No enrolled passkey found.');

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge,
            rpId: location.hostname,
            allowCredentials: [{ type: 'public-key', id: b64ToBuf(credIdB64) }],
            userVerification: 'required',
            extensions: { prf: { eval: { first: PRF_INPUT } } } as any,
            timeout: 60_000,
        },
    }) as PublicKeyCredential | null;

    if (!assertion) return undefined;
    const ext = assertion.getClientExtensionResults() as any;
    return ext?.prf?.results?.first;
}

/**
 * Unlock the vault with a biometric prompt.
 * Throws a readable error if the assertion fails or PRF is missing.
 */
export async function unlockBiometric(): Promise<void> {
    const prfSecret = await assertAndGetPrf();
    if (!prfSecret) throw new Error('Biometric check did not return a key. Use your passphrase instead.');
    await unlockWithBiometricSecret(bufToB64(prfSecret));
}
