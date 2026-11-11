import { generateText, Output } from "ai";
import { z } from "zod";
import { requireModel } from "../config.js";
import type { ClaimInput } from "./db.js";

const schema = z.object({
  summary: z.string().describe("One sentence on what this turn was about"),
  entities: z.array(z.string()).describe("Product, company, and topic names"),
  topics: z.array(z.string()),
  claims: z.array(
    z.object({
      subject: z.string(),
      attribute: z.string(),
      value: z.string().describe("The value the assistant actually stated"),
      sources: z.array(z.string()).describe("URLs cited in the answer, or empty"),
    }),
  ),
});

export type Extraction = z.infer<typeof schema>;

export async function extractTurn(user: string, assistant: string): Promise<Extraction | null> {
  try {
    const result = await generateText({
      model: requireModel(),
      system:
        "Extract a memory index from one chat turn. Copy claims only from the assistant text. Do not invent prices, sources, or entities. If the assistant cited no URL, sources is empty.",
      prompt: `User:\n${user}\n\nAssistant:\n${assistant}`,
      experimental_output: Output.object({ schema }),
    });
    const parsed = result.experimental_output;
    return {
      summary: parsed.summary.slice(0, 400),
      entities: parsed.entities.slice(0, 12),
      topics: parsed.topics.slice(0, 8),
      claims: parsed.claims.slice(0, 12).map((claim) => ({
        ...claim,
        sources: claim.sources.filter((source) => /^https?:\/\//i.test(source)),
      })),
    };
  } catch (error) {
    console.error("Claim extraction failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function fallbackExtraction(assistant: string): Extraction {
  return {
    summary: assistant.slice(0, 240),
    entities: [],
    topics: [],
    claims: [] satisfies ClaimInput[],
  };
}
