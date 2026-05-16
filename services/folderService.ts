import { getCached, setCached } from './cryptoService';
import { taskMissionService } from './taskMissionService';
import { getMemories, deleteMemory } from './memoryService';
import { knowledgeService } from './knowledgeService';

const FOLDERS_KEY = 'echo_folders';
const FOLDER_ITEMS_KEY = 'echo_folder_items';

export type FolderItemType = 'memory' | 'doc';

export interface VaultFolder {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}

export interface FolderItemMapping {
    id: string;
    folderId: string;
    itemType: FolderItemType;
    itemId: string;
    createdAt: number;
    updatedAt: number;
}

export interface FolderItemView {
    id: string;
    folderId: string;
    itemType: 'task' | FolderItemType;
    itemId: string;
    label: string;
}

function listFoldersRaw(): VaultFolder[] {
    const folders = getCached<VaultFolder[]>(FOLDERS_KEY, []);
    return Array.isArray(folders) ? folders : [];
}

function listMappingsRaw(): FolderItemMapping[] {
    const mappings = getCached<FolderItemMapping[]>(FOLDER_ITEMS_KEY, []);
    return Array.isArray(mappings) ? mappings : [];
}

function saveFolders(folders: VaultFolder[]) {
    setCached(FOLDERS_KEY, folders);
}

function saveMappings(mappings: FolderItemMapping[]) {
    setCached(FOLDER_ITEMS_KEY, mappings);
}

class FolderService {
    listFolders(): VaultFolder[] {
        return listFoldersRaw().sort((a, b) => a.name.localeCompare(b.name));
    }

    createFolder(name: string): VaultFolder {
        const safeName = name.trim();
        if (!safeName) throw new Error('Folder name is required.');
        const folders = listFoldersRaw();
        const exists = folders.some((folder) => folder.name.toLowerCase() === safeName.toLowerCase());
        if (exists) throw new Error('Folder already exists.');
        const folder: VaultFolder = {
            id: crypto.randomUUID(),
            name: safeName,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        folders.push(folder);
        saveFolders(folders);
        return folder;
    }

    updateFolder(folderId: string, name: string): VaultFolder | null {
        const safeName = name.trim();
        if (!safeName) return null;
        const folders = listFoldersRaw();
        const idx = folders.findIndex((folder) => folder.id === folderId);
        if (idx < 0) return null;
        folders[idx] = { ...folders[idx], name: safeName, updatedAt: Date.now() };
        saveFolders(folders);
        return folders[idx];
    }

    deleteFolder(folderId: string): boolean {
        const folders = listFoldersRaw();
        const keepFolders = folders.filter((folder) => folder.id !== folderId);
        if (keepFolders.length === folders.length) return false;
        saveFolders(keepFolders);

        const tasks = taskMissionService.listTasks().filter((task) => task.folderId === folderId);
        for (const task of tasks) {
            taskMissionService.updateTask(task.id, { folderId: null });
        }

        const mappings = listMappingsRaw().filter((map) => map.folderId !== folderId);
        saveMappings(mappings);
        return true;
    }

    assignTaskToFolder(taskId: string, folderId: string | null): boolean {
        const task = taskMissionService.updateTask(taskId, { folderId });
        return !!task;
    }

    assignItemToFolder(itemType: FolderItemType, itemId: string, folderId: string | null): boolean {
        const mappings = listMappingsRaw();
        const without = mappings.filter((map) => !(map.itemType === itemType && map.itemId === itemId));
        if (!folderId) {
            saveMappings(without);
            return true;
        }
        without.push({
            id: crypto.randomUUID(),
            folderId,
            itemType,
            itemId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        saveMappings(without);
        return true;
    }

    async listFolderContents(folderId: string): Promise<FolderItemView[]> {
        const out: FolderItemView[] = [];
        const tasks = taskMissionService.listTasks().filter((task) => task.folderId === folderId);
        for (const task of tasks) {
            out.push({
                id: `task:${task.id}`,
                folderId,
                itemType: 'task',
                itemId: task.id,
                label: task.title,
            });
        }

        const mappings = listMappingsRaw().filter((map) => map.folderId === folderId);
        const memories = getMemories();
        const docs = await knowledgeService.getDocuments().catch(() => []);

        for (const mapping of mappings) {
            if (mapping.itemType === 'memory') {
                const memory = memories.find((item) => item.id === mapping.itemId);
                if (!memory) continue;
                out.push({
                    id: mapping.id,
                    folderId,
                    itemType: 'memory',
                    itemId: memory.id,
                    label: `${memory.key}: ${memory.value.slice(0, 48)}`,
                });
            }
            if (mapping.itemType === 'doc') {
                const doc = docs.find((item) => item.id === mapping.itemId);
                if (!doc) continue;
                out.push({
                    id: mapping.id,
                    folderId,
                    itemType: 'doc',
                    itemId: doc.id,
                    label: doc.name,
                });
            }
        }

        return out;
    }

    async deleteItem(itemType: 'task' | FolderItemType, itemId: string): Promise<boolean> {
        if (itemType === 'task') {
            return taskMissionService.deleteTask(itemId);
        }
        if (itemType === 'memory') {
            deleteMemory(itemId);
            this.assignItemToFolder('memory', itemId, null);
            return true;
        }
        if (itemType === 'doc') {
            await knowledgeService.deleteDocument(itemId);
            this.assignItemToFolder('doc', itemId, null);
            return true;
        }
        return false;
    }
}

export const folderService = new FolderService();
