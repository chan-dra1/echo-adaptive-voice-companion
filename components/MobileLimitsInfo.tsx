import React from 'react';
import { X, Smartphone, Lock, Zap } from 'lucide-react';

// MOBILE-AGENT: Honest disclosure of what works in pure PWA vs native shell.

interface Props {
    onClose: () => void;
}

const MobileLimitsInfo: React.FC<Props> = ({ onClose }) => {
    return (
        <div
            className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="max-w-md w-full bg-black border border-[#00ff41]/40 rounded-2xl p-5 text-[#00ff41] font-mono text-[12px] leading-relaxed shadow-[0_0_24px_rgba(0,255,65,0.15)]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Smartphone size={16} />
                        <span className="tracking-widest uppercase text-[11px]">Mobile Honest-Mode</span>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="opacity-70 hover:opacity-100">
                        <X size={16} />
                    </button>
                </div>

                <section className="mb-3">
                    <h3 className="flex items-center gap-2 text-[#00ff41] mb-1.5">
                        <Zap size={12} /> What WORKS in PWA mode
                    </h3>
                    <ul className="list-disc pl-5 space-y-1 opacity-90">
                        <li>Voice + screen + camera while the app is foregrounded.</li>
                        <li>Wake Lock keeps the screen from sleeping during a session (if your device supports it).</li>
                        <li>Lock-screen "Now Playing"-style controls via the Media Session API.</li>
                        <li>Offline shell so the UI opens even without a network.</li>
                        <li>Installable to your Home Screen with a real app icon.</li>
                    </ul>
                </section>

                <section className="mb-3">
                    <h3 className="flex items-center gap-2 text-rose-400 mb-1.5">
                        <Lock size={12} /> What WON'T work in PWA mode
                    </h3>
                    <ul className="list-disc pl-5 space-y-1 opacity-90">
                        <li>The microphone stops when the screen locks or the tab is fully backgrounded for too long. iOS Safari is the strictest.</li>
                        <li>True 24/7 background listening is not possible in any browser-based PWA — Apple and Google both kill background mic.</li>
                        <li>System-wide push notifications on iOS require iOS 16.4+ AND the PWA must be installed to Home Screen.</li>
                    </ul>
                </section>

                <section className="mb-1">
                    <h3 className="text-[#00ff41]/80 mb-1.5">Want always-on voice?</h3>
                    <p className="opacity-90">
                        The codebase is pre-wired for a <span className="text-[#00ff41]">Capacitor</span> native shell
                        (iOS + Android). See <code className="text-[#00ff41]/80">mobile/README.md</code> for
                        step-by-step. The wake-lock and lifecycle services are designed so the native bridge
                        slots in without any UI changes.
                    </p>
                </section>
            </div>
        </div>
    );
};

export default MobileLimitsInfo;
