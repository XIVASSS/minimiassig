import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { importHistoryFile } from "../src/memory/history.js";
import { insertMessage, openDatabase } from "../src/memory/db.js";
import { recall } from "../src/memory/recall.js";
import { routeMessage } from "../src/agent/route.js";
import { cleanMarkup, cleanPlainText, keepRelevant, parseFeed, searchTerms } from "../src/search/web.js";
import { pagesToOpen } from "../src/search/checks.js";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-11-10T06:30:00.000Z");

function fixtureDb() {
  const dir = mkdtempSync(join(tmpdir(), "chat-agent-"));
  const db = openDatabase(join(dir, "agent.db"));
  importHistoryFile(db, join(process.cwd(), "fixtures", "history.jsonl"));
  return db;
}

describe("recall", () => {
  it("returns both questions from 3 November", () => {
    const archive = recall(fixtureDb(), "What did I ask you on 3 November?", NOW, TZ);
    const asked = archive.messages.filter((message) => message.role === "user").map((message) => message.content);
    assert.equal(asked.length, 2);
    assert.match(asked.join("\n"), /Postgres hosting/);
    assert.match(asked.join("\n"), /Postgres 17/);
    assert.equal(routeMessage("What did I ask you on 3 November?", archive.ranges.length > 0), "recall");
    assert.equal(
      routeMessage("What did I ask you on 3 November? Is your answer still correct today?", true),
      "verify",
    );
  });

  it("finds the Monday CRM shortlist and its claims", () => {
    const text = "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?";
    const archive = recall(fixtureDb(), text, NOW, TZ);
    assert.match(archive.messages.map((message) => message.content).join("\n"), /Attio/);
    assert.ok(archive.episodes.some((episode) => episode.entities.includes("Folk")));
    assert.equal(archive.episodes[0]?.claims.length, 5);
    assert.equal(routeMessage(text, true), "verify");
    const urls = pagesToOpen(archive.episodes).map((page) => page.url);
    assert.deepEqual(urls, [
      "https://attio.com/pricing",
      "https://www.hubspot.com/pricing/sales",
      "https://www.close.com/pricing",
      "https://www.pipedrive.com/en/pricing",
      "https://www.folk.app/pricing",
    ]);
  });

  it("resolves last Tuesday to the Postgres hosting turn", () => {
    const text = "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?";
    const archive = recall(fixtureDb(), text, NOW, TZ);
    assert.match(archive.messages.map((message) => message.content).join("\n"), /Neon/);
    assert.equal(routeMessage(text, true), "verify");
  });

  it("keeps 3 November when the question also says today", () => {
    const text = "What did I ask you on 3 November? Is your answer still correct today?";
    const archive = recall(fixtureDb(), text, NOW, TZ);
    const asked = archive.messages.filter((message) => message.role === "user").map((message) => message.content);
    assert.equal(archive.ranges.length, 1);
    assert.equal(archive.note, "");
    assert.equal(asked.length, 2);
    assert.equal(routeMessage(text, true), "verify");
  });

  it("uses a later topical match when the named day is empty", () => {
    const archive = recall(fixtureDb(), "On Friday I asked about Postgres hosting.", NOW, TZ);
    assert.match(archive.note, /Nothing was stored on Fri 6 Nov 2026/);
    assert.match(archive.messages.map((message) => message.content).join("\n"), /Neon/);
  });

  it("ignores a repeated question and keeps the saved conversation", () => {
    const db = fixtureDb();
    const text = "On Friday I asked about Postgres hosting.";
    insertMessage(db, { sessionId: "live", role: "user", content: text, at: NOW });
    const archive = recall(db, text, NOW, TZ);
    assert.match(archive.messages.map((message) => message.content).join("\n"), /Neon/);
    assert.doesNotMatch(archive.note, /10 Nov 2026, 12:00/);
  });

  it("searches when the question names something outside the thread", () => {
    assert.equal(routeMessage("what about minimi", false), "research");
    assert.equal(routeMessage("minimi ??", false), "research");
    assert.equal(routeMessage("productivity", false), "research");
    assert.equal(routeMessage("hi", false), "chat");
  });

  it("reads a keyless search feed", () => {
    const hits = parseFeed(
      `<?xml version="1.0"?><rss><channel><item><title>minimi</title><link>https://www.projectminimi.com/</link><description>AI cat for your Mac.</description><pubDate>Wed, 11 Nov 2026 01:28:00 GMT</pubDate></item><item><title>skip</title><link>http://127.0.0.1/secret</link><description>no</description></item></channel></rss>`,
      5,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.url, "https://www.projectminimi.com/");
    assert.match(hits[0]?.highlight ?? "", /AI cat/);
    assert.equal(searchTerms("I am looking for some good sale CRM tools. Can you find"), "sales crm tools");
    const ranked = keepRelevant(
      [
        { title: "AM and PM", url: "https://www.timeanddate.com/calendar/am-pm.html", publishedDate: null, highlight: "AM means before noon." },
        { title: "Best CRM software", url: "https://www.hubspot.com/products/crm", publishedDate: null, highlight: "A sales CRM keeps your pipeline in one place." },
      ],
      "sales crm tools",
    );
    assert.equal(ranked.length, 1);
    assert.match(ranked[0]?.url ?? "", /hubspot/);
    assert.equal(
      keepRelevant(
        [{ title: "Free online games", url: "https://www.agame.com/", publishedDate: null, highlight: "Hello Kitty and a thief named Bob." }],
        "elon",
      ).length,
      0,
    );
    assert.equal(
      cleanPlainText("Narendra [[Gujarati people|Gujarati]] {{sfn|Marino|2014|pp=4–5}} \"}},\"i\":0}}]}'> (born 1950)"),
      "Narendra Gujarati (born 1950)",
    );
    assert.match(
      cleanMarkup("**Narendra Modi** is PM.\n\nKey facts about them:\n- **Born:** 1950"),
      /Key facts about them:/,
    );
  });
});
