/**
 * db.ts — Persistent memory for Gravity Claw using SQLite + FTS5.
 *
 * Provides fast, local, disk-based storage of conversations
 * and enables full-text search across all past interactions.
 */
import Database from "better-sqlite3";
import type { Message } from "./types.js";
import path from "node:path";
import fs from "node:fs";

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "gravity-claw.db");

// Synchronous, blazing fast connection
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // Better concurrent performance and safety

/**
 * Initialize database schema.
 * We use two tables:
 * 1. messages: The raw chronological ledger
 * 2. messages_fts: The FTS5 virtual table for lightning-fast keyword search
 */
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, content='messages', content_rowid='id');

    -- Triggers to keep the FTS index automatically in sync with the messages table
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
}

initDb();

// ── Prepared Statements ───────────────────────────────────────────────────────

const insertStmt = db.prepare(`
  INSERT INTO messages (user_id, role, content)
  VALUES (?, ?, ?)
`);

const selectRecentStmt = db.prepare(`
  SELECT role, content
  FROM messages
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const deleteUserStmt = db.prepare(`
  DELETE FROM messages WHERE user_id = ?
`);

const searchMemoryStmt = db.prepare(`
  SELECT content, timestamp
  FROM messages_fts
  WHERE user_id = ? AND messages_fts MATCH ?
  ORDER BY rank
  LIMIT 5
`);

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Record a new message into persistent memory.
 */
export function addMessage(userId: number, role: "user" | "assistant", content: string) {
  insertStmt.run(userId, role, content);
}

/**
 * Fetch the last N messages chronologically to provide immediate conversational context.
 */
export function getRecentContext(userId: number, limit: number = 10): Message[] {
  // SQLite returns DESC (newest first). We need ASC (oldest first) for Claude.
  const rows = selectRecentStmt.all(userId, limit) as { role: "user" | "assistant"; content: string }[];
  return rows.reverse();
}

/**
 * Delete all conversation history for a user (used by /reset).
 */
export function clearHistory(userId: number) {
  deleteUserStmt.run(userId);
}

/**
 * Search past conversation history using FTS5 semantic matching.
 */
export function searchMemory(userId: number, query: string): { content: string, timestamp: string }[] {
  // FTS5 MATCH syntax uses quotes for literal phrases
  const safeQuery = `"${query.replace(/"/g, '""')}"`;
  return searchMemoryStmt.all(userId, safeQuery) as { content: string, timestamp: string }[];
}
