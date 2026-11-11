import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { runTurn } from "./agent/run.js";
import { port } from "./config.js";
import { countMessages, openDatabase, recentMessages } from "./memory/db.js";

const db = openDatabase();
const app = new Hono();
const page = readFileSync(join(process.cwd(), "public", "index.html"), "utf8");

app.get("/", (c) => c.html(page));

function png(name: string): Response {
  const bytes = readFileSync(join(process.cwd(), "public", name));
  return new Response(bytes, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}

app.get("/logo.png", () => png("logo.png"));
app.get("/mascot.png", () => png("mascot.png"));
app.get("/api/health", (c) => c.json({ messages: countMessages(db) }));

app.get("/api/messages", (c) => {
  const sessionId = c.req.query("sessionId") ?? "";
  if (!sessionId) return c.json({ messages: [] });
  const rows = recentMessages(db, sessionId, "", 80);
  return c.json({
    messages: rows.map((row) => ({ role: row.role, content: row.content, at: row.at })),
  });
});

app.post("/api/chat", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    message?: string;
    sessionId?: string;
    at?: string;
  } | null;
  const message = body?.message?.trim() ?? "";
  if (!message) return c.json({ error: "Message is empty" }, 400);
  const at = body?.at ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime())) return c.json({ error: "Bad timestamp" }, 400);

  return streamSSE(c, async (stream) => {
    try {
      const result = await runTurn({
        db,
        message,
        sessionId: body?.sessionId,
        at,
        onStatus: (text) => {
          void stream.writeSSE({ event: "status", data: JSON.stringify({ text }) });
        },
        onMeta: (meta) => {
          void stream.writeSSE({ event: "meta", data: JSON.stringify(meta) });
        },
        onDelta: (text) => {
          void stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) });
        },
      });
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ sessionId: result.sessionId }),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Something went wrong";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ text }) });
    }
  });
});

const listening = port();
serve({ fetch: app.fetch, port: listening }, () => {
  const stored = countMessages(db);
  console.log(`Chat agent at http://localhost:${listening}`);
  console.log(
    stored
      ? `History: ${stored} messages.`
      : "No history yet. Run npm run import -- fixtures/history.jsonl",
  );
});
