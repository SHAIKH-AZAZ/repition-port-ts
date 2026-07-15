/**
 * src/aiExtractor.ts
 * Sends page images to OpenAI gpt-4.1-mini (vision) and parses structured
 * element-repetition data for BEAM, SLAB, COLUMN, and FOOTING.
 */

import OpenAI from "openai";

import {
  OPENAI_API_KEY,
  OPENAI_MODEL,
  EXTRACTION_PROMPT,
  STRUCTURAL_ELEMENTS,
} from "./config.js";
import type { ElementResult, LabelEntry } from "./types.js";

// ── Client ──────────────────────────────────────────────────────────────────
let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client === null) {
    if (!OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is not set. " +
          "Create a .env file with OPENAI_API_KEY=sk-... or set the env variable.",
      );
    }
    _client = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return _client;
}

// ── Empty page result ─────────────────────────────────────────────────────────
export function emptyResult(): ElementResult {
  const result = {} as ElementResult;
  for (const el of STRUCTURAL_ELEMENTS) {
    result[el] = { total_distinct: 0, labels: [] };
  }
  return result;
}

// ── JSON extraction from model response ───────────────────────────────────────
/**
 * Extract the JSON object from the model's response text. Handles markdown
 * code fences. Expects per-label objects `{"label":"B1","count":5}` but falls
 * back to bare strings `["B1","B2"]` for backward compatibility.
 */
export function parseResponse(raw: string): ElementResult {
  // Strip markdown fences if present
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "");
  text = text.replace(/\s*```$/, "");

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch (exc) {
    throw new Error(`Model returned non-JSON response: ${JSON.stringify(raw)}`);
  }

  const result = emptyResult();
  for (const element of STRUCTURAL_ELEMENTS) {
    const entry = data[element];
    if (entry === undefined || entry === null || typeof entry !== "object") {
      continue;
    }
    const entryObj = entry as Record<string, unknown>;
    const rawLabels = Array.isArray(entryObj.labels) ? entryObj.labels : [];

    const normalised: LabelEntry[] = [];
    for (const item of rawLabels) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        // New format: {"label": "B1", "count": 5}
        const obj = item as Record<string, unknown>;
        const lbl = String(obj.label ?? "").trim();
        const cnt = Number.parseInt(String(obj.count ?? 1), 10);
        if (lbl) {
          normalised.push({ label: lbl, count: Number.isNaN(cnt) ? 1 : cnt });
        }
      } else if (typeof item === "string") {
        // Old flat-string fallback: treat count as 1
        const lbl = item.trim();
        if (lbl) {
          normalised.push({ label: lbl, count: 1 });
        }
      }
    }

    const totalDistinctRaw = Number.parseInt(String(entryObj.total_distinct ?? normalised.length), 10);
    result[element] = {
      total_distinct: Number.isNaN(totalDistinctRaw) ? normalised.length : totalDistinctRaw,
      labels: normalised,
    };
  }

  return result;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Main extraction function ──────────────────────────────────────────────────
/**
 * Send a single page image to the OpenAI vision model and return a dict of
 * structural element counts/labels.
 */
export async function extractElementsFromImage(
  pageNumber: number,
  base64Png: string,
  maxRetries = 3,
  retryDelaySec = 5.0,
): Promise<ElementResult> {
  const client = getClient();
  const imageUrl = `data:image/png;base64,${base64Png}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: EXTRACTION_PROMPT },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    },
  ];

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0, // deterministic output
      });
      const rawText = response.choices[0]?.message?.content ?? "";
      return parseResponse(rawText);
    } catch (exc) {
      if (exc instanceof OpenAI.RateLimitError) {
        lastError = exc;
        const wait = retryDelaySec * attempt;
        console.log(
          `  [Page ${pageNumber}] Rate limit hit. Waiting ${wait}s (attempt ${attempt}/${maxRetries})...`,
        );
        await sleep(wait * 1000);
      } else if (exc instanceof OpenAI.APIError) {
        lastError = exc;
        if (attempt < maxRetries) {
          console.log(
            `  [Page ${pageNumber}] API error: ${exc.message}. Retrying in ${retryDelaySec}s...`,
          );
          await sleep(retryDelaySec * 1000);
        } else {
          throw exc;
        }
      } else if (exc instanceof Error && exc.message.startsWith("Model returned non-JSON")) {
        // Bad JSON from model — log and return empty rather than crash
        console.log(`  [Page ${pageNumber}] WARNING: Could not parse model response: ${exc.message}`);
        return emptyResult();
      } else {
        throw exc;
      }
    }
  }

  throw new Error(
    `[Page ${pageNumber}] Failed after ${maxRetries} attempts. Last error: ${String(lastError)}`,
  );
}
