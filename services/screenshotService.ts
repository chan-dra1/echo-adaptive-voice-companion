/**
 * screenshotService.ts
 *
 * Renders a URL to an actual image so Echo can SEE a page, not just read its
 * HTML. This is what makes "review the UI/UX of this site" a real capability
 * instead of a guess from markup — but it only works end-to-end because
 * llmRouter now accepts image parts (LlmMessage.images); before that, a
 * screenshot had nowhere to go.
 *
 * Providers are pluggable because there is no good keyless option:
 *   - 'echocore' : local headless Chrome via the Echo Core daemon. Free, no
 *                  API key, no third party sees the page — but requires Echo
 *                  Core running AND a headless browser installed there.
 *   - 'screenshotone' / 'apiflash' / 'urlbox' : hosted APIs. Reliable, work
 *                  from anywhere, need the user's own API key.
 *   - 'custom'   : any endpoint returning an image, with {url} templated in.
 *
 * PRIVACY NOTE worth stating plainly: with a hosted provider, the URL being
 * screenshotted is sent to that third party. For a public marketing site
 * that's fine; for an internal/authenticated page it is not, and the local
 * 'echocore' provider is the right choice there.
 */

export type ScreenshotProvider = 'echocore' | 'screenshotone' | 'apiflash' | 'urlbox' | 'custom';

const LS_PROVIDER = 'echo_screenshot_provider';
const LS_KEY = 'echo_screenshot_key';
const LS_CUSTOM_URL = 'echo_screenshot_custom_url';

export interface ScreenshotOptions {
    url: string;
    /** Viewport width in px. Default 1280 (desktop). Use 390 for mobile. */
    width?: number;
    height?: number;
    /** Capture the entire scrollable page rather than just the viewport. */
    fullPage?: boolean;
}

export interface ScreenshotResult {
    ok: boolean;
    /** Base64 WITHOUT the data: prefix — matches LlmImagePart.data. */
    data?: string;
    mimeType?: string;
    provider?: ScreenshotProvider;
    error?: string;
}

export function getScreenshotProvider(): ScreenshotProvider {
    const v = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_PROVIDER)) as ScreenshotProvider | null;
    if (v) return v;
    // No explicit choice yet. Echo Core has no screenshot endpoint today, so
    // defaulting to it would mean the feature always fails — if the user has
    // already set a hosted key, use that instead.
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) return 'screenshotone';
    return 'echocore';
}

export function hasScreenshotConfig(): boolean {
    const p = getScreenshotProvider();
    if (p === 'echocore') return true; // availability is checked at call time
    if (p === 'custom') return !!localStorage.getItem(LS_CUSTOM_URL);
    return !!localStorage.getItem(LS_KEY);
}

/** Build the provider's GET URL. Kept separate from the fetch so it's unit-testable. */
export function buildScreenshotUrl(opts: ScreenshotOptions): { url: string } | { error: string } {
    const provider = getScreenshotProvider();
    const key = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || '';
    const width = opts.width ?? 1280;
    const full = opts.fullPage !== false;
    const target = encodeURIComponent(opts.url);

    switch (provider) {
        case 'screenshotone':
            if (!key) return { error: 'No ScreenshotOne API key set. Add one in Settings → Screenshots.' };
            return {
                url: `https://api.screenshotone.com/take?access_key=${key}&url=${target}` +
                    `&viewport_width=${width}&full_page=${full}&format=png&block_ads=true&block_cookie_banners=true`,
            };
        case 'apiflash':
            if (!key) return { error: 'No ApiFlash access key set. Add one in Settings → Screenshots.' };
            return {
                url: `https://api.apiflash.com/v1/urltoimage?access_key=${key}&url=${target}` +
                    `&width=${width}&full_page=${full}&format=png&response_type=image`,
            };
        case 'urlbox':
            if (!key) return { error: 'No Urlbox key set. Add one in Settings → Screenshots.' };
            return { url: `https://api.urlbox.io/v1/${key}/png?url=${target}&width=${width}&full_page=${full}` };
        case 'custom': {
            const tpl = localStorage.getItem(LS_CUSTOM_URL) || '';
            if (!tpl) return { error: 'No custom screenshot endpoint configured.' };
            return { url: tpl.replace('{url}', target).replace('{width}', String(width)) };
        }
        default:
            return { error: `Provider ${provider} does not use a GET URL.` };
    }
}

async function blobToBase64(blob: Blob): Promise<string> {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    // Chunked to avoid blowing the argument limit on large screenshots.
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as any);
    }
    return btoa(binary);
}

export async function captureScreenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
    const provider = getScreenshotProvider();

    if (provider === 'echocore') {
        // Local capture through the Echo Core daemon. Imported lazily so the
        // web-only path doesn't pull in Core plumbing it never uses.
        try {
            const mod: any = await import('./echoCoreSync');
            const isCoreConnected = mod.isCoreConnected;
            // Looked up dynamically, NOT imported by name: Echo Core does not
            // currently implement a screenshot endpoint, so a static import
            // wouldn't compile. This lets the feature light up automatically
            // if/when Core gains `coreScreenshot`, without shipping a broken
            // import today.
            const coreScreenshot = mod.coreScreenshot;
            if (!isCoreConnected()) {
                return {
                    ok: false,
                    provider,
                    error: 'Echo Core is not running, so local screenshots are unavailable. Start Echo Core, ' +
                        'or set a hosted screenshot provider + API key in Settings → Screenshots.',
                };
            }
            if (typeof coreScreenshot !== 'function') {
                return {
                    ok: false,
                    provider,
                    error: 'This Echo Core build has no screenshot support (needs a headless browser installed ' +
                        'on the Core side). Use a hosted provider in Settings → Screenshots instead.',
                };
            }
            const r = await coreScreenshot(opts.url, { width: opts.width ?? 1280, fullPage: opts.fullPage !== false });
            if (!r?.ok || !r.data) return { ok: false, provider, error: r?.error || 'Core screenshot failed.' };
            return { ok: true, provider, data: r.data, mimeType: r.mimeType || 'image/png' };
        } catch (e: any) {
            return { ok: false, provider, error: e?.message || 'Local screenshot failed.' };
        }
    }

    const built = buildScreenshotUrl(opts);
    if ('error' in built) return { ok: false, provider, error: built.error };

    try {
        const res = await fetch(built.url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, provider, error: `Screenshot API returned ${res.status}. ${body.slice(0, 200)}` };
        }
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) {
            const asText = await blob.text().catch(() => '');
            return { ok: false, provider, error: `Expected an image, got ${blob.type}. ${asText.slice(0, 200)}` };
        }
        return { ok: true, provider, data: await blobToBase64(blob), mimeType: blob.type || 'image/png' };
    } catch (e: any) {
        return { ok: false, provider, error: e?.message || 'Screenshot request failed.' };
    }
}
