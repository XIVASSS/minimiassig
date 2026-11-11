const STOP = new Set([
  "the", "a", "an", "on", "in", "we", "i", "you", "to", "of", "for", "and", "or",
  "has", "any", "them", "since", "then", "what", "did", "ask", "asked", "your",
  "is", "still", "correct", "today", "about", "last", "this", "was", "were",
  "my", "our", "me", "do", "does", "have", "had", "with", "from", "that",
  "there", "been", "into", "than", "its", "it", "be", "as", "at", "by", "if",
  "so", "not", "no", "yes", "can", "could", "would", "should", "just", "also",
  "please", "tell", "say", "said", "something", "big", "them", "they", "their",
]);

const WEAK = new Set([
  "answer", "question", "questions", "conversation", "thing", "things",
]);

const DATE_WORDS = new Set([
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "jan", "feb", "mar", "apr",
  "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "yesterday",
  "tomorrow", "today",
]);

export function tokens(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

export function contentTokens(text: string): string[] {
  return tokens(text).filter((token) => !DATE_WORDS.has(token) && !WEAK.has(token));
}
