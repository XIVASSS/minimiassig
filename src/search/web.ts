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

const STOP = new Set([
  "i", "am", "im", "looking", "for", "some", "good", "can", "you", "find", "please", "tell", "me", "about",
  "the", "a", "an", "of", "to", "and", "with", "what", "are", "is", "do", "does", "my", "your", "want",
  "need", "show", "get", "any", "there", "how", "who", "would", "could", "just", "like", "this", "that",
]);

export function searchTerms(message: string): string {
  const words = message
    .replace(/\bsale\b/gi, "sales")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
  const unique: string[] = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
  }
  return (unique.slice(0, 8).join(" ") || message.replace(/[?!.]+/g, " ").trim()).slice(0, 180);
}

export function isMenuText(text: string): boolean {
  return /jump to content|main menu|skip to main|keyboard shortcuts|show\/hide shortcuts|move to sidebar/i.test(text);
}

export function keepRelevant(results: SearchHit[], terms: string): SearchHit[] {
  const needles = terms.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  if (!needles.length) return results.slice(0, 5);
  const ranked = results
    .map((hit) => ({ hit, score: relevance(hit, needles) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.hit);
  return ranked.slice(0, 5);
}

function relevance(hit: SearchHit, needles: string[]): number {
  const title = hit.title.toLowerCase();
  const body = `${title} ${hit.highlight}`.toLowerCase();
  let host = "";
  try { host = new URL(hit.url).hostname.toLowerCase(); } catch { host = ""; }
  const generic = new Set(["best", "software", "online", "free", "top", "review", "reviews", "guide", "list"]);
  const specific = needles.filter((needle) => !generic.has(needle));
  const focus = specific.length ? specific : needles;
  const named = focus.some((needle) => host.includes(needle) || title.includes(needle));
  if (!named) return 0;
  const matched = needles.filter((needle) => host.includes(needle) || title.includes(needle) || body.includes(needle));
  if (matched.length < Math.min(2, needles.length)) return 0;
  let score = matched.length;
  for (const needle of matched) {
    if (host.includes(needle)) score += 3;
    if (title.includes(needle)) score += 2;
  }
  if (isMenuText(hit.highlight)) score -= 4;
  return score;
}

export function cleanMarkup(text: string): string {
  let out = text;
  const cites: string[] = [];
  out = out.replace(/\[(\d+)\]/g, (_, n: string) => {
    cites.push(`[${n}]`);
    return `§CITE${cites.length - 1}§`;
  });
  out = out.replace(/\{\{[^{}]*\}\}/g, " ");
  out = out.replace(/\{\{[^{}]*\}\}/g, " ");
  out = out.replace(/\[\[(?:File|Image|Category|Wikipedia):[^\]]*\]\]/gi, " ");
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");
  out = out.replace(/\[[^\s\]]+\s+([^\]]+)\]/g, "$1");
  out = out.replace(/https?:\/\/\S+/g, " ");
  out = out.replace(/"[^"]*":\s*(?:"[^"]*"|[0-9.]+|\{|\[)/g, " ");
  out = out.replace(/[{}\[\]|<>]+/g, " ");
  out = out.replace(/"[^A-Za-z0-9.]*"/g, " ");
  out = out.replace(/'{2,}/g, "");
  out = out.replace(/[,"']+/g, " ");
  out = out.replace(/\[[a-z]{1,3}\]/gi, "");
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out.replace(/§CITE(\d+)§/g, (_, index: string) => cites[Number(index)] || "");
}

export function cleanPlainText(text: string): string {
  return cleanMarkup(text).replace(/\s+/g, " ").trim();
}

export function clip(text: string, max = 800): string {
  const clean = cleanPlainText(text);
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

async function searchWikipedia(query: string, maxResults: number): Promise<SearchHit[]> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&utf8=1&format=json`;
  const found = await fetch(searchUrl, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!found.ok) return [];
  const data = (await found.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  const matches = data.query?.search ?? [];
  if (!matches.length) return [];
  const titles = matches.map((item) => encodeURIComponent(item.title)).join("|");
  const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${titles}`;
  const detail = await fetch(detailUrl, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  const pages = detail.ok
    ? ((await detail.json()) as { query?: { pages?: Record<string, { title?: string; extract?: string }> } }).query?.pages
    : undefined;
  const extracts = new Map(Object.values(pages ?? {}).map((page) => [page.title ?? "", page.extract ?? ""]));
  const needles = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  return matches
    .filter((item) => {
      const blob = `${item.title} ${extracts.get(item.title) || ""} ${item.snippet || ""}`;
      return !/disambiguation|may refer to|may also refer/i.test(blob);
    })
    .map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      publishedDate: null,
      highlight: clip(extracts.get(item.title) || decode(item.snippet), 700),
    }))
    .sort((a, b) => wikiScore(b.title, b.highlight, needles) - wikiScore(a.title, a.highlight, needles));
}

function wikiScore(title: string, highlight: string, needles: string[]): number {
  const lower = title.toLowerCase();
  const body = `${lower} ${highlight}`.toLowerCase();
  let score = 0;
  for (const needle of needles) {
    if (lower === needle || lower.startsWith(needle + " ") || lower.endsWith(" " + needle)) score += 6;
    if (lower.includes(needle)) score += 3;
    if (body.includes(needle)) score += 1;
  }
  if (/estranged wife|ministry|film|album|song|may refer/i.test(body)) score -= 5;
  return score;
}

async function searchInstant(query: string): Promise<SearchHit[]> {
  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetch(endpoint, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string }[];
  };
  const hits: SearchHit[] = [];
  if (data.AbstractText && data.AbstractURL && isPublicHttp(data.AbstractURL)) {
    hits.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      publishedDate: null,
      highlight: clip(data.AbstractText, 700),
    });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (!topic.Text || !topic.FirstURL || !isPublicHttp(topic.FirstURL)) continue;
    hits.push({ title: topic.Text.split(" - ")[0] || query, url: topic.FirstURL, publishedDate: null, highlight: clip(topic.Text, 400) });
    if (hits.length >= 3) break;
  }
  return hits;
}

async function searchBing(query: string, freshness: Freshness, maxResults: number): Promise<SearchHit[]> {
  const endpoint = `https://www.bing.com/search?format=rss&count=${maxResults}&setlang=en&mkt=en-US&q=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const xml = await response.text();
  if (!xml.includes("<item")) return [];
  return parseFeed(xml, maxResults).filter((hit) => withinFreshness(hit, freshness));
}

function uniqueHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const unique: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique;
}

export async function searchOpen(query: string, freshness: Freshness, maxResults: number): Promise<SearchPayload> {
  try {
    const [wiki, instant, bing] = await Promise.all([
      searchWikipedia(query, maxResults).catch(() => []),
      searchInstant(query).catch(() => []),
      searchBing(query, freshness, maxResults).catch(() => []),
    ]);
    const results = uniqueHits([...wiki, ...keepRelevant([...instant, ...bing], query)]).slice(0, maxResults);
    if (!results.length) return { query, results: [], error: "No relevant pages came back" };
    return { query, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web search failed";
    return { query, results: [], error: message };
  }
}

function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
  const main = stripped.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
  const region = main?.[2] ?? stripped;
  const paragraphs = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => decode(match[1]))
    .filter((paragraph) => paragraph.length > 40 && !isMenuText(paragraph));
  const text = paragraphs.length ? paragraphs.slice(0, 5).join(" ") : decode(region);
  return clip(text, 900);
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
