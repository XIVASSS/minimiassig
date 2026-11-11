# Chat agent

A Node chat agent with one tool, web search, and a local memory of what was said on a given day.

## Run

```bash
npm install
cp .env.example .env
npm run import -- fixtures/history.jsonl
npm run dev
```

Open the URL the server prints. Dates are interpreted in `Asia/Kolkata`.

`npm test` checks date parsing and recall. It does not call a model or the web.

## Keys

Set these in `.env`:

- `LLM_PROVIDER` — `google`, `anthropic`, or `openai`
- `GEMINI_API_KEY` — required when the provider is Google
- `ANTHROPIC_API_KEY` — required when the provider is Anthropic
- `OPENAI_API_KEY` — required when the provider is OpenAI
- `MODEL` — optional override
- `EXA_API_KEY` — optional. When it is empty, web search uses the public results feed and fetches the pages itself
- `USER_TIMEZONE` — default `Asia/Kolkata`
- `PORT` — default `3000`

`POST /api/chat` accepts `{ "message", "sessionId", "at" }`. Omit `at` and the turn is stamped now. Set `at` to replay an older day.
