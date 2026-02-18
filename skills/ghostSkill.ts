import { Skill } from '../services/agentSkillService';
import { ghostAgent, GHOST_TOOLS } from '../services/ghostAgentService';

const ghostSkill: Skill = {
    name: "ghost_agent",
    description: "Capabilities for the Ghost Agent to interact with the local filesystem and run commands. Use this to read code, write files, and execute terminal commands.",
    tools: GHOST_TOOLS,
    execute: async (toolName, args) => {
        try {
            switch (toolName) {
                case "list_files":
                    const files = await ghostAgent.listFiles(args.path);
                    return { files };
                case "read_file":
                    const content = await ghostAgent.readFile(args.path);
                    return { content };
                case "write_file":
                    const result = await ghostAgent.writeFile(args.path, args.content);
                    return result;
                case "run_command":
                    const execResult = await ghostAgent.execCommand(args.command, args.cwd);
                    return execResult;
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }
        } catch (error: any) {
            return { error: error.message || String(error) };
        }
    }
};

export default ghostSkill;
