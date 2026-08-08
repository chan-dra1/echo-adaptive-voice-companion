import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { isCoreConnected, coreBrowser, CoreBrowserAction } from '../services/echoCoreSync';

/**
 * browserSkill — drives a REAL Chromium (via Echo Core + Playwright) instead
 * of fetching static HTML.
 *
 * The existing webSkill tools (read_webpage / browse_website / screenshot_page)
 * pull raw HTML through a CORS proxy. That's fine for server-rendered pages
 * and needs no setup, so it stays the default. This skill is the heavier,
 * more capable path: it executes the page's JavaScript, so it can see SPA
 * content, click through flows, fill forms, and stay logged in across steps.
 *
 * Availability is genuinely conditional — Echo Core must be running AND
 * playwright installed there — so every tool description below tells the
 * model to fall back to the webSkill equivalents rather than give up.
 */

const OFFLINE_MSG =
    'Browser automation needs Echo Core running locally (desktop only). ' +
    'Start it, or use read_webpage / browse_website for static page reading instead.';

const navigateDeclaration: FunctionDeclaration = {
    name: 'browser_navigate',
    description:
        'Open a URL in a REAL browser that runs the page\'s JavaScript. Use this instead of read_webpage when ' +
        'the page is a web app, needs login, renders content after load, or you intend to click/type on it. ' +
        'The browser keeps cookies and stays on this page for follow-up calls, so you can navigate then act. ' +
        'Requires Echo Core (desktop) — if unavailable, fall back to read_webpage.',
    parameters: {
        type: Type.OBJECT,
        properties: { url: { type: Type.STRING, description: 'Full URL including https://' } },
        required: ['url'],
    },
};

const readPageDeclaration: FunctionDeclaration = {
    name: 'browser_read_page',
    description:
        'Read the visible text of the page currently open in the browser, AFTER JavaScript has run. ' +
        'Call browser_navigate first. Use to check the result of a click, read a dynamic app, or extract content ' +
        'a static fetch would miss.',
    parameters: { type: Type.OBJECT, properties: {} },
};

const listElementsDeclaration: FunctionDeclaration = {
    name: 'list_page_elements',
    description:
        'List the clickable/typeable elements on the current page, each with a stable index. ' +
        'ALWAYS call this before browser_click or browser_fill and use the returned index — do not guess CSS ' +
        'selectors, they usually miss. Re-run it after the page changes, since indices shift.',
    parameters: { type: Type.OBJECT, properties: {} },
};

const clickDeclaration: FunctionDeclaration = {
    name: 'browser_click',
    description:
        'Click an element on the current page. Prefer `index` from a recent list_page_elements call. ' +
        'Returns whether the click caused navigation.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            index: { type: Type.NUMBER, description: 'Index from list_page_elements (preferred).' },
            selector: { type: Type.STRING, description: 'CSS selector, only if you have an exact known one.' },
        },
    },
};

const fillDeclaration: FunctionDeclaration = {
    name: 'browser_fill',
    description:
        'Type text into an input/textarea on the current page. Prefer `index` from list_page_elements. ' +
        'Set submit=true to press Enter afterwards (e.g. a search box).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            index: { type: Type.NUMBER, description: 'Index from list_page_elements (preferred).' },
            selector: { type: Type.STRING, description: 'CSS selector, only if exactly known.' },
            text: { type: Type.STRING, description: 'Text to type into the field.' },
            submit: { type: Type.BOOLEAN, description: 'Press Enter after typing. Default false.' },
        },
        required: ['text'],
    },
};

const screenshotDeclaration: FunctionDeclaration = {
    name: 'browser_screenshot',
    description:
        'Screenshot the LIVE rendered page currently open in the browser, so you can SEE it — layout, styling, ' +
        'visual bugs. Better than screenshot_page for anything JavaScript-rendered or behind a login, and needs ' +
        'no third-party screenshot API key. Call browser_navigate first.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            fullPage: { type: Type.BOOLEAN, description: 'Capture the whole scrollable page. Default true.' },
        },
    },
};

const closeDeclaration: FunctionDeclaration = {
    name: 'browser_close',
    description:
        'Close the automated browser and free its memory. Call when finished with a browsing session. ' +
        'This also clears cookies/login state, so do not call it mid-flow.',
    parameters: { type: Type.OBJECT, properties: {} },
};

/** Maps each tool name to the Core action it forwards to. */
const TOOL_TO_ACTION: Record<string, CoreBrowserAction> = {
    browser_navigate: 'navigate',
    browser_read_page: 'read_page',
    list_page_elements: 'list_elements',
    browser_click: 'click',
    browser_fill: 'fill',
    browser_screenshot: 'screenshot',
    browser_close: 'close',
};

export const browserSkill: Skill = {
    name: 'browserSkill',
    description: 'Control a real browser (navigate, click, type, screenshot) via Echo Core + Playwright.',
    tools: [
        navigateDeclaration,
        readPageDeclaration,
        listElementsDeclaration,
        clickDeclaration,
        fillDeclaration,
        screenshotDeclaration,
        closeDeclaration,
    ],

    execute: async (toolName: string, args: any) => {
        const action = TOOL_TO_ACTION[toolName];
        if (!action) return { error: `Unknown tool: ${toolName}` };
        if (!isCoreConnected()) return { error: OFFLINE_MSG };

        const result = await coreBrowser(action, args || {});
        if (!result?.ok) return { error: result?.error || 'Browser action failed.' };

        // Screenshots come back as base64 and must be lifted into a real
        // multimodal message — echoChatService looks for this exact __image
        // envelope (same contract screenshot_page uses). Returning raw base64
        // inside the tool-result JSON would just be unreadable text.
        if (action === 'screenshot' && result.data) {
            return {
                __image: { data: result.data, mimeType: result.mimeType || 'image/png' },
                url: result.url,
                note: 'Live screenshot captured — the image is attached for you to look at.',
            };
        }

        const { ok, ...rest } = result;
        return rest;
    },
};

export default browserSkill;
