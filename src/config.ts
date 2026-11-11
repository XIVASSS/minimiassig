import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "google" | "anthropic" | "openai";

export function timezone(): string {
  return process.env.USER_TIMEZONE || "Asia/Kolkata";
}

export function port(): number {
  return Number(process.env.PORT || 3000);
}

export function providerName(): ProviderName {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "google") return raw;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  return "anthropic";
}

function geminiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim();
}

export function requireModel(): LanguageModel {
  const provider = providerName();
  const chosen = process.env.MODEL?.trim();
  if (provider === "google") {
    const key = geminiKey();
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    return createGoogleGenerativeAI({ apiKey: key })(chosen || "gemini-2.5-flash");
  }
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    return openai(chosen || "gpt-4.1");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return anthropic(chosen || "claude-sonnet-4-5");
}
