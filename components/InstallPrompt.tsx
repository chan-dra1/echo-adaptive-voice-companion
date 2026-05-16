import React, { useEffect, useState, useCallback } from 'react';
import { Download, Share, X, Info } from 'lucide-react';
import MobileLimitsInfo from './MobileLimitsInfo';

// MOBILE-AGENT: Tiny, dismissible PWA install prompt for Android (beforeinstallprompt)
// and a one-shot iOS "Add to Home Screen" hint, because iOS Safari doesn't fire BIP.

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY_ANDROID = 'echo_install_dismissed_v1';
const DISMISS_KEY_IOS = 'echo_install_ios_hint_dismissed_v1';

function isIosSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    return isIos && isSafari;
}

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    // iOS Safari uses navigator.standalone, others use matchMedia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iosStandalone = (window.navigator as any).standalone === true;
    const displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches
        || window.matchMedia?.('(display-mode: window-controls-overlay)').matches;
    return iosStandalone || !!displayStandalone;
}

const InstallPrompt: React.FC = () => {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [showAndroid, setShowAndroid] = useState(false);
    const [showIos, setShowIos] = useState(false);
    const [showLimits, setShowLimits] = useState(false);

    useEffect(() => {
        if (isStandalone()) return; // already installed
        // Android / Chromium / Edge
        const handler = (e: Event) => {
            e.preventDefault();
            if (localStorage.getItem(DISMISS_KEY_ANDROID)) return;
            setDeferred(e as BeforeInstallPromptEvent);
            setShowAndroid(true);
        };
        window.addEventListener('beforeinstallprompt', handler as any);

        // iOS one-shot hint
        if (isIosSafari() && !localStorage.getItem(DISMISS_KEY_IOS)) {
            // Delay slightly so it doesn't blast on first paint
            const t = window.setTimeout(() => setShowIos(true), 4000);
            return () => {
                window.removeEventListener('beforeinstallprompt', handler as any);
                window.clearTimeout(t);
            };
        }

        return () => window.removeEventListener('beforeinstallprompt', handler as any);
    }, []);

    const handleInstall = useCallback(async () => {
        if (!deferred) return;
        try {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === 'accepted') {
                setShowAndroid(false);
            }
        } catch {
            /* user cancelled */
        } finally {
            setDeferred(null);
        }
    }, [deferred]);

    const dismissAndroid = () => {
        localStorage.setItem(DISMISS_KEY_ANDROID, '1');
        setShowAndroid(false);
    };
    const dismissIos = () => {
        localStorage.setItem(DISMISS_KEY_IOS, '1');
        setShowIos(false);
    };

    if (!showAndroid && !showIos) return null;

    return (
        <>
            {showAndroid && (
                <div
                    className="pwa-only-install-hint fixed bottom-4 right-4 z-[60] flex items-center gap-2 pl-3 pr-2 py-2 rounded-full bg-[#00ff41]/15 border border-[#00ff41]/40 backdrop-blur-md shadow-lg text-[#00ff41] text-xs font-mono"
                    role="dialog"
                    aria-label="Install Echo"
                >
                    <button
                        onClick={handleInstall}
                        className="flex items-center gap-1.5 hover:opacity-90"
                    >
                        <Download size={14} />
                        Install Echo
                    </button>
                    <button
                        onClick={() => setShowLimits(true)}
                        className="opacity-70 hover:opacity-100"
                        aria-label="Mobile limits info"
                    >
                        <Info size={12} />
                    </button>
                    <button
                        onClick={dismissAndroid}
                        className="opacity-60 hover:opacity-100"
                        aria-label="Dismiss"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {showIos && (
                <div
                    className="pwa-only-install-hint fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-[92%] flex items-center gap-2 pl-3 pr-2 py-2 rounded-2xl bg-black/80 border border-[#00ff41]/30 backdrop-blur-md shadow-lg text-[#00ff41] text-[11px] font-mono"
                    role="dialog"
                    aria-label="Add Echo to Home Screen"
                >
                    <Share size={14} />
                    <span>Tap Share → Add to Home Screen</span>
                    <button
                        onClick={() => setShowLimits(true)}
                        className="opacity-70 hover:opacity-100"
                        aria-label="Mobile limits info"
                    >
                        <Info size={12} />
                    </button>
                    <button
                        onClick={dismissIos}
                        className="opacity-60 hover:opacity-100"
                        aria-label="Dismiss"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {showLimits && <MobileLimitsInfo onClose={() => setShowLimits(false)} />}
        </>
    );
};

export default InstallPrompt;
