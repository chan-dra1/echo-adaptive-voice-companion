export interface TaskPrivacyInput {
    id: string;
    title: string;
    description?: string;
    dueAt?: string | null;
    priority: number;
    tags?: string[];
    cloudOk?: boolean;
}

export interface SanitizedTaskPayload {
    taskId: string;
    title: string;
    description: string;
    dueAt?: string | null;
    priority: number;
    tags: string[];
}

export interface SanitizationResult {
    cloudAllowed: boolean;
    redactions: string[];
    payload: SanitizedTaskPayload;
    policy: string;
}

const SENSITIVE_PATTERNS: Array<{ label: string; re: RegExp }> = [
    { label: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { label: 'phone', re: /\b(?:\+?\d{1,2}\s*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/g },
    { label: 'card', re: /\b(?:\d[ -]*?){13,16}\b/g },
    { label: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { label: 'address', re: /\b\d{1,6}\s+[A-Za-z0-9.\- ]+\s(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\b/gi },
    { label: 'secret', re: /\b(password|passcode|api[_ -]?key|secret|token)\s*[:=]\s*\S+/gi },
];

function scrubText(text: string): { value: string; redactions: string[] } {
    let next = text;
    const redactions: string[] = [];
    for (const pattern of SENSITIVE_PATTERNS) {
        if (next.match(pattern.re)) {
            redactions.push(pattern.label);
            next = next.replace(pattern.re, `[redacted:${pattern.label}]`);
        }
    }
    return { value: next.trim(), redactions };
}

function hasCloudFlag(input: TaskPrivacyInput): boolean {
    if (input.cloudOk === true) return true;
    return (input.tags || []).some((tag) => tag.toLowerCase() === 'cloud_ok');
}

export function sanitizeTaskForResearch(input: TaskPrivacyInput): SanitizationResult {
    const cloudAllowed = hasCloudFlag(input);
    const safeTags = (input.tags || []).filter(Boolean).slice(0, 10);
    const titleResult = scrubText(input.title || '');
    const descResult = scrubText(input.description || '');
    const redactions = Array.from(new Set([...titleResult.redactions, ...descResult.redactions]));

    const payload: SanitizedTaskPayload = {
        taskId: input.id,
        title: titleResult.value || 'Task',
        description: cloudAllowed
            ? (descResult.value || '')
            : (descResult.value ? 'Description withheld unless cloud_ok is explicit.' : ''),
        dueAt: input.dueAt || null,
        priority: input.priority,
        tags: safeTags,
    };

    if (!cloudAllowed && payload.tags.includes('cloud_ok')) {
        payload.tags = payload.tags.filter((tag) => tag !== 'cloud_ok');
    }

    return {
        cloudAllowed,
        redactions,
        payload,
        policy: getPrivacyPolicyText(),
    };
}

export function getPrivacyPolicyText(): string {
    return [
        'Task and memory data stay encrypted at rest on this device.',
        'Network-backed research receives a sanitized task summary only.',
        'Full task description may be sent to cloud only when cloud_ok is explicit.',
    ].join(' ');
}
