/**
 * src/aiExtractor.ts
 * Sends page images to OpenAI gpt-4.1-mini (vision) and parses structured
 * element-repetition data for BEAM, SLAB, COLUMN, and FOOTING.
 */

import OpenAI from "openai";

import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  EXTRACTION_PROMPT,
  STRUCTURAL_ELEMENTS,
  MAX_COMPLETION_TOKENS,
} from "./config.js";
import type {
  ElementResult,
  OccurrenceEntry,
  Position,
  TileExtraction,
} from "./types.js";

// ── Client ──────────────────────────────────────────────────────────────────
let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client === null) {
    if (!OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is not set. " +
          "Create a .env file with OPENAI_API_KEY=sk-... (or an OpenRouter " +
          "sk-or-v1-... key together with OPENAI_BASE_URL).",
      );
    }
    _client = new OpenAI({
      apiKey: OPENAI_API_KEY,
      // Any OpenAI-compatible endpoint, e.g. OpenRouter:
      // https://openrouter.ai/api/v1 — empty string means api.openai.com.
      ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
      // Optional OpenRouter attribution headers (harmless for OpenAI).
      defaultHeaders: {
        "X-Title": "RCC Drawing Element Analyzer",
      },
    });
  }
  return _client;
}

// ── Empty results ─────────────────────────────────────────────────────────────
export function emptyResult(): ElementResult {
  const result = {} as ElementResult;
  for (const el of STRUCTURAL_ELEMENTS) {
    result[el] = { total_distinct: 0, labels: [] };
  }
  return result;
}

export function emptyExtraction(): TileExtraction {
  const result = {} as TileExtraction;
  for (const el of STRUCTURAL_ELEMENTS) {
    result[el] = [];
  }
  return result;
}

// ── JSON extraction from model response ───────────────────────────────────────
/** Parse one raw position object into 0–1000 tile units, or null if invalid. */
function parsePosition(item: unknown): Position | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  const x = Number(obj.x);
  const y = Number(obj.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.min(1000, Math.max(0, Math.round(x))),
    y: Math.min(1000, Math.max(0, Math.round(y))),
  };
}

/**
 * Extract the JSON object from the model's response text. Handles markdown
 * code fences. Expects `{"label":"B1","count":2,"positions":[{"x":..,"y":..}]}`;
 * falls back to count-only objects and bare strings for robustness.
 */
export function parseResponse(raw: string): TileExtraction {
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

  const result = emptyExtraction();
  for (const element of STRUCTURAL_ELEMENTS) {
    const entry = data[element];
    if (entry === undefined || entry === null || typeof entry !== "object") {
      continue;
    }
    const entryObj = entry as Record<string, unknown>;
    const rawLabels = Array.isArray(entryObj.labels) ? entryObj.labels : [];

    const normalised: OccurrenceEntry[] = [];
    for (const item of rawLabels) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const lbl = String(obj.label ?? "").trim();
        if (!lbl) continue;

        const positions: Position[] = [];
        if (Array.isArray(obj.positions)) {
          for (const p of obj.positions) {
            const pos = parsePosition(p);
            if (pos) positions.push(pos);
          }
        }
        const cntRaw = Number.parseInt(String(obj.count ?? (positions.length || 1)), 10);
        // When positions are given, they are the source of truth for count.
        const count = positions.length > 0
          ? positions.length
          : Number.isNaN(cntRaw) || cntRaw < 1
            ? 1
            : cntRaw;
        normalised.push({ label: lbl, count, positions });
      } else if (typeof item === "string") {
        // Old flat-string fallback: treat count as 1, no position info
        const lbl = item.trim();
        if (lbl) {
          normalised.push({ label: lbl, count: 1, positions: [] });
        }
      }
    }

    result[element] = normalised;
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
): Promise<TileExtraction> {
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
        max_tokens: MAX_COMPLETION_TOKENS,
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
        return emptyExtraction();
      } else {
        throw exc;
      }
    }
  }

  throw new Error(
    `[Page ${pageNumber}] Failed after ${maxRetries} attempts. Last error: ${String(lastError)}`,
  );
}
