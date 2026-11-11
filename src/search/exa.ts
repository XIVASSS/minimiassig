import Exa from "exa-js";
import type { DatabaseSync } from "node:sqlite";
import { readCache, writeCache } from "../memory/db.js";
import { clip, readOpenPage, searchOpen } from "./web.js";

export type Freshness = "day" | "week" | "month" | "any";

export type SearchHit = {
  title: string;
  url: string;
  publishedDate: string | null;
  highlight: string;
};

export type SearchPayload = {
  query: string;
  results: SearchHit[];
  error?: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000;

function freshnessStart(freshness: Freshness): string | undefined {
  if (freshness === "any") return undefined;
  const days = freshness === "day" ? 1 : freshness === "week" ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export async function readPages(db: DatabaseSync, urls: string[]): Promise<SearchPayload> {
  const unique = [...new Set(urls)].slice(0, 6);
  const query = unique.join(" ");
  const key = process.env.EXA_API_KEY;
  if (!key) return readOpenPages(db, unique, query);
  if (unique.length === 0) return { query, results: [] };

  const cacheKey = JSON.stringify(["pages", unique]);
  const cached = readCache(db, cacheKey);
  if (cached) return JSON.parse(cached) as SearchPayload;

  try {
    const exa = new Exa(key);
    const response = await exa.getContents(unique, { text: { maxCharacters: 1500 } }, { timeout: 8000 });
    const results: SearchHit[] = response.results.map((result) => ({
      title: result.title ?? "",
      url: result.url,
      publishedDate: result.publishedDate ?? null,
      highlight: clip(result.text ?? "", 1500),
    }));
    const payload: SearchPayload = { query, results };
    writeCache(db, cacheKey, JSON.stringify(payload), CACHE_TTL_MS);
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Page fetch failed";
    return { query, results: [], error: message };
  }
}

export async function searchWeb(
  db: DatabaseSync,
  input: { query: string; freshness: Freshness; maxResults: number },
): Promise<SearchPayload> {
  const cacheKey = JSON.stringify([input.query, input.freshness, input.maxResults, Boolean(process.env.EXA_API_KEY)]);
  const cached = readCache(db, cacheKey);
  if (cached) return JSON.parse(cached) as SearchPayload;

  try {
    const key = process.env.EXA_API_KEY?.trim();
    if (!key) {
      const payload = await searchOpen(input.query, input.freshness, input.maxResults);
      if (!payload.error) writeCache(db, cacheKey, JSON.stringify(payload), CACHE_TTL_MS);
      return payload;
    }
    const exa = new Exa(key);
    const startPublishedDate = freshnessStart(input.freshness);
    const response = await exa.searchAndContents(
      input.query,
      {
        numResults: input.maxResults,
        type: "fast",
        text: { maxCharacters: 800 },
        ...(startPublishedDate ? { startPublishedDate } : {}),
      },
      { timeout: 8000 },
    );
    const results: SearchHit[] = response.results.map((result) => ({
      title: result.title ?? "",
      url: result.url,
      publishedDate: result.publishedDate ?? null,
      highlight: clip(result.text ?? ""),
    }));
    const payload: SearchPayload = { query: input.query, results };
    writeCache(db, cacheKey, JSON.stringify(payload), CACHE_TTL_MS);
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return { query: input.query, results: [], error: message };
  }
}

async function readOpenPages(db: DatabaseSync, urls: string[], query: string): Promise<SearchPayload> {
  if (urls.length === 0) return { query, results: [] };
  const cacheKey = JSON.stringify(["pages-open", urls]);
  const cached = readCache(db, cacheKey);
  if (cached) return JSON.parse(cached) as SearchPayload;
  const opened = await Promise.all(urls.map((url) => readOpenPage(url)));
  const results = opened.filter((hit): hit is SearchHit => hit !== null && hit.highlight.length > 0);
  const payload: SearchPayload = { query, results };
  if (results.length) writeCache(db, cacheKey, JSON.stringify(payload), CACHE_TTL_MS);
  return payload;
}
