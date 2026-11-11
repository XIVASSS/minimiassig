import type { ArchiveEpisode } from "../memory/recall.js";

export type PageCheck = {
  url: string;
  lines: string[];
};

const MAX_PAGES = 6;

export function pagesToOpen(episodes: ArchiveEpisode[]): PageCheck[] {
  const byUrl = new Map<string, string[]>();
  for (const episode of episodes) {
    for (const claim of episode.claims) {
      const url = claim.sources.find((source) => /^https?:\/\//i.test(source));
      if (!url) continue;
      const line = `${claim.subject} / ${claim.attribute} / ${claim.value}`;
      const lines = byUrl.get(url) ?? [];
      if (!lines.includes(line)) lines.push(line);
      byUrl.set(url, lines);
      if (byUrl.size >= MAX_PAGES) break;
    }
    if (byUrl.size >= MAX_PAGES) break;
  }
  return [...byUrl.entries()].map(([url, lines]) => ({ url, lines }));
}

export function asksWhatShipped(text: string): boolean {
  return /\b(shipped|launch(?:ed)?|releas(?:e|ed)|announc(?:e|ed|ement))\b/i.test(text);
}
