/**
 * src/cropper.ts
 * Agentic "cropper" stage (Design B).
 *
 * A STRONG vision model looks at a downscaled preview of the whole sheet and,
 * using tool calls, marks the regions worth reading closely (layout plans,
 * section views) while ignoring schedules, title blocks and legends. It does
 * NOT read labels itself — a cheaper extractor model reads each returned crop.
 *
 * The cropper returns regions as fractional boxes in [0,1] over the full sheet;
 * main.ts maps them to full-resolution page pixels and tiles them for the
 * extractor.
 */

import OpenAI from "openai";

import {
  OPENAI_CROP_API_KEY,
  OPENAI_CROP_BASE_URL,
  OPENAI_CROP_MODEL,
  CROP_PROMPT,
  MAX_CROP_CALLS,
  MAX_COMPLETION_TOKENS,
} from "./config.js";
import { makeClient } from "./aiExtractor.js";

/** A region of interest as fractions of the whole sheet, top-left origin. */
export interface CropRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  kind: string;
}

// ── Client ────────────────────────────────────────────────────────────────────
let _cropClient: OpenAI | null = null;

function getCropperClient(): OpenAI {
  if (_cropClient === null) {
    _cropClient = makeClient(OPENAI_CROP_API_KEY, OPENAI_CROP_BASE_URL);
  }
  return _cropClient;
}

// ── Region normalisation ───────────────────────────────────────────────────────
/** Smallest crop side (fraction of the sheet) we bother extracting from. */
const MIN_REGION_FRACTION = 0.01;

/**
 * Coerce a raw tool-call argument object into a clean CropRegion, or null when
 * it is unusable. Accepts fractional [0,1] coords; also tolerates 0–1000 or
 * 0–100 scales by rescaling, and swaps reversed corners.
 */
export function normalizeRegion(raw: unknown): CropRegion | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  let x1 = Number(obj.x1);
  let y1 = Number(obj.y1);
  let x2 = Number(obj.x2);
  let y2 = Number(obj.y2);
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;

  // Rescale if the model used 0–1000 or 0–100 instead of 0–1. Only trigger
  // when clearly out of fractional range (maxV > 2) so a fractional box that
  // merely overshoots by a hair (e.g. x2=1.02) is just clamped, not rescaled.
  const maxV = Math.max(x1, y1, x2, y2);
  if (maxV > 2) {
    const divisor = maxV > 100 ? 1000 : 100;
    x1 /= divisor;
    y1 /= divisor;
    x2 /= divisor;
    y2 /= divisor;
  }

  // Clamp to the sheet.
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  x1 = clamp(x1);
  y1 = clamp(y1);
  x2 = clamp(x2);
  y2 = clamp(y2);

  // Fix reversed corners.
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];

  // Reject degenerate / tiny regions.
  if (x2 - x1 < MIN_REGION_FRACTION || y2 - y1 < MIN_REGION_FRACTION) return null;

  const label = String(obj.label ?? "region").trim() || "region";
  const kind = String(obj.kind ?? "other").trim() || "other";
  return { x1, y1, x2, y2, label, kind };
}

// ── Tool definitions ────────────────────────────────────────────────────────────
const CROP_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "crop_region",
      description:
        "Mark ONE region of the sheet to read closely for structural element " +
        "labels. Coordinates are fractions of the whole sheet in [0,1], " +
        "top-left origin, with x1<x2 and y1<y2.",
      parameters: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Short name for this region, e.g. 'plan-top-left'.",
          },
          kind: {
            type: "string",
            enum: ["plan", "section", "other"],
            description: "What kind of view this region is.",
          },
          x1: { type: "number", description: "Left edge (0-1)." },
          y1: { type: "number", description: "Top edge (0-1)." },
          x2: { type: "number", description: "Right edge (0-1)." },
          y2: { type: "number", description: "Bottom edge (0-1)." },
        },
        required: ["x1", "y1", "x2", "y2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Call once every relevant region has been cropped (or immediately if " +
        "the sheet has no layout drawing to read).",
      parameters: {
        type: "object",
        properties: {
          notes: {
            type: "string",
            description: "Optional note about the sheet layout.",
          },
        },
      },
    },
  },
];

// ── Agent loop ──────────────────────────────────────────────────────────────────
/**
 * Run the cropper agent on a downscaled page preview. Returns the regions it
 * chose (possibly empty — caller should fall back to whole-page tiling then).
 */
export async function cropPage(
  pageNumber: number,
  base64Preview: string,
): Promise<CropRegion[]> {
  const client = getCropperClient();
  const imageUrl = `data:image/png;base64,${base64Preview}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: CROP_PROMPT },
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
      ],
    },
  ];

  const regions: CropRegion[] = [];

  for (let turn = 0; turn < MAX_CROP_CALLS; turn++) {
    const response = await client.chat.completions.create({
      model: OPENAI_CROP_MODEL,
      messages,
      tools: CROP_TOOLS,
      tool_choice: "auto",
      temperature: 0,
      max_tokens: MAX_COMPLETION_TOKENS,
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;
    messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) break; // model stopped calling tools

    let finished = false;
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let args: unknown = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }

      let content: string;
      if (tc.function.name === "crop_region") {
        const region = normalizeRegion(args);
        if (region) {
          regions.push(region);
          content = `OK — region ${regions.length} recorded (${region.label}).`;
        } else {
          content = "Ignored — invalid or too-small region.";
        }
      } else if (tc.function.name === "finish") {
        finished = true;
        content = `Done — ${regions.length} region(s) recorded.`;
      } else {
        content = `Unknown tool: ${tc.function.name}`;
      }

      messages.push({ role: "tool", tool_call_id: tc.id, content });
    }

    if (finished) break;
  }

  console.log(`  [Page ${pageNumber}] cropper marked ${regions.length} region(s).`);
  return regions;
}
