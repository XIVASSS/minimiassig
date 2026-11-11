import type { Freshness, SearchHit, SearchPayload } from "./exa.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match?.[1] ?? "";
}

export function clip(text: string, max = 800): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function parseFeed(xml: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const item of xml.split(/<item\b/i).slice(1)) {
    const url = decode(tag(item, "link"));
    if (!isPublicHttp(url)) continue;
    const published = decode(tag(item, "pubDate"));
    const parsed = published ? new Date(published) : null;
    hits.push({
      title: decode(tag(item, "title")),
      url,
      publishedDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      highlight: clip(decode(tag(item, "description"))),
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

export function isPublicHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function withinFreshness(hit: SearchHit, freshness: Freshness): boolean {
  if (freshness === "any" || !hit.publishedDate) return true;
  const days = freshness === "day" ? 1 : freshness === "week" ? 7 : 30;
  const published = new Date(hit.publishedDate).getTime();
  return Number.isFinite(published) && published >= Date.now() - days * 86400000;
}

export async function searchOpen(query: string, freshness: Freshness, maxResults: number): Promise<SearchPayload> {
  const endpoint = `https://www.bing.com/search?format=rss&count=${maxResults}&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(endpoint, {
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { query, results: [], error: `Web search returned ${response.status}` };
    const xml = await response.text();
    if (!xml.includes("<item")) return { query, results: [], error: "Web search returned no results" };
    const results = parseFeed(xml, maxResults).filter((hit) => withinFreshness(hit, freshness));
    return { query, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed";
    return { query, results: [], error: message };
  }
}

function htmlToText(html: string): string {
  return clip(
    decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")),
    1500,
  );
}

export async function readOpenPage(url: string): Promise<SearchHit | null> {
  if (!isPublicHttp(url)) return null;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|text|xml|json/i.test(type)) return null;
    const html = await response.text();
    const title = decode(tag(html, "title"));
    return { title, url: response.url || url, publishedDate: null, highlight: htmlToText(html) };
  } catch {
    return null;
  }
}
