import React, { useState } from 'react';
import { Lock, Zap, AlertTriangle } from 'lucide-react';
import { initVault, hasVault, getVaultMode } from '../services/cryptoService';

interface UnlockVaultProps {
    onUnlocked: () => void;
}

/**
 * First-run vault unlock modal.
 *
 *  - If there is no existing vault: user can either set a passphrase or
 *    pick "Quick Mode" (random key auto-generated, persisted in localStorage).
 *  - If there is an existing vault in passphrase mode: user must enter the
 *    passphrase.
 *  - If there is an existing vault in auto mode: we just init silently
 *    without showing the UI (handled by the parent).
 */
const UnlockVault: React.FC<UnlockVaultProps> = ({ onUnlocked }) => {
    const [passphrase, setPassphrase] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const existing = hasVault();
    const existingMode = existing ? getVaultMode() : null;

    const handleUnlock = async () => {
        setBusy(true);
        setError(null);
        try {
            if (!passphrase) {
                setError('Passphrase required.');
                return;
            }
            await initVault({ passphrase });
            onUnlocked();
        } catch (e: any) {
            setError(e?.message || 'Failed to unlock.');
        } finally {
            setBusy(false);
        }
    };

    const handleQuick = async () => {
        setBusy(true);
        setError(null);
        try {
            await initVault({ autoMode: true });
            onUnlocked();
        } catch (e: any) {
            setError(e?.message || 'Failed to init quick-mode vault.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-2xl">
            <div className="relative w-full max-w-md bg-black border border-[#00ff41]/30 rounded-2xl shadow-2xl p-6 font-mono text-[#00ff41]">
                <div className="flex items-center gap-3 mb-4">
                    <Lock size={22} />
                    <div>
                        <div className="text-lg tracking-widest uppercase">Vault Access</div>
                        <div className="text-[10px] text-[#00ff41]/60 uppercase tracking-widest">
                            {existing && existingMode === 'passphrase' ? 'Enter your passphrase' : 'Choose how to secure your data'}
                        </div>
                    </div>
                </div>

                {!existing && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4 flex items-start gap-2 text-[11px] text-amber-200">
                        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                        <span>
                            Quick Mode generates a random key stored in this browser. It's much better than the
                            old shared constant, but anyone with file access to your profile can decrypt the data.
                            Use a passphrase for stronger protection.
                        </span>
                    </div>
                )}

                <div className="space-y-3">
                    <input
                        type="password"
                        value={passphrase}
                        onChange={e => setPassphrase(e.target.value)}
                        placeholder={existing && existingMode === 'passphrase' ? 'Enter passphrase' : 'New passphrase (≥ 8 chars)'}
                        className="w-full bg-black/50 border border-[#00ff41]/20 rounded-lg p-2 text-xs"
                        onKeyDown={e => { if (e.key === 'Enter') handleUnlock(); }}
                    />

                    {error && <div className="text-rose-400 text-[11px]">{error}</div>}

                    <button
                        onClick={handleUnlock}
                        disabled={busy || !passphrase || (passphrase.length < 8 && !existing)}
                        className="w-full px-3 py-2 rounded-lg bg-[#00ff41]/15 border border-[#00ff41]/40 text-[#00ff41] hover:bg-[#00ff41]/25 disabled:opacity-30 transition"
                    >
                        {existing && existingMode === 'passphrase' ? 'Unlock' : 'Set Passphrase'}
                    </button>

                    {(!existing || existingMode !== 'passphrase') && (
                        <button
                            onClick={handleQuick}
                            disabled={busy}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 hover:bg-white/10 transition text-xs text-gray-300 flex items-center justify-center gap-2"
                        >
                            <Zap size={14} /> Skip — use Quick Mode (random key)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UnlockVault;
