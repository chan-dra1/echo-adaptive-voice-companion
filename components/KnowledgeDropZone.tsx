import React, { useState, useCallback } from 'react';
import { useToast } from '../hooks/useToast';
import { knowledgeService } from '../services/knowledgeService';
import { recordUpload } from '../services/uploadHistoryService';
import { UploadCloud, FileText, CheckCircle, Loader2, BookOpen } from 'lucide-react';

export default function KnowledgeDropZone({ children, onFileDrop }: { children: React.ReactNode, onFileDrop?: (file: File) => void }) {
    const [isDragActive, setIsDragActive] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const { addToast } = useToast();

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);

        const files = Array.from(e.dataTransfer.files) as File[];
        if (files.length === 0) return;

        // Split into Knowledge Base files (PDF/TXT) and others (Images/Docs)
        const kbFiles = files.filter(f => f.type === 'application/pdf' || f.type === 'text/plain' || f.name.endsWith('.md') || f.name.endsWith('.txt'));
        const otherFiles = files.filter(f => !kbFiles.includes(f));

        // Process KB files
        if (kbFiles.length > 0) {
            setIsProcessing(true);
            addToast(`Processing ${kbFiles.length} document(s) for Knowledge Base...`, 'info');

            try {
                for (const file of kbFiles) {
                    await knowledgeService.addDocument(file);
                    recordUpload({ name: file.name, type: file.type || 'document', size: file.size, destination: 'knowledge' });
                }
                addToast(`Knowledge Base Updated: ${kbFiles.length} docs added.`, 'success');
            } catch (error) {
                console.error("Upload error", error);
                addToast('Failed to process documents. Check console.', 'error');
            } finally {
                setIsProcessing(false);
            }
        }

        // Handle other files (Images, Docs, etc.) by passing to parent
        if (otherFiles.length > 0) {
            if (onFileDrop) {
                // Determine functionality based on file type
                const isImage = otherFiles[0].type.startsWith('image/');
                addToast(isImage ? 'Image detected. Opening Visual Analysis...' : 'File detected. Opening Send to Echo...', 'info');
                onFileDrop(otherFiles[0]); // Handle first file for now
            } else {
                addToast('This file type is not supported for Knowledge Base.', 'error');
            }
        }
    }, [addToast, onFileDrop]);

    return (
        <div
            className="relative w-full h-full flex flex-col flex-1"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {children}

            {/* Drag Overlay */}
            {(isDragActive || isProcessing) && (
                <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in pointer-events-none">
                    <div className="p-8 rounded-lg border-2 border-dashed border-[var(--border-green)] bg-[rgba(0,255,65,0.05)] shadow-[0_0_30px_rgba(0,255,65,0.15)] flex flex-col items-center text-center max-w-sm">
                        {isProcessing ? (
                            <>
                                <Loader2 size={48} className="text-[var(--accent-green)] animate-spin mb-4" />
                                <h3 className="font-hud text-xl uppercase tracking-widest text-[var(--text-primary)] mb-2">Expanding Knowledge</h3>
                                <p className="text-[var(--text-secondary)]">Echo is reading and indexing your documents...</p>
                            </>
                        ) : (
                            <>
                                <UploadCloud size={48} className="text-[var(--accent-green)] mb-4 animate-bounce" />
                                <h3 className="font-hud text-xl uppercase tracking-widest text-[var(--text-primary)] mb-2">DROP FILES TO INJECT</h3>
                                <p className="text-[var(--text-secondary)] mb-4">Drop PDF or Text files here to let Echo learn from them.</p>
                                <div className="flex gap-4 text-xs text-[var(--text-tertiary)] font-term uppercase tracking-wider">
                                    <span className="flex items-center gap-1"><FileText size={12} /> PDF</span>
                                    <span className="flex items-center gap-1"><BookOpen size={12} /> Markdown</span>
                                    <span className="flex items-center gap-1"><FileText size={12} /> Text</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
