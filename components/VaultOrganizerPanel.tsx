import React, { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Trash2, X } from 'lucide-react';
import { folderService, VaultFolder, FolderItemView } from '../services/folderService';
import { taskMissionService } from '../services/taskMissionService';
import { getMemories } from '../services/memoryService';
import { knowledgeService } from '../services/knowledgeService';
import PlanHistoryPanel from './PlanHistoryPanel';

interface VaultOrganizerPanelProps {
    onClose: () => void;
}

type AssignType = 'task' | 'memory' | 'doc';

const VaultOrganizerPanel: React.FC<VaultOrganizerPanelProps> = ({ onClose }) => {
    const [folders, setFolders] = useState<VaultFolder[]>([]);
    const [contents, setContents] = useState<Record<string, FolderItemView[]>>({});
    const [folderName, setFolderName] = useState('');
    const [assignType, setAssignType] = useState<AssignType>('task');
    const [assignItemId, setAssignItemId] = useState('');
    const [assignFolderId, setAssignFolderId] = useState('');
    const [docs, setDocs] = useState<Array<{ id: string; name: string }>>([]);
    const [tasks, setTasks] = useState(() => taskMissionService.listTasks());
    const [memories, setMemories] = useState(() => getMemories());

    async function reload() {
        const latestFolders = folderService.listFolders();
        setFolders(latestFolders);
        const next: Record<string, FolderItemView[]> = {};
        for (const folder of latestFolders) {
            next[folder.id] = await folderService.listFolderContents(folder.id);
        }
        setContents(next);
        setTasks(taskMissionService.listTasks());
        setMemories(getMemories());
        const latestDocs = await knowledgeService.getDocuments().catch(() => []);
        setDocs(latestDocs.map((doc) => ({ id: doc.id, name: doc.name })));
    }

    useEffect(() => {
        void reload();
    }, []);

    const sourceItems = useMemo(() => {
        if (assignType === 'task') {
            return tasks.map((task) => ({ id: task.id, label: task.title }));
        }
        if (assignType === 'memory') {
            return memories.map((memory) => ({ id: memory.id, label: `${memory.key}: ${memory.value.slice(0, 40)}` }));
        }
        return docs.map((doc) => ({ id: doc.id, label: doc.name }));
    }, [assignType, tasks, memories, docs]);

    return (
        <div className="term-window animate-phosphor-in h-full flex flex-col w-full max-w-full">
            <div className="term-titlebar justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="term-dots" />
                    <span>VAULT.ORG</span>
                    <span className="text-[9px] tracking-[0.2em] text-[var(--text-tertiary)] normal-case">
                        FOLDERS // TASKS · MEMORY · DOCS
                    </span>
                </div>
                <button onClick={onClose} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-green)] transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="p-4 space-y-3 border-b border-[rgba(0,255,65,0.14)]">
                <div className="flex gap-2">
                    <input
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        placeholder="New folder"
                        className="flex-1 bg-black/60 border border-[var(--border-dim)] rounded px-3 py-2 text-sm font-hud text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--border-green)]"
                    />
                    <button
                        onClick={() => {
                            try {
                                folderService.createFolder(folderName);
                                setFolderName('');
                                void reload();
                            } catch {
                                // keep UI minimal
                            }
                        }}
                        className="btn-term px-3 py-2 text-[11px] flex items-center gap-1"
                    >
                        <FolderPlus size={13} /> Create
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                        value={assignType}
                        onChange={(e) => {
                            setAssignType(e.target.value as AssignType);
                            setAssignItemId('');
                        }}
                        className="bg-black/60 border border-[var(--border-dim)] rounded px-2 py-2 text-xs font-hud uppercase tracking-[0.1em] text-[var(--text-primary)] outline-none focus:border-[var(--border-green)]"
                    >
                        <option value="task">Task</option>
                        <option value="memory">Memory</option>
                        <option value="doc">Doc</option>
                    </select>
                    <select
                        value={assignItemId}
                        onChange={(e) => setAssignItemId(e.target.value)}
                        className="bg-black/60 border border-[var(--border-dim)] rounded px-2 py-2 text-xs font-hud text-[var(--text-primary)] outline-none focus:border-[var(--border-green)]"
                    >
                        <option value="">Select item</option>
                        {sourceItems.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                    </select>
                    <select
                        value={assignFolderId}
                        onChange={(e) => setAssignFolderId(e.target.value)}
                        className="bg-black/60 border border-[var(--border-dim)] rounded px-2 py-2 text-xs font-hud text-[var(--text-primary)] outline-none focus:border-[var(--border-green)]"
                    >
                        <option value="">Select folder</option>
                        {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>{folder.name}</option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={async () => {
                        if (!assignItemId || !assignFolderId) return;
                        if (assignType === 'task') {
                            folderService.assignTaskToFolder(assignItemId, assignFolderId);
                        } else {
                            folderService.assignItemToFolder(assignType, assignItemId, assignFolderId);
                        }
                        await reload();
                    }}
                    className="btn-term w-full py-2 text-[11px]"
                >
                    Move item into folder
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] rounded-lg p-3">
                    <h3 className="text-sm font-hud uppercase tracking-[0.1em] text-[var(--text-primary)]">Marketing Plans</h3>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 mb-2">Latest generated plans (local encrypted history).</p>
                    <PlanHistoryPanel compact />
                </div>
                {folders.map((folder) => (
                    <div key={folder.id} className="bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] rounded-lg p-3 hover:border-[var(--border-green)] transition-colors">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-hud uppercase tracking-[0.1em] text-[var(--text-primary)]">{folder.name}</h3>
                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
                                    folderService.deleteFolder(folder.id);
                                    await reload();
                                }}
                                className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent-red)] transition-colors"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {(contents[folder.id] || []).length === 0 && (
                                <p className="text-xs text-[var(--text-tertiary)] font-hud">No items.</p>
                            )}
                            {(contents[folder.id] || []).map((item) => (
                                <div key={item.id} className="flex items-center justify-between text-xs font-hud bg-black/40 border border-[var(--border-subtle)] rounded px-2 py-2">
                                    <span className="truncate pr-2 text-[var(--text-secondary)]">
                                        <span className="text-[var(--text-tertiary)] uppercase tracking-[0.1em]">{item.itemType}:</span> {item.label}
                                    </span>
                                    <button
                                        onClick={async () => {
                                            if (!window.confirm(`Delete this ${item.itemType}?`)) return;
                                            await folderService.deleteItem(item.itemType, item.itemId);
                                            await reload();
                                        }}
                                        className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] transition-colors"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VaultOrganizerPanel;
