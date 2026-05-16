import { Octokit } from '@octokit/rest';
import { chat } from './llmRouter';
import { pickCheapModel, temperatureFor, tokenBudget } from './costPolicy';
import { responseCache } from './responseCache';

export interface RepoContextSummary {
    url: string;
    owner: string;
    repo: string;
    description?: string;
    homepage?: string | null;
    defaultBranch?: string;
    topics: string[];
    stars: number;
    forks: number;
    openIssues: number;
    language?: string | null;
    readmeSummary?: string;
    issueSummary?: string;
    generatedAt: string;
    depth: 'shallow' | 'issues';
}

function parseGithubRepo(urlOrSlug: string): { owner: string; repo: string } | null {
    const raw = String(urlOrSlug || '').trim();
    if (!raw) return null;

    const slugMatch = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (slugMatch) {
        return { owner: slugMatch[1], repo: slugMatch[2].replace(/\.git$/i, '') };
    }

    try {
        const url = new URL(raw);
        if (!/github\.com$/i.test(url.hostname)) return null;
        const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
        if (parts.length < 2) return null;
        return {
            owner: parts[0],
            repo: parts[1].replace(/\.git$/i, ''),
        };
    } catch {
        return null;
    }
}

function getOctokit(userToken?: string): Octokit {
    const token = userToken || localStorage.getItem('echo_github_token') || '';
    return token ? new Octokit({ auth: token }) : new Octokit();
}

function b64Decode(content: string): string {
    try {
        return decodeURIComponent(escape(atob(content)));
    } catch {
        try {
            return atob(content);
        } catch {
            return '';
        }
    }
}

async function summarizeBlock(prompt: string, tag: string): Promise<string> {
    const modelPick = pickCheapModel('summarize');
    const cacheKey = responseCache.makeKey({
        model: `${modelPick.provider}:${modelPick.model}`,
        tag,
        messages: [{ role: 'user', content: prompt }],
    });
    const cached = responseCache.get(cacheKey);
    if (cached) return cached;

    const result = await chat({
        provider: modelPick.provider,
        model: modelPick.model,
        temperature: temperatureFor('summarize'),
        maxTokens: tokenBudget('summarize'),
        messages: [
            { role: 'system', content: 'Summarize for execution planning. Return 3-5 short bullets only.' },
            { role: 'user', content: prompt },
        ],
    });
    const text = result.text.trim();
    if (text) responseCache.set(cacheKey, text, 10 * 60 * 1000);
    return text;
}

class RepoContextService {
    async summarizeFromUrl(
        repoUrl: string,
        opts?: { token?: string; includeIssues?: boolean }
    ): Promise<RepoContextSummary> {
        const parsed = parseGithubRepo(repoUrl);
        if (!parsed) {
            throw new Error('Invalid GitHub repository URL. Expected github.com/<owner>/<repo>.');
        }
        const octokit = getOctokit(opts?.token);
        const includeIssues = opts?.includeIssues === true;

        const repoRes = await octokit.rest.repos.get({
            owner: parsed.owner,
            repo: parsed.repo,
        });

        let readmeSummary = '';
        try {
            const readme = await octokit.rest.repos.getReadme({
                owner: parsed.owner,
                repo: parsed.repo,
            });
            const md = b64Decode(readme.data.content || '').slice(0, 6000);
            if (md.trim()) {
                readmeSummary = await summarizeBlock(
                    [
                        `Repository: ${parsed.owner}/${parsed.repo}`,
                        'Summarize this README for shipping execution planning.',
                        md,
                    ].join('\n\n'),
                    `repo-readme:${parsed.owner}/${parsed.repo}`
                );
            }
        } catch {
            readmeSummary = '';
        }

        let issueSummary = '';
        if (includeIssues) {
            try {
                const issues = await octokit.rest.issues.listForRepo({
                    owner: parsed.owner,
                    repo: parsed.repo,
                    state: 'open',
                    sort: 'updated',
                    direction: 'desc',
                    per_page: 8,
                });
                const issueText = issues.data
                    .filter((item) => !item.pull_request)
                    .map((item) => `#${item.number} ${item.title}\n${(item.body || '').slice(0, 320)}`)
                    .join('\n\n')
                    .slice(0, 5000);
                if (issueText.trim()) {
                    issueSummary = await summarizeBlock(
                        [
                            `Repository: ${parsed.owner}/${parsed.repo}`,
                            'Summarize key open issue themes and likely blockers.',
                            issueText,
                        ].join('\n\n'),
                        `repo-issues:${parsed.owner}/${parsed.repo}`
                    );
                }
            } catch {
                issueSummary = '';
            }
        }

        return {
            url: `https://github.com/${parsed.owner}/${parsed.repo}`,
            owner: parsed.owner,
            repo: parsed.repo,
            description: repoRes.data.description || '',
            homepage: repoRes.data.homepage || null,
            defaultBranch: repoRes.data.default_branch,
            topics: repoRes.data.topics || [],
            stars: repoRes.data.stargazers_count || 0,
            forks: repoRes.data.forks_count || 0,
            openIssues: repoRes.data.open_issues_count || 0,
            language: repoRes.data.language || null,
            readmeSummary,
            issueSummary,
            generatedAt: new Date().toISOString(),
            depth: includeIssues ? 'issues' : 'shallow',
        };
    }
}

export const repoContextService = new RepoContextService();
