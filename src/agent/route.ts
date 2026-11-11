export type RouteKind = "chat" | "recall" | "verify" | "research";

const VERIFY = /\b(still|changed|change|changes|since|pricing|price|prices|shipped|correct|update|updates|updated)\b/i;
const RECALL = /\b(what did i ask|what did you say|what did we (decide|say|discuss)|remind me what)\b/i;
const GREETING = /^(hi|hello|hey|thanks|thank you|ok|okay|yo)[.!?\s]*$/i;

export function routeMessage(text: string, hasDate: boolean): RouteKind {
  if (GREETING.test(text.trim())) return "chat";
  if (hasDate && VERIFY.test(text)) return "verify";
  if (RECALL.test(text)) return "recall";
  if (hasDate && /\b(i|we|you|my|our)\b/i.test(text)) return "recall";
  return "research";
}
