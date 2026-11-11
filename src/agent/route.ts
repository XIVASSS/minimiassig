export type RouteKind = "chat" | "recall" | "verify" | "research";

const VERIFY = /\b(still|changed|change|changes|since|pricing|price|prices|shipped|correct|update|updates|updated)\b/i;
const RECALL = /\b(what did i ask|what did you say|what did we (decide|say|discuss)|remind me what)\b/i;
const FACT = /\b(latest|current|today|news|who\b|what is|what about|what's|whats|tell me about|look up|search for|how much|how many|when did|where is)\b/i;

export function routeMessage(text: string, hasDate: boolean): RouteKind {
  if (hasDate && VERIFY.test(text)) return "verify";
  if (RECALL.test(text)) return "recall";
  if (hasDate && /\b(i|we|you|my|our)\b/i.test(text)) return "recall";
  if (FACT.test(text) || text.includes("?")) return "research";
  return "chat";
}
