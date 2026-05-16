import { FunctionDeclaration, Type } from "@google/genai";

export const flightToolDeclaration: FunctionDeclaration = {
    name: "search_flights",
    description: "Search for flight information, prices, and schedules. Use this when the user asks for travel planning.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            origin: {
                type: Type.STRING,
                description: "The departure city or airport code.",
            },
            destination: {
                type: Type.STRING,
                description: "The arrival city or airport code.",
            },
            date: {
                type: Type.STRING,
                description: "The date of travel.",
            },
            returnDate: {
                type: Type.STRING,
                description: "Optional return date.",
            },
        },
        required: ["origin", "destination", "date"],
    },
};

export const flightSkill = {
    name: "flightSkill",
    description: "Searches for flight information using real-time data.",
    tools: [flightToolDeclaration],

    execute: async (name: string, args: any): Promise<any> => {
        if (name === "search_flights") {
            const { origin, destination, date } = args;
            // This tool primarily serves to trigger the AI's internal Google Search capability
            // by providing a structured context.
            return { 
                info: `Searching for flights from ${origin} to ${destination} on ${date}.`,
                instruction: "Please use your integrated Google Search tool to find the latest flight prices and schedules for this route."
            };
        }
        return { error: "Tool not found" };
    }
};

export default flightSkill;
