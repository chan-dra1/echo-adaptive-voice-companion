import { FunctionDeclaration, Type } from "@google/genai";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, TextRun } from "docx";

export const fileGenToolDeclaration: FunctionDeclaration = {
    name: "generate_file",
    description: "Generate a downloadable file for the user (PDF, Excel, Word, CSV, Text). Use this when the user asks for a report, document, or spreadsheet with specific formatting.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            filename: {
                type: Type.STRING,
                description: "The name of the file (e.g., 'report.pdf', 'data.xlsx').",
            },
            type: {
                type: Type.STRING,
                description: "The type of file: 'pdf', 'excel', 'word', 'csv', 'text'.",
            },
            title: {
                type: Type.STRING,
                description: "Title or main heading for the document.",
            },
            content: {
                type: Type.STRING,
                description: "The main text or data. For Excel/CSV, provide as JSON string or comma-separated values.",
            },
            formatting: {
                type: Type.OBJECT,
                properties: {
                    font: { type: Type.STRING, description: "Font name (e.g., 'Courier', 'Helvetica', 'Times')." },
                    fontSize: { type: Type.NUMBER, description: "Base font size." },
                    color: { type: Type.STRING, description: "Hex color code for text (e.g. '#FF0000')." },
                    bold: { type: Type.BOOLEAN, description: "Whether text should be bold." },
                    italic: { type: Type.BOOLEAN, description: "Whether text should be italic." },
                    alignment: { type: Type.STRING, description: "Text alignment: 'left', 'center', 'right', 'justify'." }
                }
            }
        },
        required: ["filename", "type", "content"],
    },
};

export const fileGenSkill = {
    name: "fileGenSkill",
    description: "Generates professional documents and spreadsheets with custom formatting.",
    tools: [fileGenToolDeclaration],

    execute: async (name: string, args: any): Promise<any> => {
        if (name === "generate_file") {
            const { filename, type, content, title, formatting = {} } = args;
            const { 
                font = 'Helvetica', 
                fontSize = 12, 
                color = '#000000',
                bold = false,
                italic = false,
                alignment = 'left'
            } = formatting;

            try {
                let blob: Blob;
                let mimeType: string;

                if (type === 'pdf') {
                    const doc = new jsPDF();
                    const fontStyle = (bold && italic) ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
                    
                    doc.setFont(font as any, fontStyle);
                    doc.setTextColor(color);

                    if (title) {
                        doc.setFontSize(fontSize + 6);
                        doc.text(title, 105, 20, { align: 'center' });
                        doc.setFontSize(fontSize);
                    } else {
                        doc.setFontSize(fontSize);
                    }
                    
                    const splitText = doc.splitTextToSize(content, 170);
                    doc.text(splitText, 20, title ? 35 : 20, { align: alignment as any });
                    
                    blob = doc.output('blob');
                    mimeType = 'application/pdf';
                } 
                else if (type === 'excel') {
                    let data: any[];
                    try {
                        data = JSON.parse(content);
                    } catch {
                        data = content.split('\n').map((line: string) => line.split(','));
                    }
                    const ws = XLSX.utils.json_to_sheet(Array.isArray(data) ? data : [data]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
                    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                    blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                }
                else if (type === 'word') {
                    const doc = new Document({
                        sections: [{
                            properties: {},
                            children: [
                                ...(title ? [new Paragraph({
                                    alignment: alignment === 'center' ? 'center' : alignment === 'right' ? 'right' : 'left' as any,
                                    children: [
                                        new TextRun({
                                            text: title,
                                            bold: true,
                                            size: 32,
                                            font: font,
                                            color: color.replace('#', ''),
                                        }),
                                    ],
                                })] : []),
                                new Paragraph({
                                    alignment: alignment === 'center' ? 'center' : alignment === 'right' ? 'right' : 'left' as any,
                                    children: [
                                        new TextRun({
                                            text: content,
                                            size: fontSize * 2,
                                            font: font,
                                            bold: bold,
                                            italics: italic,
                                            color: color.replace('#', ''),
                                        }),
                                    ],
                                }),
                            ],
                        }],
                    });
                    const buffer = await Packer.toBlob(doc);
                    blob = buffer;
                    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                }
                else {
                    blob = new Blob([content], { type: 'text/plain' });
                    mimeType = 'text/plain';
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1500);

                return { result: `Successfully generated ${type} file: ${filename}. Saved to Downloads.` };
            } catch (e) {
                return { error: `Failed to generate file: ${(e as Error).message}` };
            }
        }
        return { error: "Tool not found" };
    }
};

export default fileGenSkill;
