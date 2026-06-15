/**
 * smarthome.mjs — optional Home Assistant status for the briefing.
 *
 * Reuses the SAME config the Echo Hands daemon stores
 * (~/.echo-hands/ha-config.json: { url, token }). If that file isn't there,
 * or HA is unreachable, every function here degrades to null silently — the
 * briefing just omits the smart-home line. Read-only: only GETs entity states.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HA_CONFIG = path.join(os.homedir(), '.echo-hands', 'ha-config.json');

function readConfig() {
    try {
        const c = JSON.parse(fs.readFileSync(HA_CONFIG, 'utf8'));
        if (c?.url && c?.token) return c;
    } catch { /* not configured */ }
    return null;
}

export function isConfigured() { return !!readConfig(); }

async function getStates(timeoutMs = 2500) {
    const cfg = readConfig();
    if (!cfg) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${cfg.url.replace(/\/$/, '')}/api/states`, {
            headers: { Authorization: `Bearer ${cfg.token}` },
            signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; } finally { clearTimeout(t); }
}

/**
 * One short spoken line summarising security-relevant entities, or null.
 * e.g. "Smart home: front door locked, garage closed, no motion."
 */
export async function statusLine() {
    const states = await getStates();
    if (!Array.isArray(states)) return null;
    const bits = [];

    const locks = states.filter(s => s.entity_id.startsWith('lock.'));
    if (locks.length) {
        const unlocked = locks.filter(s => s.state === 'unlocked');
        bits.push(unlocked.length ? `${unlocked.length} lock${unlocked.length > 1 ? 's' : ''} unlocked` : 'all doors locked');
    }

    const covers = states.filter(s => /garage|door/i.test(s.entity_id) && s.entity_id.startsWith('cover.'));
    const openCovers = covers.filter(s => s.state === 'open');
    if (openCovers.length) bits.push(`${openCovers.length} door/garage open`);
    else if (covers.length) bits.push('garage closed');

    const motion = states.filter(s => s.attributes?.device_class === 'motion' && s.state === 'on');
    if (motion.length) bits.push(`motion detected (${motion.length})`);

    const cams = states.filter(s => s.entity_id.startsWith('camera.'));
    if (cams.length) bits.push(`${cams.length} camera${cams.length > 1 ? 's' : ''} online`);

    if (!bits.length) return null;
    return `Smart home: ${bits.join(', ')}.`;
}
