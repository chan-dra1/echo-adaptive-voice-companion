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
        <div className="h-full flex flex-col bg-echo-surface/50 border-l border-white/10 backdrop-blur-md w-full max-w-full">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-mono font-semibold text-echo-primary">VAULT_ORGANIZER</h2>
                    <p className="text-xs text-gray-500">Folders for tasks, memory, and docs.</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white">
                    <X size={18} />
                </button>
            </div>

            <div className="p-4 space-y-3 border-b border-white/10">
                <div className="flex gap-2">
                    <input
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        placeholder="New folder"
                        className="flex-1 bg-black/20 border border-white/10 rounded px-3 py-2 text-sm"
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
                        className="px-3 py-2 bg-echo-primary/20 text-echo-primary rounded text-xs flex items-center gap-1"
                    >
                        <FolderPlus size={14} /> Create
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                        value={assignType}
                        onChange={(e) => {
                            setAssignType(e.target.value as AssignType);
                            setAssignItemId('');
                        }}
                        className="bg-black/20 border border-white/10 rounded px-2 py-2 text-xs"
                    >
                        <option value="task">Task</option>
                        <option value="memory">Memory</option>
                        <option value="doc">Doc</option>
                    </select>
                    <select
                        value={assignItemId}
                        onChange={(e) => setAssignItemId(e.target.value)}
                        className="bg-black/20 border border-white/10 rounded px-2 py-2 text-xs"
                    >
                        <option value="">Select item</option>
                        {sourceItems.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                    </select>
                    <select
                        value={assignFolderId}
                        onChange={(e) => setAssignFolderId(e.target.value)}
                        className="bg-black/20 border border-white/10 rounded px-2 py-2 text-xs"
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
                    className="w-full px-3 py-2 bg-white/10 rounded text-xs hover:bg-white/20"
                >
                    Move item into folder
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-white/5 border border-white/10 rounded p-3">
                    <h3 className="text-sm font-semibold">Marketing Plans</h3>
                    <p className="text-xs text-gray-500 mt-1 mb-2">Latest generated plans (local encrypted history).</p>
                    <PlanHistoryPanel compact />
                </div>
                {folders.map((folder) => (
                    <div key={folder.id} className="bg-white/5 border border-white/10 rounded p-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">{folder.name}</h3>
                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
                                    folderService.deleteFolder(folder.id);
                                    await reload();
                                }}
                                className="p-1 text-gray-500 hover:text-red-400"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {(contents[folder.id] || []).length === 0 && (
                                <p className="text-xs text-gray-500">No items.</p>
                            )}
                            {(contents[folder.id] || []).map((item) => (
                                <div key={item.id} className="flex items-center justify-between text-xs bg-black/20 rounded px-2 py-2">
                                    <span className="truncate pr-2">{item.itemType}: {item.label}</span>
                                    <button
                                        onClick={async () => {
                                            if (!window.confirm(`Delete this ${item.itemType}?`)) return;
                                            await folderService.deleteItem(item.itemType, item.itemId);
                                            await reload();
                                        }}
                                        className="text-gray-500 hover:text-red-400"
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
