# Minimi-style chat agent

A Node/TypeScript personal chat agent with **dated memory** and **live web recheck**. It is graded on remembering what you asked on a real day (CRM shortlist, “what did I ask on 3 November”, Postgres hosting last Tuesday) and on checking whether those facts still hold — not on looking like a generic search bot.

This README is the context file for you and for anyone else opening the repo: what was built, why, what money constrained, and what you would change with budget.

## Quick start

```bash
npm install
cp .env.example .env   # put GEMINI_API_KEY (and optional EXA_API_KEY) here
npm run import -- fixtures/history.jsonl
npm run dev
```

Open the URL the server prints (default port from `.env`, often `3000` or `3456`). Dates use `Asia/Kolkata`.

```bash
npm test   # date parsing + recall; no model, no web
```

`POST /api/chat` body: `{ "message", "sessionId?", "at?" }`. Omit `at` for “now”. Set `at` to replay an older day.

## What this product is

| Job | How it is handled |
| --- | --- |
| Remember a day | SQLite archive + deterministic date parser, prefetched before the model speaks |
| “Is that still true?” | Verify mode opens claim URLs in parallel, then the model diffs old vs current |
| “Who is X?” / live fact | Research mode searches, filters, opens pages, then composes a structured answer with citations |
| Follow-up in a thread | Session messages in SQLite + Recent chats in `localStorage` |

It is **not** a Minimi Mac-app clone. The UI is a warm dark chat with side panel + full chat, citation chips, source cards under the answer, and Gemini-style key-fact layout for profile questions.

## Architecture

```
Browser (public/index.html)
  SSE  →  Hono server (src/server.ts)
            → runTurn (src/agent/run.ts)
                 1. insert user message
                 2. recall(db) — date windows + token overlap
                 3. routeMessage → chat | recall | verify | research
                 4. prefetch pages (research search / verify open URLs)
                 5. streamText (Gemini) + optional web_search tool
                 6. polish / compose structured answer if needed
                 7. save assistant turn + async claim extraction
```

### Layers

- **`src/memory/`** — SQLite schema, date parsing (`chrono-node` + weekday rules), token index, recall, claim extraction.
- **`src/agent/`** — router, system prompt builder, turn loop (one search tool, verify retry).
- **`src/search/`** — Exa when keyed; otherwise Wikipedia API + DuckDuckGo Instant + Bing RSS + page fetch. Relevance filter, wiki markup cleaner, menu stripping.
- **`public/index.html`** — Rox-like UI, streaming status, `[n]` → source labels, source cards **below** the answer, follow-up cards.

### Turn modes

| Mode | When | Search |
| --- | --- | --- |
| `chat` | greetings / pure thread | no |
| `recall` | named day or “what did I ask” | no — archive only |
| `verify` | date + still/changed/price/shipped | open stored claim URLs; `web_search` if needed |
| `research` | default factual / “who is” | search first, then answer |

## Constraints we actually hit

1. **Paid search is expensive.** Exa / Tavily / SerpAPI quality is high; free tiers and empty keys are normal for a take-home. Without `EXA_API_KEY`, search falls back to public feeds. Bing RSS is noisy. DDG/Brave HTML often captchas. So the free path is **Wikipedia-first**, then Instant Answer, then Bing, with a hard relevance filter (no silent Agame / Amazon junk).
2. **Gemini free tier quotas.** Flash is fine for demos until 429/503. When the model fails, research still answers from cleaned page extracts via a **compose gate** (lead + Key facts + citations) instead of pasting raw HTML/wikitext.
3. **Cursor subscription ≠ an LLM API key** for this site. The app needs `GEMINI_API_KEY` (or Anthropic/OpenAI) in `.env`.
4. **No FTS5 / no embeddings in this Node build.** Recall is date window + token overlap. That matches the graded questions (dates and names) without a vector DB bill.
5. **One tool only.** The brief effectively wants one web tool. Gemini’s built-in Google Search was rejected so verify can open **stored URLs** and so search stays under our control.
6. **Timezone.** All relative dates resolve in `USER_TIMEZONE` (`Asia/Kolkata`).

## If there were budget

| Spend | What it buys |
| --- | --- |
| Exa or Tavily | Fewer irrelevant hits; better CRM / product queries |
| Paid Gemini / Anthropic | Reliable structured answers without falling back to extract composition |
| Voyage / OpenAI embeddings + SQLite/Postgres vector | Semantic recall beyond token overlap |
| Browserbase / Playwright pool | Real pricing-page renders when static fetch fails |
| Eval harness + frozen fixtures | Score episode hit, claim hit, and “every number cited” |

Choices we would keep even with money: prefetch memory (never a skippable memory tool), one search tool, deterministic dates, claim ledger + transcript-wins, page text as untrusted data.

## Guardrails (chatbot hygiene)

Things a serious chatbot needs, and what this repo does:

| Risk | Guardrail here |
| --- | --- |
| Prompt injection via pages | Search/page text is labeled as **data, not instructions** in the system prompt |
| Invented memories | Archive is **prefetched in code**; model cannot “skip” memory. Empty day → say so |
| Date hallucination | Dates parsed in code; prompt gets the resolved day |
| Hallucinated web facts | Research prefers retrieved pages; dirty/wiki answers are replaced by a structured compose from the best hit |
| Irrelevant search | `keepRelevant` drops hits that do not match topic terms; no fallback to random top results |
| Wiki / scrape junk | `cleanMarkup` / `cleanPlainText` strip templates, `[[links]]`, JSON crumbs; Wikipedia `explaintext` extracts preferred |
| Side-page contamination | Ranking demotes disambiguation, spouse, ministry lists unless asked |
| Tool loops | Research searches in the host when possible; verify requires search when needed and retries once |
| Secrets | Keys only in `.env` (gitignored); `.env.example` has empty placeholders |
| UI trust | Citations `[n]` link to source cards under the answer; follow-ups are explicit chips, not hidden state |

What is still thin (honest gaps): no auth, no rate limit per IP, no PII redaction pipeline, no multi-tenant isolation, no formal eval suite yet.

## Design choices (short)

- **Letta-style core + archive**, but archive is forced into the prompt path, not a tool the model can ignore.
- **Mem0-style write-after-turn** for claims so streaming is not blocked on extraction.
- **Code router**, not a second model — cheaper and stable for four modes.
- **Structured research answers** (Gemini-like lead + key facts + follow-ups) so quota fallbacks still look intentional.
- **Source cards under the text**, not a side rail that fights short paragraphs.

Longer rationale lives in [`DESIGN.md`](./DESIGN.md).

## Keys (`.env`)

| Variable | Role |
| --- | --- |
| `LLM_PROVIDER` | `google` / `anthropic` / `openai` |
| `GEMINI_API_KEY` | required for Google |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | when those providers are selected |
| `MODEL` | optional; default Gemini 2.5 Flash |
| `EXA_API_KEY` | optional; empty → keyless Wikipedia / Instant / Bing path |
| `USER_TIMEZONE` | default `Asia/Kolkata` |
| `PORT` | default `3000` |

## Repo map

```
src/server.ts          SSE chat API + static UI
src/agent/             route, prompt, run loop
src/memory/            SQLite, dates, recall, claims
src/search/            Exa + open-web fallback
public/index.html      chat UI
fixtures/history.jsonl sample archive for demos/tests
test/                  dates + recall (keyless)
DESIGN.md              one-page design rationale
```

## Remote

Saved on Cursor Origin: [minimi-assig](https://cursor.com/codebase/protyasish-majumder/minimi-assig).
