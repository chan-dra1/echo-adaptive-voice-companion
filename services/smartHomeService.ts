/**
 * smartHomeService.ts — Home Assistant integration for Echo.
 *
 * Routes all HA operations through the Echo Hands daemon (localhost WebSocket),
 * so credentials never touch the browser and all traffic stays on the LAN.
 *
 * Setup: ask Echo "configure home assistant" and provide your HA URL +
 * long-lived access token (Profile → Long-Lived Access Tokens in HA).
 *
 * Supported domains: light, switch, lock, climate, scene, automation,
 * cover, media_player, alarm_control_panel, fan, vacuum, input_boolean,
 * and any other HA domain.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { handsCall, isHandsConnected } from './handsBridgeService';

/* ── Gemini tool declarations ── */

export const SMART_HOME_TOOLS: FunctionDeclaration[] = [
    {
        name: 'ha_configure',
        description:
            'Save Home Assistant connection settings. Call this ONLY when the user explicitly provides ' +
            'their Home Assistant URL and long-lived access token to connect Echo to their smart home. ' +
            'IMPORTANT: ask the user to type credentials in the command bar, never speak them aloud.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: {
                    type: Type.STRING,
                    description: 'HA base URL, e.g. http://homeassistant.local:8123 or http://192.168.1.10:8123',
                },
                token: {
                    type: Type.STRING,
                    description: 'Long-lived access token from HA Profile → Long-Lived Access Tokens.',
                },
            },
            required: ['url', 'token'],
        },
    },
    {
        name: 'ha_get_state',
        description:
            'Get the current state of any Home Assistant entity — lights (on/off/brightness), ' +
            'locks (locked/unlocked), sensors (temperature, motion, humidity), thermostats, cameras, etc. ' +
            'Use this to answer "is the front door locked?", "what\'s the temperature?", "is anyone home?"',
        parameters: {
            type: Type.OBJECT,
            properties: {
                entity_id: {
                    type: Type.STRING,
                    description: 'HA entity ID, e.g. light.living_room, lock.front_door, sensor.bedroom_temperature, camera.front_yard',
                },
            },
            required: ['entity_id'],
        },
    },
    {
        name: 'ha_call_service',
        description:
            'Control any Home Assistant device by calling a service. ' +
            'Examples: turn lights on/off/dim, lock/unlock doors, set thermostat temperature, ' +
            'activate a scene, run an automation, open/close blinds, control media players. ' +
            'For lock.unlock or alarm disarm, confirm with the user first.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                domain: {
                    type: Type.STRING,
                    description: 'HA domain: light, switch, lock, climate, scene, automation, cover, media_player, alarm_control_panel, fan, vacuum',
                },
                service: {
                    type: Type.STRING,
                    description: 'Service name: turn_on, turn_off, toggle, lock, unlock, set_temperature, activate, trigger, open_cover, close_cover, media_play, media_pause, disarm, arm_away, arm_home',
                },
                entity_id: {
                    type: Type.STRING,
                    description: 'Optional entity to target, e.g. light.kitchen or lock.front_door. Omit for scenes (use data.entity_id instead).',
                },
                data: {
                    type: Type.OBJECT,
                    description: 'Optional service data. Examples: {"brightness": 128} for lights, {"temperature": 72} for climate, {"code": "1234"} for alarm.',
                },
            },
            required: ['domain', 'service'],
        },
    },
    {
        name: 'ha_list_entities',
        description:
            'List all Home Assistant entities to discover what smart home devices are available. ' +
            'Use this when the user asks "what devices do I have?", "what lights can you control?", ' +
            '"do I have smart locks?", etc. Optionally filter by domain.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                domain_filter: {
                    type: Type.STRING,
                    description: 'Filter by domain: light, switch, lock, camera, sensor, climate, cover, media_player, automation, scene. Omit to list all.',
                },
            },
        },
    },
    {
        name: 'ha_get_camera_snapshot',
        description:
            'Get a live snapshot image from a Home Assistant camera entity (security cameras, doorbell, etc.). ' +
            'Returns the image so you can describe what you see. Use for "show me the front door camera", ' +
            '"is anyone outside?", "what does the backyard look like?"',
        parameters: {
            type: Type.OBJECT,
            properties: {
                entity_id: {
                    type: Type.STRING,
                    description: 'Camera entity ID, e.g. camera.front_door, camera.backyard, camera.living_room',
                },
            },
            required: ['entity_id'],
        },
    },
];

export function isSmartHomeTool(name: string): boolean {
    return ['ha_configure', 'ha_get_state', 'ha_call_service', 'ha_list_entities', 'ha_get_camera_snapshot'].includes(name);
}

/* ── confirmation gate for sensitive operations ── */

const CONFIRM_SERVICES = new Set(['unlock', 'disarm', 'arm_away', 'arm_home', 'arm_night']);
const CONFIRM_DOMAINS = new Set(['alarm_control_panel']);

function needsConfirmation(domain: string, service: string): boolean {
    return CONFIRM_SERVICES.has(service) || CONFIRM_DOMAINS.has(domain);
}

/* ── executor ── */

export async function executeSmartHomeTool(
    name: string,
    args: Record<string, any>
): Promise<{ result?: any; error?: string }> {
    if (!isHandsConnected()) {
        return {
            error: 'Smart home control requires the Echo Hands daemon. Start it first: cd echo-daemon && npm start — then reconnect via ⌘K.',
        };
    }

    try {
        // Safety confirmation for dangerous operations (locks, alarms)
        if (name === 'ha_call_service' && needsConfirmation(args.domain, args.service)) {
            const target = args.entity_id ? ` "${args.entity_id}"` : '';
            const ok = window.confirm(
                `Echo wants to ${args.service}${target}.\n\nThis is a sensitive action. Allow?`
            );
            if (!ok) return { error: 'User cancelled the action.' };
        }

        const result = await handsCall(name, args);
        return { result };
    } catch (e: any) {
        return { error: e?.message || `Smart home tool ${name} failed.` };
    }
}

/* ── camera snapshot helper (used by geminiLiveService to send image to model) ── */

export async function getHaCameraSnapshot(entity_id: string): Promise<{ base64: string; contentType: string } | null> {
    if (!isHandsConnected()) return null;
    try {
        const result = await handsCall('ha_get_camera_snapshot', { entity_id });
        if (result?.base64) return { base64: result.base64, contentType: result.contentType || 'image/jpeg' };
        return null;
    } catch {
        return null;
    }
}
