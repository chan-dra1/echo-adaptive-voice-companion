import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

const TWITTER_TOKEN_KEY = 'echo_twitter_access_token';
const TWITTER_CLIENT_KEY = 'echo_twitter_client_id';

const postTweetDeclaration: FunctionDeclaration = {
    name: 'post_tweet',
    description:
        'Post a tweet to Twitter/X. Requires Twitter API v2 user access token (OAuth 2.0). Max 280 characters. Use for: sharing updates, posting content, announcing releases, sharing mission results. Get credentials from developer.twitter.com.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            text: {
                type: Type.STRING,
                description: 'Tweet text (max 280 characters). Emojis are supported.',
            },
            reply_to_id: {
                type: Type.STRING,
                description: 'Tweet ID to reply to (optional — creates a reply thread).',
            },
        },
        required: ['text'],
    },
};

const saveTwitterCredsDeclaration: FunctionDeclaration = {
    name: 'save_twitter_credentials',
    description:
        'Save Twitter/X API credentials for autonomous posting. Go to developer.twitter.com, create an app with Read+Write permissions, generate a user access token with OAuth 2.0. You need the user access token (not the bearer token).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            access_token: {
                type: Type.STRING,
                description: 'OAuth 2.0 user access token from developer.twitter.com.',
            },
        },
        required: ['access_token'],
    },
};

const getTwitterProfileDeclaration: FunctionDeclaration = {
    name: 'get_twitter_profile',
    description: 'Get the authenticated Twitter/X user profile to verify credentials are working.',
    parameters: {
        type: Type.OBJECT,
        properties: {},
    },
};

export const twitterSkill: Skill = {
    name: 'twitterSkill',
    description: 'Post tweets and interact with Twitter/X via API v2. Requires OAuth 2.0 user access token.',
    tools: [postTweetDeclaration, saveTwitterCredsDeclaration, getTwitterProfileDeclaration],

    execute: async (toolName: string, args: any) => {
        if (toolName === 'save_twitter_credentials') {
            const token = String(args.access_token || '').trim();
            if (!token) return { error: 'No access token provided.' };
            localStorage.setItem(TWITTER_TOKEN_KEY, token);
            return {
                success: true,
                message: 'Twitter credentials saved. Echo can now post tweets autonomously.',
            };
        }

        const token = String(localStorage.getItem(TWITTER_TOKEN_KEY) || args.access_token || '').trim();

        if (!token) {
            return {
                error: 'No Twitter credentials configured. Go to developer.twitter.com, create a project/app with Read+Write permissions, generate OAuth 2.0 user tokens, then say "save my Twitter access token: ..."',
            };
        }

        if (toolName === 'get_twitter_profile') {
            const res = await fetch('https://api.twitter.com/2/users/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                return { error: `Twitter API error ${res.status}: ${detail.slice(0, 200)}` };
            }
            return await res.json();
        }

        if (toolName === 'post_tweet') {
            const text = String(args.text || '').trim().slice(0, 280);
            if (!text) return { error: 'No tweet text provided.' };

            const payload: Record<string, any> = { text };
            if (args.reply_to_id) {
                payload.reply = { in_reply_to_tweet_id: String(args.reply_to_id) };
            }

            const res = await fetch('https://api.twitter.com/2/tweets', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const detail = await res.text().catch(() => '');
                if (res.status === 401) {
                    return { error: 'Twitter auth failed (401). Your access token may be expired or have insufficient permissions. Regenerate at developer.twitter.com with Read+Write scope.' };
                }
                return { error: `Twitter API error ${res.status}: ${detail.slice(0, 300)}` };
            }

            const data = await res.json();
            const tweetId = data?.data?.id;
            return {
                success: true,
                tweetId,
                url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined,
                message: `Tweet posted: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`,
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default twitterSkill;
