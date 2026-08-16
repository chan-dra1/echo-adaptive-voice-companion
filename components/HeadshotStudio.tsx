/**
 * HeadshotStudio.tsx
 *
 * Take a reference photo with your camera (the same permission Echo's
 * video mode already uses), generate a professional headshot from it via
 * Gemini image generation, and keep a private gallery of the results.
 * Everything — the reference photo and every generated headshot — is
 * encrypted with the app's vault key and stored locally in IndexedDB
 * (services/headshotService.ts); nothing is ever deleted except by an
 * explicit click, and the only network call is the one Gemini request to
 * generate the image.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, RefreshCw, Download, Trash2, Sparkles, ImageOff, AlertTriangle } from 'lucide-react';
import { generateGeminiImage, hasGeminiKey } from '../services/geminiImageService';
import { saveHeadshot, listHeadshots, deleteHeadshot, type Headshot } from '../services/headshotService';

interface Props {
    onClose: () => void;
}

interface Style {
    key: string;
    label: string;
    prompt: string;
}

const STYLES: Style[] = [
    {
        key: 'corporate',
        label: 'Corporate',
        prompt: 'a polished corporate headshot: dark business suit, neutral gray studio background, soft even studio lighting, confident friendly expression, shoulders-up crop, sharp focus',
    },
    {
        key: 'casual',
        label: 'Casual professional',
        prompt: 'a warm casual-professional headshot: smart-casual outfit, softly blurred modern office background, natural window lighting, genuine relaxed smile, shoulders-up crop',
    },
    {
        key: 'linkedin',
        label: 'LinkedIn-ready',
        prompt: 'a clean LinkedIn-style profile headshot: business casual attire, plain light-gray or white background, bright even lighting, approachable confident expression, centered shoulders-up crop',
    },
    {
        key: 'creative',
        label: 'Creative industry',
        prompt: 'a modern creative-industry headshot: stylish contemporary outfit, softly lit textured background with subtle color, engaged natural expression, editorial-quality shoulders-up crop',
    },
];

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'error';
type GenState = 'idle' | 'generating' | 'error';

export default function HeadshotStudio({ onClose }: Props) {
    const [cameraState, setCameraState] = useState<CameraState>('idle');
    const [cameraError, setCameraError] = useState('');
    const [capturedPhoto, setCapturedPhoto] = useState<{ data: string; mimeType: string; url: string } | null>(null);
    const [selectedStyle, setSelectedStyle] = useState<Style>(STYLES[0]);
    const [genState, setGenState] = useState<GenState>('idle');
    const [genError, setGenError] = useState('');
    const [result, setResult] = useState<{ data: string; mimeType: string; url: string } | null>(null);
    const [gallery, setGallery] = useState<Headshot[]>([]);
    const [galleryLoading, setGalleryLoading] = useState(true);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const refreshGallery = async () => {
        setGalleryLoading(true);
        try {
            setGallery(await listHeadshots());
        } finally {
            setGalleryLoading(false);
        }
    };

    useEffect(() => {
        refreshGallery();
        return () => {
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    const startCamera = async () => {
        setCameraState('starting');
        setCameraError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setCameraState('live');
        } catch (e: any) {
            setCameraState(e?.name === 'NotAllowedError' ? 'denied' : 'error');
            setCameraError(e?.message || 'Could not access the camera.');
        }
    };

    const stopCamera = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setCameraState('idle');
    };

    const capturePhoto = () => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;
        const canvas = document.createElement('canvas');
        // A real one-shot capture, not the ~480px/heavily-compressed frames
        // geminiLiveService streams during a live voice session — those are
        // throttled for bandwidth and never kept, so this is a fresh capture.
        const maxDim = 900;
        let w = video.videoWidth, h = video.videoHeight;
        if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const data = dataUrl.split(',')[1] || '';
        setCapturedPhoto({ data, mimeType: 'image/jpeg', url: dataUrl });
        setResult(null);
        setGenError('');
        stopCamera();
    };

    const retake = () => {
        setCapturedPhoto(null);
        setResult(null);
        setGenError('');
        startCamera();
    };

    const generate = async () => {
        if (!capturedPhoto) return;
        setGenState('generating');
        setGenError('');
        try {
            const prompt = `Using the attached reference photo, generate ${selectedStyle.prompt}. Keep the person's actual facial identity, features, and skin tone faithful to the reference photo — this is a professional headshot photo, not an illustration or cartoon. Photorealistic, high quality, single subject.`;
            const res = await generateGeminiImage(prompt, [{ data: capturedPhoto.data, mimeType: capturedPhoto.mimeType }]);
            setResult({ data: res.imageBase64, mimeType: res.mimeType, url: `data:${res.mimeType};base64,${res.imageBase64}` });
            setGenState('idle');
        } catch (e: any) {
            setGenState('error');
            setGenError(e?.message || 'Generation failed — try again.');
        }
    };

    const saveResult = async () => {
        if (!result || !capturedPhoto) return;
        await saveHeadshot({
            imageBase64: result.data,
            mimeType: result.mimeType,
            style: selectedStyle.label,
            sourceBase64: capturedPhoto.data,
            sourceMimeType: capturedPhoto.mimeType,
        });
        setResult(null);
        setCapturedPhoto(null);
        await refreshGallery();
    };

    const downloadHeadshot = (h: Headshot) => {
        const a = document.createElement('a');
        a.href = h.imageUrl;
        a.download = `echo-headshot-${h.style.toLowerCase().replace(/\s+/g, '-')}-${h.id.slice(0, 8)}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const removeHeadshot = async (id: string) => {
        await deleteHeadshot(id);
        setGallery(g => g.filter(h => h.id !== id));
    };

    const noKey = !hasGeminiKey();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl transition-opacity" onClick={onClose} />

            <div className="relative w-full max-w-2xl term-window animate-phosphor-in max-h-[90dvh] flex flex-col">
                <div className="term-titlebar justify-between shrink-0 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="term-dots" />
                        <span className="truncate">Headshot Studio</span>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close headshot studio"
                        className="p-1.5 rounded border border-[var(--border-dim)] bg-[rgba(0,255,65,0.04)] text-[var(--text-tertiary)] hover:text-[var(--accent-green)] hover:border-[var(--border-green)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="relative z-10 overflow-y-auto scrollbar-hide p-4 space-y-4">
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        Take a photo with your camera, pick a style, and Echo generates a professional
                        headshot with your own Gemini key — the same one used for chat and voice, no extra
                        API key needed. Your photo and every headshot are encrypted and stay on this device
                        until you delete them.
                    </p>

                    {noKey && (
                        <div className="rounded-lg border border-[var(--accent-amber)] bg-[rgba(255,179,0,0.06)] p-3 flex items-start gap-2">
                            <AlertTriangle size={14} className="text-[var(--accent-amber)] mt-0.5 shrink-0" />
                            <p className="text-xs text-[var(--text-secondary)]">
                                No Gemini key saved yet — add one in Settings (it's free) before generating a headshot.
                            </p>
                        </div>
                    )}

                    {/* ── Capture / preview area ─────────────────────────────── */}
                    <div className="rounded-lg border border-[var(--border-dim)] bg-[rgba(0,255,65,0.02)] p-3">
                        {!capturedPhoto && (
                            <div className="flex flex-col items-center">
                                <div className="relative w-full max-w-xs aspect-square rounded-lg overflow-hidden bg-black/40 border border-[var(--border-dim)] flex items-center justify-center">
                                    <video
                                        ref={videoRef}
                                        className={`w-full h-full object-cover ${cameraState === 'live' ? '' : 'hidden'}`}
                                        muted
                                        playsInline
                                    />
                                    {cameraState !== 'live' && (
                                        <div className="flex flex-col items-center gap-2 p-4 text-center">
                                            <Camera size={28} className="text-[var(--text-tertiary)]" />
                                            {cameraState === 'denied' && (
                                                <p className="text-[11px] text-[var(--accent-red)]">Camera access denied — allow it in your browser's site settings, then try again.</p>
                                            )}
                                            {cameraState === 'error' && (
                                                <p className="text-[11px] text-[var(--accent-red)]">{cameraError}</p>
                                            )}
                                            {(cameraState === 'idle' || cameraState === 'starting') && (
                                                <p className="text-[11px] text-[var(--text-tertiary)]">
                                                    {cameraState === 'starting' ? 'Starting camera…' : 'No photo yet'}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-3 flex gap-2">
                                    {cameraState !== 'live' ? (
                                        <button onClick={startCamera} disabled={cameraState === 'starting'} className="btn-term solid text-xs px-4 py-2 flex items-center gap-2">
                                            <Camera size={14} /> {cameraState === 'starting' ? 'Starting…' : 'Open camera'}
                                        </button>
                                    ) : (
                                        <>
                                            <button onClick={capturePhoto} className="btn-term solid text-xs px-4 py-2 flex items-center gap-2">
                                                <Camera size={14} /> Capture photo
                                            </button>
                                            <button onClick={stopCamera} className="btn-term ghost text-xs px-4 py-2">Cancel</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {capturedPhoto && !result && (
                            <div className="flex flex-col items-center">
                                <img src={capturedPhoto.url} alt="Reference photo" className="w-full max-w-xs aspect-square object-cover rounded-lg border border-[var(--border-dim)]" />

                                <div className="mt-3 w-full max-w-xs">
                                    <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1.5">Style</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {STYLES.map(s => (
                                            <button
                                                key={s.key}
                                                onClick={() => setSelectedStyle(s)}
                                                className={`text-xs px-2.5 py-2 rounded-md border transition-colors text-left ${selectedStyle.key === s.key
                                                    ? 'border-[var(--accent-green)] text-[var(--accent-green)] bg-[rgba(0,255,65,0.06)]'
                                                    : 'border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--border-green)]'
                                                    }`}
                                            >
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {genError && (
                                    <p className="mt-3 text-xs text-[var(--accent-red)] text-center max-w-xs">{genError}</p>
                                )}

                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={generate}
                                        disabled={genState === 'generating' || noKey}
                                        className="btn-term solid text-xs px-4 py-2 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {genState === 'generating' ? (
                                            <><RefreshCw size={14} className="animate-spin" /> Generating…</>
                                        ) : (
                                            <><Sparkles size={14} /> Generate headshot</>
                                        )}
                                    </button>
                                    <button onClick={retake} disabled={genState === 'generating'} className="btn-term ghost text-xs px-4 py-2">Retake</button>
                                </div>
                            </div>
                        )}

                        {result && (
                            <div className="flex flex-col items-center">
                                <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-1 text-center">Reference</p>
                                        <img src={capturedPhoto!.url} alt="Reference" className="w-full aspect-square object-cover rounded-lg border border-[var(--border-dim)] opacity-70" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--accent-green)] mb-1 text-center">Generated</p>
                                        <img src={result.url} alt="Generated headshot" className="w-full aspect-square object-cover rounded-lg border border-[var(--border-green)]" />
                                    </div>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <button onClick={saveResult} className="btn-term solid text-xs px-4 py-2">Save to my headshots</button>
                                    <button onClick={generate} className="btn-term ghost text-xs px-4 py-2 flex items-center gap-1.5">
                                        <RefreshCw size={12} /> Try again
                                    </button>
                                    <button onClick={retake} className="btn-term ghost text-xs px-4 py-2">Retake photo</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Gallery ─────────────────────────────────────────────── */}
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-2">
                            Your headshots {gallery.length > 0 ? `(${gallery.length})` : ''}
                        </p>
                        {galleryLoading ? (
                            <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
                        ) : gallery.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-6 text-center text-[var(--text-tertiary)]">
                                <ImageOff size={20} />
                                <p className="text-xs">No headshots saved yet — generate one above.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {gallery.map(h => (
                                    <div key={h.id} className="group relative rounded-lg overflow-hidden border border-[var(--border-dim)]">
                                        <img src={h.imageUrl} alt={h.style} className="w-full aspect-square object-cover" />
                                        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                                            <p className="text-[9px] text-[var(--text-secondary)] px-1 text-center">{h.style}</p>
                                            <div className="flex gap-1.5">
                                                <button onClick={() => downloadHeadshot(h)} aria-label="Download headshot" className="p-1.5 rounded bg-[rgba(0,255,65,0.15)] text-[var(--accent-green)] hover:bg-[rgba(0,255,65,0.25)]">
                                                    <Download size={12} />
                                                </button>
                                                <button onClick={() => removeHeadshot(h.id)} aria-label="Delete headshot" className="p-1.5 rounded bg-[rgba(255,60,60,0.15)] text-[var(--accent-red)] hover:bg-[rgba(255,60,60,0.25)]">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
