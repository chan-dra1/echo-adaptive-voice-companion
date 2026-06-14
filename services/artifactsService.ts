/**
 * artifactsService.ts — single source of truth for everything Echo generates,
 * plus download helpers (individual files + bulk .zip).
 *
 * Sources:
 *   - drafts     : browser store 'echo_drafts'   (encrypted at rest)
 *   - campaigns  : browser store 'echo_campaigns' (encrypted at rest)
 *   - projects   : ~/EchoProjects on disk, via the Hands daemon (optional)
 *
 * The zip writer is a dependency-free STORE-method (no compression) packer —
 * enough to bundle text artifacts into one downloadable archive.
 */

import { getCached } from './cryptoService';
import { isHandsConnected, handsCall } from './handsBridgeService';
import type { StoredCampaign } from './campaignStudioService';

export interface DraftItem { id: string; kind: string; title: string; content: string; createdAt: number; }
export interface ArtifactFile { name: string; content: string; }

/* ── sources ── */

export function getDrafts(): DraftItem[] {
    try { return getCached<DraftItem[]>('echo_drafts', []).slice().reverse(); } catch { return []; }
}

export function getCampaigns(): StoredCampaign[] {
    try { return getCached<StoredCampaign[]>('echo_campaigns', []).slice().reverse(); } catch { return []; }
}

export interface ProjectInfo { name: string; path: string; sizeKB: number; }

export async function listProjects(): Promise<ProjectInfo[]> {
    if (!isHandsConnected()) return [];
    try {
        const res = await handsCall('list_projects', {});
        return (res?.projects || []) as ProjectInfo[];
    } catch { return []; }
}

/** Read all text files of one project (for zipping). */
export async function getProjectFiles(name: string): Promise<ArtifactFile[]> {
    if (!isHandsConnected()) return [];
    const res = await handsCall('read_dir_files', { path: `~/EchoProjects/${name}` });
    return (res?.files || []).map((f: any) => ({ name: f.path, content: f.content }));
}

/* ── filename helpers ── */

const slug = (s: string) => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'untitled';

export function draftFilename(d: DraftItem): string { return `${slug(d.title)}.md`; }
export function campaignFilename(c: StoredCampaign): string { return `campaign-${slug(c.brand)}.md`; }

export function draftToMarkdown(d: DraftItem): string {
    return `# ${d.title}\n_(${d.kind} · ${new Date(d.createdAt).toLocaleString()})_\n\n${d.content}\n`;
}

/* ── single-file download ── */

export function downloadText(filename: string, content: string, mime = 'text/markdown') {
    const blob = new Blob([content], { type: mime });
    triggerDownload(filename, blob);
}

function triggerDownload(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ── zip (STORE method, no dependency) ──
 *
 * Builds a minimal but valid .zip: local headers + central directory + EOCD.
 * Adequate for bundling text artifacts. CRC-32 computed per entry.
 */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function buildZip(files: ArtifactFile[]): Blob {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    const u16 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
    const u32 = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
    const concat = (arr: Uint8Array[]) => {
        const len = arr.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(len);
        let p = 0;
        for (const a of arr) { out.set(a, p); p += a.length; }
        return out;
    };

    // de-dup file names
    const seen = new Set<string>();

    for (const f of files) {
        let name = f.name.replace(/^\/+/, '');
        if (seen.has(name)) { const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''; name = name.slice(0, name.length - ext.length) + '-' + Math.random().toString(36).slice(2, 6) + ext; }
        seen.add(name);

        const nameBytes = enc.encode(name);
        const data = enc.encode(f.content ?? '');
        const crc = crc32(data);

        const localHeader = concat([
            u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(data.length), u32(data.length),
            u16(nameBytes.length), u16(0),
        ]);
        chunks.push(localHeader, nameBytes, data);

        const centralHeader = concat([
            u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(crc), u32(data.length), u32(data.length),
            u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
            u32(offset),
        ]);
        central.push(centralHeader, nameBytes);

        offset += localHeader.length + nameBytes.length + data.length;
    }

    const centralBytes = concat(central);
    const eocd = concat([
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(centralBytes.length), u32(offset), u16(0),
    ]);

    return new Blob([concat(chunks), centralBytes, eocd], { type: 'application/zip' });
}

export function downloadZip(filename: string, files: ArtifactFile[]) {
    if (!files.length) return;
    triggerDownload(filename, buildZip(files));
}

/* ── bulk helpers ── */

export function downloadAllDrafts() {
    const files = getDrafts().map(d => ({ name: `drafts/${draftFilename(d)}`, content: draftToMarkdown(d) }));
    downloadZip(`echo-drafts-${Date.now()}.zip`, files);
}

export function downloadAllCampaigns() {
    const files = getCampaigns().map(c => ({ name: `campaigns/${campaignFilename(c)}`, content: c.markdown }));
    downloadZip(`echo-campaigns-${Date.now()}.zip`, files);
}

/** Everything browser-stored + (optionally) project files from disk. */
export async function downloadEverything() {
    const files: ArtifactFile[] = [];
    getDrafts().forEach(d => files.push({ name: `drafts/${draftFilename(d)}`, content: draftToMarkdown(d) }));
    getCampaigns().forEach(c => files.push({ name: `campaigns/${campaignFilename(c)}`, content: c.markdown }));

    if (isHandsConnected()) {
        const projects = await listProjects();
        for (const p of projects) {
            try {
                const pf = await getProjectFiles(p.name);
                pf.forEach(f => files.push({ name: `projects/${p.name}/${f.name}`, content: f.content }));
            } catch { /* skip unreadable project */ }
        }
    }
    downloadZip(`echo-everything-${Date.now()}.zip`, files);
    return files.length;
}
