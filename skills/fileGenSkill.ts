import { FunctionDeclaration, Type } from "@google/genai";

export const fileGenToolDeclaration: FunctionDeclaration = {
    name: "generate_file",
    description: "Generate a downloadable file for the user containing text, data (CSV), or code. Use this when the user asks for a file, report, or excel sheet.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            filename: {
                type: Type.STRING,
                description: "The name of the file to save (e.g., 'nvidia_q2_results.csv', 'coupon_list.md').",
            },
            content: {
                type: Type.STRING,
                description: "The text content of the file. For Excel, use CSV format.",
            },
            mimeType: {
                type: Type.STRING,
                description: "The MIME type (e.g., 'text/csv', 'text/markdown', 'text/plain', 'text/html').",
            },
        },
        required: ["filename", "content"],
    },
};

export const fileGenSkill = {
    name: "fileGenSkill",
    description: "Generates downloadable files for the user.",
    tools: [fileGenToolDeclaration],

    execute: async (name: string, args: any): Promise<any> => {
        if (name === "generate_file") {
            const { filename, content, mimeType = 'text/plain' } = args;

            try {
                // Create Blob
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Trigger Download
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Cleanup
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                return { result: `File "${filename}" generated and download triggered successfully.` };
            } catch (e) {
                return { error: `Failed to generate file: ${(e as Error).message}` };
            }
        }
        return { error: "Tool not found" };
    }
};

export default fileGenSkill;
