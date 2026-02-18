import { openDB, DBSchema } from 'idb';
import AES from 'crypto-js/aes';
import encUtf8 from 'crypto-js/enc-utf8';

const DB_NAME = 'echo_voice_vault';
const STORE_NAME = 'recordings';

interface EchoVoiceDB extends DBSchema {
    recordings: {
        key: string;
        value: {
            id: string;
            timestamp: number;
            encryptedBlob: string; // Base64 + Encrypted
            transcript: string;
        };
    };
}

export class AudioStorageService {
    private encryptionKey: string;

    constructor(encryptionKey: string) {
        this.encryptionKey = encryptionKey;
    }

    private async getDB() {
        return openDB<EchoVoiceDB>(DB_NAME, 1, {
            upgrade(db) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            },
        });
    }

    // Convert Blob to Base64
    private blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Save Audio
    public async saveRecording(id: string, blob: Blob, transcript: string) {
        const base64Audio = await this.blobToBase64(blob);
        const encrypted = AES.encrypt(base64Audio, this.encryptionKey).toString();

        const db = await this.getDB();
        await db.put(STORE_NAME, {
            id,
            timestamp: Date.now(),
            encryptedBlob: encrypted,
            transcript,
        });
    }

    // Get Audio
    public async getRecording(id: string): Promise<Blob | null> {
        const db = await this.getDB();
        const item = await db.get(STORE_NAME, id);
        if (!item) return null;

        try {
            const decryptedBytes = AES.decrypt(item.encryptedBlob, this.encryptionKey);
            const base64Audio = decryptedBytes.toString(encUtf8);
            const response = await fetch(base64Audio);
            return await response.blob();
        } catch (e) {
            console.error('Decryption failed:', e);
            return null;
        }
    }

    // Get All Metadata
    public async getAllRecordings() {
        const db = await this.getDB();
        const all = await db.getAll(STORE_NAME);
        return all.map(item => ({
            id: item.id,
            timestamp: item.timestamp,
            transcript: item.transcript
        }));
    }

    public async deleteRecording(id: string) {
        const db = await this.getDB();
        await db.delete(STORE_NAME, id);
    }
}
