import type { DatabaseSync } from "node:sqlite";
import { parseDates, type DateRange } from "./dates.js";
import {
  claimsForEpisodes,
  episodesForMessages,
  messageById,
  messagesBetween,
  messagesByTokens,
  type ClaimInput,
  type MessageRow,
} from "./db.js";
import { contentTokens } from "./tokens.js";
import { calendarParts, formatStamp } from "./time.js";

export type ArchiveMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type ArchiveEpisode = {
  id: string;
  summary: string;
  entities: string[];
  topics: string[];
  startedAt: string;
  userMessageId: string;
  assistantMessageId: string;
  claims: Array<ClaimInput & { asOf: string }>;
};

export type Archive = {
  ranges: DateRange[];
  assumptions: string[];
  messages: ArchiveMessage[];
  episodes: ArchiveEpisode[];
  note: string;
  statusLine: string;
};

function toArchiveMessage(row: MessageRow): ArchiveMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    at: row.at,
  };
}

function overlapScore(content: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(contentTokens(content));
  return queryTokens.filter((token) => haystack.has(token)).length;
}

function expandPairs(db: DatabaseSync, messages: ArchiveMessage[]): ArchiveMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const episodes = episodesForMessages(db, [...byId.keys()]);
  for (const episode of episodes) {
    for (const id of [episode.user_message_id, episode.assistant_message_id]) {
      if (byId.has(id)) continue;
      const row = messageById(db, id);
      if (row) byId.set(id, toArchiveMessage(row));
    }
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function loadEpisodes(db: DatabaseSync, messages: ArchiveMessage[]): ArchiveEpisode[] {
  const rows = episodesForMessages(db, messages.map((message) => message.id));
  const claims = claimsForEpisodes(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    entities: JSON.parse(row.entities) as string[],
    topics: JSON.parse(row.topics) as string[],
    startedAt: row.started_at,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    claims: claims
      .filter((claim) => claim.episode_id === row.id)
      .map((claim) => ({
        subject: claim.subject,
        attribute: claim.attribute,
        value: claim.value,
        sources: JSON.parse(claim.sources) as string[],
        asOf: claim.as_of,
      })),
  }));
}

export function recall(db: DatabaseSync, query: string, now: Date, timeZone: string): Archive {
  const parsed = parseDates(query, now, timeZone);
  const topical = contentTokens(query);
  const dated = parsed.ranges.flatMap((range) => messagesBetween(db, range.start, range.end)).map(toArchiveMessage);
  const today = calendarParts(now, timeZone);
  const byToken = messagesByTokens(db, topical, 8)
    .map(toArchiveMessage)
    .filter((message) => {
      const parts = calendarParts(new Date(message.at), timeZone);
      return parts.year !== today.year || parts.month !== today.month || parts.day !== today.day;
    });
  const datedScore = Math.max(0, ...dated.map((message) => overlapScore(message.content, topical)));
  const labels = parsed.ranges.map((range) => range.label).join(" and ");

  let chosen = dated;
  let note = "";
  const dayHasTopic = dated.length > 0 && (topical.length === 0 || datedScore > 0);
  if (parsed.ranges.length > 0 && dayHasTopic) {
    chosen = dated;
  } else if (byToken.length > 0) {
    const linked = new Set<string>();
    for (const episode of episodesForMessages(db, byToken.map((message) => message.id))) {
      linked.add(episode.user_message_id);
      linked.add(episode.assistant_message_id);
    }
    const remembered = byToken.filter((message) => linked.has(message.id));
    chosen = remembered.length > 0 ? remembered : byToken;
    const earliest = [...chosen].sort((a, b) => a.at.localeCompare(b.at))[0];
    const when = formatStamp(earliest.at, timeZone);
    note = parsed.ranges.length
      ? dated.length === 0
        ? `Nothing was stored on ${labels}. The closest match is ${when}.`
        : `Nothing on ${labels} matched this topic. The closest match is ${when}.`
      : "";
  } else if (parsed.ranges.length > 0 && dated.length === 0) {
    note = `I don't have a conversation from ${labels}.`;
  }

  const messages = expandPairs(db, chosen).slice(0, 20);
  const episodes = loadEpisodes(db, messages);
  const statusLine = parsed.ranges.length
    ? `Checking what we said on ${labels}`
    : topical.length
      ? "Looking through past conversations"
      : "Reading this conversation";

  return {
    ranges: parsed.ranges,
    assumptions: parsed.assumptions,
    messages,
    episodes,
    note,
    statusLine,
  };
}
