import { FunctionDeclaration, Type } from "@google/genai";
import { Skill } from "../services/agentSkillService";

export const readWebpageToolDeclaration: FunctionDeclaration = {
    name: "read_webpage",
    description: "Read the textual content of a webpage from a URL. Useful for reading job descriptions, articles, or documentation.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            url: { type: Type.STRING, description: "The URL of the webpage to read." }
        },
        required: ["url"]
    }
};

export const webSkill: Skill = {
    name: "webSkill",
    description: "Fetches and extracts readable text content from webpages.",
    tools: [readWebpageToolDeclaration],

    execute: async (toolName: string, args: any): Promise<any> => {
        if (toolName !== "read_webpage") {
            return { error: `Tool not found: ${toolName}` };
        }

        try {
            // Using allorigins as a public CORS proxy to allow fetching from a browser
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(args.url)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                return `Error fetching URL: ${response.statusText}`;
            }

            const data = await response.json();
            const html = data.contents;

            if (!html) {
                return "Failed to extract content from the URL.";
            }

            // Simple HTML to text extraction (since this runs in the browser, we can use DOMParser)
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Remove scripts and styles
            const scripts = doc.querySelectorAll('script, style, noscript, iframe, link, meta');
            scripts.forEach(s => s.remove());

            let text = doc.body?.textContent || "";

            text = text.replace(/\s+/g, ' ').trim();

            // Truncate if too long (to prevent exceeding token limits)
            if (text.length > 30000) {
                text = text.substring(0, 30000) + "... [Content Truncated]";
            }

            return text || "No readable text found on this page.";
        } catch (error) {
            return `Failed to read webpage: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
};

export default webSkill;
