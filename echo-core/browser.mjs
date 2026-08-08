/**
 * browser.mjs — real browser automation for Echo Core.
 *
 * WHY THIS EXISTS: Echo's existing web tools (read_webpage, browse_website,
 * screenshot_page) fetch static HTML through a CORS proxy. That works for
 * server-rendered content but is blind to anything a modern site builds with
 * JavaScript after load — React/Vue apps, infinite scroll, content behind a
 * click, anything needing a login. This module drives a REAL Chromium via
 * Playwright, so Echo sees the page a human actually sees.
 *
 * DESKTOP-ONLY BY NATURE: this spawns and controls an external browser
 * process. iOS/Android app sandboxes forbid that outright, so this is a
 * capability the desktop/Core build has and the mobile builds structurally
 * cannot. Callers must degrade gracefully rather than assume it exists.
 *
 * PLAYWRIGHT IS AN OPTIONAL DEPENDENCY. It is a large install (~300MB with
 * browser binaries), and Echo Core is otherwise tiny and dependency-light.
 * Everything here is written so that a Core install WITHOUT playwright keeps
 * working normally and just reports this one capability as unavailable —
 * see ensureBrowser(). Never top-level-import playwright.
 */

/** One shared browser + page. A single reusable session is deliberate: it
 *  preserves cookies/login state across tool calls, which is what makes
 *  multi-step flows ("log in, then go to settings") actually work. */
let _browser = null;
let _context = null;
let _page = null;
let _playwrightMissing = false;

const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 15_000;
/** Cap on returned text so a huge page can't blow the model's context. */
const MAX_TEXT_CHARS = 30_000;

/**
 * Lazily start Chromium. Returns { ok } or { ok:false, error } — never throws
 * for the "playwright isn't installed" case, since that's an expected
 * configuration state, not a bug.
 */
async function ensureBrowser() {
    if (_page && !_page.isClosed()) return { ok: true };
    if (_playwrightMissing) {
        return { ok: false, error: PLAYWRIGHT_MISSING_MSG };
    }

    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch {
        _playwrightMissing = true;
        return { ok: false, error: PLAYWRIGHT_MISSING_MSG };
    }

    try {
        _browser = await chromium.launch({ headless: true });
        _context = await _browser.newContext({
            viewport: { width: 1280, height: 900 },
            // A real UA: some sites serve degraded markup to headless defaults.
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        });
        _page = await _context.newPage();
        _page.setDefaultTimeout(ACTION_TIMEOUT_MS);
        _page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `Could not launch Chromium: ${e.message}. Try: npx playwright install chromium` };
    }
}

const PLAYWRIGHT_MISSING_MSG =
    'Browser automation is not installed. In the echo-core directory run:\n' +
    '  npm install playwright && npx playwright install chromium\n' +
    '(~300MB. Without it, Echo can still read pages as static HTML via read_webpage.)';

export async function browserNavigate({ url }) {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    if (!url) return { ok: false, error: 'No url provided.' };
    try {
        // 'domcontentloaded' rather than 'networkidle': many real sites keep
        // long-lived connections (analytics, websockets) open forever and
        // never reach networkidle, which would spuriously time out.
        const res = await _page.goto(url, { waitUntil: 'domcontentloaded' });
        return {
            ok: true,
            url: _page.url(),
            title: await _page.title(),
            status: res?.status() ?? null,
        };
    } catch (e) {
        return { ok: false, error: `Navigation failed: ${e.message}` };
    }
}

/** Readable text of the current page, with script/style/nav chrome stripped. */
export async function browserReadPage() {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    try {
        const text = await _page.evaluate(() => {
            const clone = document.body.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
            return clone.innerText || '';
        });
        const clean = text.replace(/\n{3,}/g, '\n\n').trim();
        return {
            ok: true,
            url: _page.url(),
            title: await _page.title(),
            text: clean.slice(0, MAX_TEXT_CHARS),
            truncated: clean.length > MAX_TEXT_CHARS,
        };
    } catch (e) {
        return { ok: false, error: `Could not read page: ${e.message}` };
    }
}

/**
 * Interactive elements with stable indices the model can act on. Returning an
 * index-addressed list (rather than expecting the model to invent CSS
 * selectors) is what makes clicking reliable — a guessed selector usually
 * misses, an index from this list does not.
 */
export async function browserListElements() {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    try {
        const elements = await _page.evaluate(() => {
            const sel = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick]';
            const out = [];
            document.querySelectorAll(sel).forEach((el, i) => {
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return; // skip hidden
                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return;
                out.push({
                    index: out.length,
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || undefined,
                    text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
                        .trim().slice(0, 100),
                    href: el.getAttribute('href') || undefined,
                });
            });
            return out.slice(0, 200);
        });
        return { ok: true, url: _page.url(), count: elements.length, elements };
    } catch (e) {
        return { ok: false, error: `Could not list elements: ${e.message}` };
    }
}

/** Resolve either an index (from browserListElements) or a raw CSS selector. */
async function resolveTarget({ index, selector }) {
    if (typeof index === 'number') {
        const handles = await _page.$$(
            'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick]'
        );
        // Re-filter to visible, mirroring browserListElements' indexing so the
        // model's index means the same thing here as it did there.
        const visible = [];
        for (const h of handles) {
            const box = await h.boundingBox();
            if (box && box.width > 0 && box.height > 0) visible.push(h);
        }
        if (index < 0 || index >= visible.length) {
            return { error: `Element index ${index} out of range (${visible.length} interactive elements). Re-run list_page_elements — the page may have changed.` };
        }
        return { handle: visible[index] };
    }
    if (selector) {
        const h = await _page.$(selector);
        if (!h) return { error: `No element matched selector: ${selector}` };
        return { handle: h };
    }
    return { error: 'Provide either index (from list_page_elements) or selector.' };
}

export async function browserClick({ index, selector }) {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    try {
        const t = await resolveTarget({ index, selector });
        if (t.error) return { ok: false, error: t.error };
        const before = _page.url();
        await t.handle.click({ timeout: ACTION_TIMEOUT_MS });
        // Give a click that triggers navigation a moment to actually land, but
        // don't fail the click if it was an in-page action with no navigation.
        await _page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        return { ok: true, urlBefore: before, url: _page.url(), navigated: before !== _page.url() };
    } catch (e) {
        return { ok: false, error: `Click failed: ${e.message}` };
    }
}

export async function browserFill({ index, selector, text, submit }) {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    try {
        const t = await resolveTarget({ index, selector });
        if (t.error) return { ok: false, error: t.error };
        await t.handle.fill(String(text ?? ''), { timeout: ACTION_TIMEOUT_MS });
        if (submit) {
            await t.handle.press('Enter');
            await _page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
        }
        return { ok: true, url: _page.url(), submitted: !!submit };
    } catch (e) {
        return { ok: false, error: `Fill failed: ${e.message}` };
    }
}

/** Screenshot of the LIVE rendered page (JS executed), as base64 PNG. */
export async function browserScreenshot({ fullPage = true } = {}) {
    const ready = await ensureBrowser();
    if (!ready.ok) return { ok: false, error: ready.error };
    try {
        const buf = await _page.screenshot({ fullPage: !!fullPage, type: 'png' });
        return { ok: true, url: _page.url(), data: buf.toString('base64'), mimeType: 'image/png' };
    } catch (e) {
        return { ok: false, error: `Screenshot failed: ${e.message}` };
    }
}

/** Close the browser and free memory. Safe to call when nothing is running. */
export async function browserClose() {
    try { await _page?.close(); } catch { /* already gone */ }
    try { await _context?.close(); } catch { /* already gone */ }
    try { await _browser?.close(); } catch { /* already gone */ }
    _page = _context = _browser = null;
    return { ok: true };
}

/** Whether automation is usable, without launching anything heavyweight. */
export async function browserAvailable() {
    if (_playwrightMissing) return { ok: false, available: false, error: PLAYWRIGHT_MISSING_MSG };
    try {
        await import('playwright');
        return { ok: true, available: true };
    } catch {
        _playwrightMissing = true;
        return { ok: false, available: false, error: PLAYWRIGHT_MISSING_MSG };
    }
}
