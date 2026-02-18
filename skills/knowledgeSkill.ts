import { Skill } from "../services/agentSkillService";
import { knowledgeService } from "../services/knowledgeService";

const knowledgeSkill: Skill = {
    name: 'knowledge_base',
    description: 'Search and retrieve information from uploaded documents and knowledge base.',
    tools: [
        {
            name: 'search_knowledge_base',
            description: 'Search the knowledge base for information relevant to a query.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query or question.' },
                    limit: { type: 'number', description: 'Maximum number of results to return (default: 3).' }
                },
                required: ['query']
            }
        },
        {
            name: 'list_documents',
            description: 'List all documents currently in the knowledge base.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    ],
    execute: async (toolName, args) => {
        switch (toolName) {
            case 'search_knowledge_base':
                const results = await knowledgeService.query(args.query, args.limit || 3);
                if (results.length === 0) {
                    return "No relevant information found in the knowledge base.";
                }
                return results.map(r => `[Score: ${r.score.toFixed(2)}] ${r.text}`).join('\n\n');

            case 'list_documents':
                const docs = await knowledgeService.getDocuments();
                if (docs.length === 0) return "No documents uploaded.";
                return docs.map(d => `- ${d.name} (${d.type})`).join('\n');

            default:
                throw new Error(`Tool ${toolName} not found`);
        }
    }
};

export default knowledgeSkill;
