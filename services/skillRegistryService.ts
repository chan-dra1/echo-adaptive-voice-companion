/**
 * skillRegistryService.ts
 *
 * Community skill registry backed by a user-configurable JSON endpoint.
 * Skills can be browsed, imported from the registry, exported as JSON for
 * sharing, or imported from a raw JSON string / URL.
 */

import { dynamicSkillService, DynamicSkill } from './dynamicSkillService';

const REGISTRY_URL_KEY = 'echo_skill_registry_url';
const CACHE_KEY = 'echo_skill_registry_cache';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export interface CommunitySkill {
    id: string;
    name: string;
    description: string;
    schema: any;           // FunctionDeclaration
    jsCode: string;
    permissions: string[]; // fetchAllowlist
    tags: string[];
    author: string;
    submittedAt: number;
    version: number;
    downloadCount: number;
}

interface CacheEntry {
    fetchedAt: number;
    skills: CommunitySkill[];
}

export const skillRegistryService = {
    /** Returns the configured registry URL, or empty string if not set. */
    getRegistryUrl(): string {
        try {
            return localStorage.getItem(REGISTRY_URL_KEY) ?? '';
        } catch {
            return '';
        }
    },

    /** Persists a new registry URL. Pass empty string to clear. */
    setRegistryUrl(url: string): void {
        try {
            if (url) {
                localStorage.setItem(REGISTRY_URL_KEY, url);
            } else {
                localStorage.removeItem(REGISTRY_URL_KEY);
            }
        } catch {
            /* ignore storage errors */
        }
    },

    /**
     * Fetch community skills from the registry URL.
     * Results are cached in localStorage for 6 h.
     * Returns [] silently if no URL is set or on any error.
     */
    async fetchCommunitySkills(): Promise<CommunitySkill[]> {
        const url = this.getRegistryUrl();
        if (!url) return [];

        // Check cache
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                const entry: CacheEntry = JSON.parse(raw);
                if (Date.now() - entry.fetchedAt < CACHE_TTL) {
                    return entry.skills;
                }
            }
        } catch {
            /* ignore */
        }

        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return [];
            const data: CommunitySkill[] = await res.json();
            if (!Array.isArray(data)) return [];
            const entry: CacheEntry = { fetchedAt: Date.now(), skills: data };
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
            } catch {
                /* quota exceeded — skip caching */
            }
            return data;
        } catch {
            return [];
        }
    },

    /** Clear the registry cache so the next fetch is fresh. */
    clearCache(): void {
        try {
            localStorage.removeItem(CACHE_KEY);
        } catch {
            /* ignore */
        }
    },

    /**
     * Converts a DynamicSkill into a shareable CommunitySkill JSON string
     * (formatted with 2-space indent).
     */
    exportSkillJSON(skill: DynamicSkill): string {
        const community: CommunitySkill = {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            schema: skill.schema,
            jsCode: skill.jsCode,
            permissions: skill.permissions.fetchAllowlist,
            tags: skill.tags ?? [],
            author: 'echo-user',
            submittedAt: Date.now(),
            version: skill.version ?? 1,
            downloadCount: 0,
        };
        return JSON.stringify(community, null, 2);
    },

    /**
     * Parses a CommunitySkill JSON string, validates it, and upserts it into
     * dynamicSkillService. Returns the resulting DynamicSkill.
     */
    async importSkillJSON(json: string): Promise<DynamicSkill> {
        let parsed: Partial<CommunitySkill>;
        try {
            parsed = JSON.parse(json);
        } catch {
            throw new Error('Invalid JSON: could not parse skill data.');
        }

        if (!parsed.name || !parsed.schema || !parsed.jsCode) {
            throw new Error('Skill JSON must include name, schema, and jsCode.');
        }

        const ds: DynamicSkill = {
            id: parsed.id || crypto.randomUUID(),
            name: parsed.name,
            description: parsed.description || '',
            schema: parsed.schema,
            jsCode: parsed.jsCode,
            permissions: { fetchAllowlist: parsed.permissions ?? [] },
            createdAt: Date.now(),
            approvedAt: Date.now(),
            version: parsed.version ?? 1,
            tags: parsed.tags ?? [],
            usageCount: 0,
            successCount: 0,
            failCount: 0,
            fromRegistry: this.getRegistryUrl() || undefined,
        };

        await dynamicSkillService.upsert(ds);
        return ds;
    },

    /**
     * Fetches skill JSON from a URL and calls importSkillJSON().
     */
    async importFromURL(url: string): Promise<DynamicSkill> {
        let json: string;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            json = await res.text();
        } catch (e: any) {
            throw new Error(`Failed to fetch skill from URL: ${e?.message || String(e)}`);
        }
        return this.importSkillJSON(json);
    },
};
