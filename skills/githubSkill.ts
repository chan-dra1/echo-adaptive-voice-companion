import { Octokit } from "@octokit/rest";
import { Skill } from "../services/agentSkillService";

// Helper to get Octokit instance
const getOctokit = () => {
    const token = localStorage.getItem('echo_github_token');
    if (!token) throw new Error("GitHub token not found. Please add it in the Settings Vault.");
    return new Octokit({ auth: token });
};

const githubSkill: Skill = {
    name: 'github_integration',
    description: 'Manage GitHub repositories, issues, and search code',
    tools: [
        {
            name: 'list_github_repos',
            description: 'List the authenticated user\'s repositories',
            parameters: {
                type: 'object',
                properties: {
                    sort: {
                        type: 'string',
                        enum: ['created', 'updated', 'pushed', 'full_name'],
                        description: 'Property to sort by',
                        default: 'updated'
                    },
                    limit: {
                        type: 'number',
                        description: 'Number of repositories to return (max 30)',
                        default: 5
                    }
                },
                required: []
            }
        },
        {
            name: 'get_github_issue',
            description: 'Get details of a specific GitHub issue or pull request',
            parameters: {
                type: 'object',
                properties: {
                    owner: { type: 'string', description: 'Repository owner (username or org)' },
                    repo: { type: 'string', description: 'Repository name' },
                    issue_number: { type: 'number', description: 'Issue or PR number' }
                },
                required: ['owner', 'repo', 'issue_number']
            }
        },
        {
            name: 'search_github_code',
            description: 'Search for code within a repository or globally',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query (e.g., "auth function")' },
                    owner: { type: 'string', description: 'Limit search to this owner (optional)' },
                    repo: { type: 'string', description: 'Limit search to this repo (optional)' }
                },
                required: ['query']
            }
        }
    ],
    execute: async (toolName, args) => {
        const octokit = getOctokit();

        try {
            switch (toolName) {
                case 'list_github_repos': {
                    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                        sort: (args.sort as any) || 'updated',
                        per_page: Math.min(args.limit || 5, 30),
                        visibility: 'all'
                    });

                    return data.map(repo => ({
                        name: repo.name,
                        full_name: repo.full_name,
                        description: repo.description,
                        url: repo.html_url,
                        stars: repo.stargazers_count,
                        language: repo.language,
                        updated_at: repo.updated_at
                    }));
                }

                case 'get_github_issue': {
                    const { data } = await octokit.rest.issues.get({
                        owner: args.owner,
                        repo: args.repo,
                        issue_number: args.issue_number
                    });

                    return {
                        title: data.title,
                        state: data.state,
                        body_excerpt: data.body ? data.body.slice(0, 500) + '...' : 'No description',
                        url: data.html_url,
                        user: data.user?.login,
                        created_at: data.created_at,
                        comments: data.comments
                    };
                }

                case 'search_github_code': {
                    let q = args.query;
                    if (args.repo) {
                        q += ` repo:${args.owner ? args.owner + '/' : ''}${args.repo}`;
                    } else if (args.owner) {
                        q += ` user:${args.owner}`;
                    }

                    const { data } = await octokit.rest.search.code({
                        q,
                        per_page: 5
                    });

                    return {
                        total_count: data.total_count,
                        items: data.items.map(item => ({
                            name: item.name,
                            path: item.path,
                            repo: item.repository.full_name,
                            url: item.html_url
                        }))
                    };
                }

                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error: any) {
            console.error(`GitHub API Error (${toolName}):`, error);
            if (error.status === 401) return { error: "Unauthorized: Invalid GitHub Token. Please check your settings." };
            if (error.status === 404) return { error: "Resource not found (404)." };
            return { error: error.message || "GitHub API Error" };
        }
    }
};

export default githubSkill;
