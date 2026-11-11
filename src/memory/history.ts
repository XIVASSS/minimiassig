import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { ensureSession, insertMessage, saveEpisode, type ClaimInput } from "./db.js";

export type HistoryLine = {
  role: "user" | "assistant";
  content: string;
  at: string;
  sessionId?: string;
  summary?: string;
  entities?: string[];
  topics?: string[];
  claims?: ClaimInput[];
};

export function importHistory(db: DatabaseSync, lines: HistoryLine[], fallbackSessionId = "imported"): number {
  let count = 0;
  let pending: { id: string; sessionId: string; at: string } | null = null;
  for (const line of lines) {
    if (!line.content?.trim() || (line.role !== "user" && line.role !== "assistant")) continue;
    const at = new Date(line.at);
    if (Number.isNaN(at.getTime())) throw new Error(`Bad timestamp: ${line.at}`);
    const sessionId = ensureSession(db, line.sessionId || fallbackSessionId, at);
    const message = insertMessage(db, { sessionId, role: line.role, content: line.content, at });
    count += 1;
    if (line.role === "user") {
      pending = { id: message.id, sessionId, at: message.at };
      continue;
    }
    if (pending && pending.sessionId === sessionId) {
      saveEpisode(db, {
        sessionId,
        userMessageId: pending.id,
        assistantMessageId: message.id,
        summary: line.summary || line.content.slice(0, 240),
        entities: line.entities ?? [],
        topics: line.topics ?? [],
        startedAt: pending.at,
        claims: line.claims ?? [],
      });
      pending = null;
    }
  }
  return count;
}

export function importHistoryFile(db: DatabaseSync, path: string): number {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HistoryLine);
  return importHistory(db, lines);
}
