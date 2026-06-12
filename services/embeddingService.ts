/**
 * embeddingService.ts
 *
 * Runs the all-MiniLM-L6-v2 embedding model entirely in the browser.
 * Uses @huggingface/transformers (v4) with WebGPU acceleration when the
 * browser supports it, falling back to WASM otherwise. No server, no
 * API key, fully offline.
 *
 * Model:   Xenova/all-MiniLM-L6-v2
 * Output:  384-dimensional float32 vectors
 * Size:    ~6 MB quantized (downloaded once, cached in browser Cache API)
 * Speed:   WebGPU ~2-10ms per chunk · WASM ~20-80ms per chunk
 *
 * Usage:
 *   const vec = await embed("tell me about machine learning");
 *   const sim = cosineSim(vec, otherVec); // -1..1, higher = more similar
 */

// Dynamic import so the WASM bundle is lazy-loaded — doesn't block app startup
let pipelinePromise: Promise<any> | null = null;
let _embed: ((text: string) => Promise<Float32Array>) | null = null;

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
let loadStatus: LoadStatus = 'idle';
const statusListeners: ((s: LoadStatus) => void)[] = [];

function broadcastStatus(s: LoadStatus) {
    loadStatus = s;
    statusListeners.forEach(fn => fn(s));
}

export function getEmbeddingStatus(): LoadStatus {
    return loadStatus;
}

export function onEmbeddingStatusChange(fn: (s: LoadStatus) => void): () => void {
    statusListeners.push(fn);
    return () => { const i = statusListeners.indexOf(fn); if (i >= 0) statusListeners.splice(i, 1); };
}

/**
 * Lazily initialize the embedding pipeline.
 * Safe to call multiple times — returns the same promise.
 */
async function getPipeline(): Promise<(text: string) => Promise<Float32Array>> {
    if (_embed) return _embed;
    if (pipelinePromise) return pipelinePromise.then(() => _embed!);

    broadcastStatus('loading');

    pipelinePromise = (async () => {
        try {
            // Dynamic import keeps the ML bundle out of initial page load
            const { pipeline, env } = await import('@huggingface/transformers');

            // Use local cache — model downloads once, stored in browser Cache API
            env.allowLocalModels = false;
            env.useBrowserCache  = true;

            // WebGPU when available (sub-10ms embeds), WASM fallback otherwise
            const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
            let extractor: any;
            try {
                extractor = await pipeline(
                    'feature-extraction',
                    'Xenova/all-MiniLM-L6-v2',
                    { device: hasWebGPU ? 'webgpu' : 'wasm', dtype: 'q8' },
                );
                console.log(`[embeddingService] Model loaded on ${hasWebGPU ? 'WebGPU' : 'WASM'}`);
            } catch (gpuErr) {
                // WebGPU init can fail on some drivers — retry on WASM
                if (!hasWebGPU) throw gpuErr;
                console.warn('[embeddingService] WebGPU init failed, falling back to WASM:', gpuErr);
                extractor = await pipeline(
                    'feature-extraction',
                    'Xenova/all-MiniLM-L6-v2',
                    { device: 'wasm', dtype: 'q8' },
                );
            }

            _embed = async (text: string): Promise<Float32Array> => {
                const output = await extractor(text, {
                    pooling: 'mean',
                    normalize: true,
                });
                // output.data is a Float32Array of length 384
                return output.data as Float32Array;
            };

            broadcastStatus('ready');
            return _embed;
        } catch (err) {
            broadcastStatus('error');
            console.error('[embeddingService] Failed to load model:', err);
            throw err;
        }
    })();

    return pipelinePromise.then(() => _embed!);
}

/**
 * Embed a string. Auto-initializes the model on first call.
 * Returns a 384-dim Float32Array.
 */
export async function embed(text: string): Promise<Float32Array> {
    const fn = await getPipeline();
    // Truncate to ~512 tokens worth of chars (MiniLM limit)
    const truncated = text.slice(0, 2048);
    return fn(truncated);
}

/**
 * Pre-warm the model in the background so the first real query is instant.
 * Call this after vault unlock.
 */
export function warmEmbeddingModel(): void {
    if (loadStatus === 'idle') {
        getPipeline().catch(() => {}); // fire-and-forget
    }
}

/**
 * Cosine similarity between two normalized vectors (both from embed()).
 * Returns 0..1 since MiniLM outputs are L2-normalized.
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(0, Math.min(1, dot)); // clamp rounding errors
}

/**
 * Serialize a Float32Array to a compact base64 string for IndexedDB storage.
 */
export function serializeVec(vec: Float32Array): string {
    const buf = new Uint8Array(vec.buffer);
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
}

/**
 * Deserialize a base64 string back to Float32Array.
 */
export function deserializeVec(b64: string): Float32Array {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Float32Array(buf.buffer);
}
