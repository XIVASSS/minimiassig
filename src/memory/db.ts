import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { tokens } from "./tokens.js";

export type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type EpisodeRow = {
  id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
  summary: string;
  entities: string;
  topics: string;
  started_at: string;
};

export type ClaimRow = {
  id: string;
  episode_id: string;
  subject: string;
  attribute: string;
  value: string;
  sources: string;
  as_of: string;
};

export type ClaimInput = {
  subject: string;
  attribute: string;
  value: string;
  sources: string[];
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_at ON messages(at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, at);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  entities TEXT NOT NULL,
  topics TEXT NOT NULL,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  sources TEXT NOT NULL,
  as_of TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (token, message_id)
);
CREATE TABLE IF NOT EXISTS search_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function databasePath(): string {
  return process.env.DB_PATH || join(process.cwd(), "data", "agent.db");
}

export function openDatabase(path = databasePath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec(SCHEMA);
  return db;
}

export function countMessages(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
  return row.n;
}

export function ensureSession(db: DatabaseSync, id: string | undefined, at: Date): string {
  if (id) {
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id) as { id: string } | undefined;
    if (existing) return existing.id;
  }
  const sessionId = id || randomUUID();
  db.prepare("INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)").run(
    sessionId,
    "Chat",
    at.toISOString(),
  );
  return sessionId;
}

export function insertMessage(
  db: DatabaseSync,
  input: { sessionId: string; role: "user" | "assistant"; content: string; at: Date },
): MessageRow {
  const row: MessageRow = {
    id: randomUUID(),
    session_id: input.sessionId,
    role: input.role,
    content: input.content,
    at: input.at.toISOString(),
  };
  db.prepare("INSERT INTO messages (id, session_id, role, content, at) VALUES (?, ?, ?, ?, ?)").run(
    row.id,
    row.session_id,
    row.role,
    row.content,
    row.at,
  );
  indexTokens(db, row.id, row.content);
  return row;
}

export function indexTokens(db: DatabaseSync, messageId: string, text: string): void {
  const insert = db.prepare("INSERT OR IGNORE INTO tokens (token, message_id) VALUES (?, ?)");
  for (const token of tokens(text)) insert.run(token, messageId);
}

export function recentMessages(db: DatabaseSync, sessionId: string, exceptId: string, limit = 12): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, at
       FROM messages
       WHERE session_id = ? AND id != ?
       ORDER BY at DESC
       LIMIT ?`,
    )
    .all(sessionId, exceptId, limit) as MessageRow[];
  return rows.reverse();
}

export function messagesBetween(db: DatabaseSync, start: Date, end: Date): MessageRow[] {
  return db
    .prepare(
      `SELECT id, session_id, role, content, at
       FROM messages
       WHERE at >= ? AND at < ?
       ORDER BY at ASC`,
    )
    .all(start.toISOString(), end.toISOString()) as MessageRow[];
}

export function messagesByTokens(db: DatabaseSync, queryTokens: string[], limit = 8): MessageRow[] {
  if (queryTokens.length === 0) return [];
  const placeholders = queryTokens.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT m.id, m.session_id, m.role, m.content, m.at, COUNT(DISTINCT t.token) AS overlap
       FROM tokens t
       JOIN messages m ON m.id = t.message_id
       WHERE t.token IN (${placeholders})
       GROUP BY m.id
       ORDER BY overlap DESC, m.at DESC
       LIMIT ?`,
    )
    .all(...queryTokens, limit) as MessageRow[];
}

export function saveEpisode(
  db: DatabaseSync,
  input: {
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    summary: string;
    entities: string[];
    topics: string[];
    startedAt: string;
    claims: ClaimInput[];
  },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO episodes
      (id, session_id, user_message_id, assistant_message_id, summary, entities, topics, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sessionId,
    input.userMessageId,
    input.assistantMessageId,
    input.summary,
    JSON.stringify(input.entities),
    JSON.stringify(input.topics),
    input.startedAt,
  );
  const insertClaim = db.prepare(
    `INSERT INTO claims (id, episode_id, subject, attribute, value, sources, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const claim of input.claims) {
    insertClaim.run(
      randomUUID(),
      id,
      claim.subject,
      claim.attribute,
      claim.value,
      JSON.stringify(claim.sources),
      input.startedAt,
    );
  }
  indexTokens(db, input.userMessageId, [input.summary, ...input.entities, ...input.topics].join(" "));
  return id;
}

export function episodesForMessages(db: DatabaseSync, messageIds: string[]): EpisodeRow[] {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT id, session_id, user_message_id, assistant_message_id, summary, entities, topics, started_at
       FROM episodes
       WHERE user_message_id IN (${placeholders}) OR assistant_message_id IN (${placeholders})`,
    )
    .all(...messageIds, ...messageIds) as EpisodeRow[];
}

export function recentClaims(db: DatabaseSync, limit = 40): ClaimRow[] {
  return db
    .prepare(
      `SELECT id, episode_id, subject, attribute, value, sources, as_of
       FROM claims
       ORDER BY as_of DESC
       LIMIT ?`,
    )
    .all(limit) as ClaimRow[];
}

export function claimsForEpisodes(db: DatabaseSync, episodeIds: string[]): ClaimRow[] {
  if (episodeIds.length === 0) return [];
  const placeholders = episodeIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT id, episode_id, subject, attribute, value, sources, as_of
       FROM claims
       WHERE episode_id IN (${placeholders})`,
    )
    .all(...episodeIds) as ClaimRow[];
}

export function messageById(db: DatabaseSync, id: string): MessageRow | undefined {
  return db
    .prepare("SELECT id, session_id, role, content, at FROM messages WHERE id = ?")
    .get(id) as MessageRow | undefined;
}

export function readCache(db: DatabaseSync, key: string): string | undefined {
  const row = db
    .prepare("SELECT payload, expires_at FROM search_cache WHERE cache_key = ?")
    .get(key) as { payload: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (row.expires_at < new Date().toISOString()) return undefined;
  return row.payload;
}

export function writeCache(db: DatabaseSync, key: string, payload: string, ttlMs: number): void {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(
    `INSERT INTO search_cache (cache_key, payload, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`,
  ).run(key, payload, expires);
}
