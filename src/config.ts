/**
 * src/config.ts
 * Central configuration for the RCC Drawing Element Analyzer.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

// ── Project root (one level above src/ or dist/) ──────────────────────────────
const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR: string = path.resolve(path.dirname(__filename), "..");

// Load .env file from project root if present
// override:true so values in .env win over any stale variables already
// exported in the shell (e.g. a leftover OPENAI_API_KEY from another project).
dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

// ── Directory layout ──────────────────────────────────────────────────────────
export const INPUT_DIR: string = path.join(ROOT_DIR, "input"); // PDF files placed here
export const OUTPUT_DIR: string = path.join(ROOT_DIR, "output"); // JSON reports written here

// ── Model provider settings (OpenAI or any OpenAI-compatible API) ─────────────
// To use OpenRouter: set in .env
//   OPENAI_BASE_URL=https://openrouter.ai/api/v1
//   OPENAI_API_KEY=sk-or-v1-...            (your OpenRouter key)
//   OPENAI_VISION_MODEL=google/gemini-2.5-pro   (any vision model slug)
// Leave OPENAI_BASE_URL empty to use OpenAI directly.
export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY ?? "";
export const OPENAI_BASE_URL: string = process.env.OPENAI_BASE_URL ?? "";
// Read model from OPENAI_VISION_MODEL env var; fall back to gpt-4.1-mini
export const OPENAI_MODEL: string = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";

// ── Two-model (agentic) pipeline ──────────────────────────────────────────────
// Design B: a STRONGER "cropper" model visually locates the regions worth
// reading and crops them via tool calls; a CHEAPER "extractor" model reads the
// element labels out of each crop.
//
// Set OPENAI_CROP_MODEL to a capable vision model to ENABLE agentic cropping.
// Leave it empty to keep the original deterministic grid-tiling pipeline.
export const OPENAI_CROP_MODEL: string = process.env.OPENAI_CROP_MODEL ?? "";
// The extractor (cheap) model — falls back to the shared OPENAI_VISION_MODEL.
export const OPENAI_EXTRACT_MODEL: string =
  process.env.OPENAI_EXTRACT_MODEL ?? OPENAI_MODEL;
// Optional per-stage provider overrides for the cropper (default to the shared
// client so a single key/endpoint keeps working out of the box).
export const OPENAI_CROP_BASE_URL: string =
  process.env.OPENAI_CROP_BASE_URL ?? OPENAI_BASE_URL;
export const OPENAI_CROP_API_KEY: string =
  process.env.OPENAI_CROP_API_KEY ?? OPENAI_API_KEY;
// The cropper sees a DOWNSCALED full page (region-finding is a coarse judgement
// that does not need 400-DPI detail). Long side of that preview, in pixels.
export const CROP_PAGE_MAX_DIM = 1600;
// Safety cap on the cropper's agent loop (tool-call turns) per page.
export const MAX_CROP_CALLS = 30;

// ── Structural Elements to Detect ─────────────────────────────────────────────
export const STRUCTURAL_ELEMENTS = ["BEAM", "SLAB", "COLUMN", "FOOTING"] as const;
export type StructuralElement = (typeof STRUCTURAL_ELEMENTS)[number];

// ── PDF Processing ────────────────────────────────────────────────────────────
// Resolution for rendering PDF pages to images (higher = more detail for OCR)
export const PDF_DPI = 400;

// ── Tiling ────────────────────────────────────────────────────────────────────
// Large sheets (A1/A0) are split into overlapping high-res tiles instead of
// being downscaled to one image — downscaling made 2–3 mm labels illegible.
// OpenAI "high detail" caps the useful resolution around 768 px on the short
// side, so tiles near that size are sent essentially loss-free.
export const TILE_SIZE = 1024; // px, tile width/height at PDF_DPI
export const TILE_OVERLAP = 160; // px shared between neighbouring tiles (> label size)
// Same label reported by two DIFFERENT tiles within this page-pixel distance
// is one physical label seen twice through the overlap. Must be larger than
// the model's position estimation error, smaller than real label spacing.
export const DEDUPE_RADIUS_PX = 160;
export const TILE_CONCURRENCY = 4; // parallel vision requests per page
// Tiles whose pixel stddev is below this are treated as blank and skipped.
export const BLANK_TILE_STD_THRESHOLD = 1.5;

// Max tokens for the model's JSON reply. Dense pages can have 100+ labels;
// a low cap truncates the JSON mid-array and the page silently returns empty.
export const MAX_COMPLETION_TOKENS = 4096;

// ── Label normalisation (post-processing) ─────────────────────────────────────
// CAD label suffixes practically never use "q"; the vision model misreads
// stroke-drawn "g"/"a" as "q". When true, a trailing "q" after digits is
// rewritten to "g" (e.g. B32q -> B32g).
export const NORMALIZE_TRAILING_Q = true;

// Vision models sometimes merge an adjacent dimension number into a label
// ("B50a" next to "750" becomes "B750a"). When true, beam labels whose
// number is >= 300 and a multiple of 25 (300, 450, 750, 1050...) are treated
// as dimension-merge artefacts and dropped.
export const DROP_DIMENSION_MERGES = true;

// ── Output ────────────────────────────────────────────────────────────────────
export const DEFAULT_OUTPUT_SUFFIX = "_elements.json";

// ── Debug artifacts (per-crop images + JSON) ──────────────────────────────────
// When enabled, every crop tile image and its RAW extraction JSON are written
// to  output/<pdf>_crops/page_<n>/...  together with the cropper's chosen
// regions and the merged page result. Lets you inspect exactly what each crop
// looked like and what was read from it. Set SAVE_ARTIFACTS=0 to turn off.
export const SAVE_ARTIFACTS = (process.env.SAVE_ARTIFACTS ?? "1") !== "0";
// Folder suffix (next to the summary JSON) that holds the crop artifacts.
export const ARTIFACTS_SUFFIX = "_crops";

// ── Cropper Prompt (agentic, strong model) ────────────────────────────────────
// Sent with a DOWNSCALED full-page image to the cropper model. The model must
// call the crop_region tool for every region worth reading, then finish.
export const CROP_PROMPT = `You are an expert RCC/civil structural drawing interpreter.
You are looking at ONE full sheet from a structural drawing set (it may be A0/A1
size, so small labels are hard to read at this zoom — that is expected).

Your ONLY job is to LOCATE the regions of this sheet that should be read closely
for structural element labels (BEAM / SLAB / COLUMN / FOOTING), and crop each
one by calling the "crop_region" tool. You do NOT read or list the labels
yourself — a second pass will do that on your crops.

CROP these regions (call crop_region once per region):
  - The main LAYOUT / PLAN drawing area(s) (floor plan, framing plan, column
    layout, foundation layout).
  - CROSS-SECTION / SECTIONAL / detail views that carry element labels.
  - If the drawing area is large, split it into several ADJACENT, slightly
    OVERLAPPING regions so that no label sits exactly on a crop border. Aim for
    regions that are a readable fraction of the sheet (roughly 1/4 to 1/9 of the
    sheet each for dense plans), not one giant crop.

DO NOT crop (ignore these entirely):
  - Schedules / reinforcement tables (Beam/Column/Footing/Slab schedules,
    bar-bending schedules) — any gridded table of element details.
  - Title blocks, revision clouds, notes boxes, legends, key plans.
  - Empty margins.

COORDINATES: give x1,y1,x2,y2 as fractions of the whole sheet in [0,1], where
(0,0) is the TOP-LEFT and (1,1) is the BOTTOM-RIGHT. x1<x2 and y1<y2.
Give each region a short "label" (e.g. "plan-top-left", "section-A", "column-layout")
and a "kind" of "plan", "section", or "other".

When you have cropped every relevant region, call "finish".
If the sheet contains ONLY schedules/title blocks and no layout drawing, call
"finish" immediately without cropping anything.`;

// ── Prompt Template ───────────────────────────────────────────────────────────
// Sent with each page image to the OpenAI vision model.
// The model must reply ONLY with valid JSON matching the schema below.
export const EXTRACTION_PROMPT = `You are an expert RCC/civil structural engineer and drawing interpreter.
Your task is to extract ALL structural element labels from this drawing image with high precision,
AND count how many times each label physically appears in it.

================================================================
TILE CONTEXT — THIS IMAGE IS A CROP OF A LARGER SHEET
================================================================
This image is one tile cropped from a larger drawing sheet. Neighbouring
tiles overlap slightly, so:
  - IGNORE any label that is clipped / cut off by the image border —
    it will be read completely in the adjacent tile.
  - Count ONLY labels that are FULLY visible inside this image.
  - The tile may legitimately contain nothing (empty margin, hatching,
    dimension lines only). In that case return all zeros — do NOT invent labels.

================================================================
IMPORTANT — WHAT TO READ (AND WHAT TO IGNORE)
================================================================
IGNORE completely:
  - Any SCHEDULE or REINFORCEMENT TABLE on this page (e.g. "Beam Schedule",
    "Column Schedule", "Footing Schedule", "Slab Schedule", bar-bending
    schedules, or any grid/tabular list of elements with reinforcement details).
  - Title blocks, revision clouds, notes boxes, legends, or key tables.

READ ONLY from the actual LAYOUT DRAWING, using this priority order:
  1. CROSS-SECTIONAL / SECTIONAL VIEW — section cuts, detail sections,
     elevation sections showing element labels (highest priority).
  2. PLAN / TOP VIEW — floor plan or structural layout plan markings
     (use when no cross-section is present on the page).

If a page contains ONLY a schedule/table and no layout drawing, return
all counts as 0 and all label lists as empty.


================================================================
ELEMENT-SPECIFIC LABEL PATTERNS
================================================================

--- BEAM ---
Recognise ANY label that denotes a beam, including:

  Standard beams       : B1, B2, B2a, B3b, B-1, B-2
  Continuous beams     : B2a, B2b or BB1 , BB2 , BB4 (suffix letter = span segment)
  Lintel beams         : LB1, LB1A, LB-1, LB12
  Plinth beams         : PB1, PB-1, PB1a, PTBB1, PB1(300x600)
  Stair beams          : SB1, SBT1, STB_B2, STB_B2(300x450)
  Cantilever beams     : CB1, CB1a
  Drop beams           : DB1, DB1a
  Tie beams            : TB1, TB1a, TB-1
  Hidden beams         : HB, HB1
  Master/Main beams    : MB1, MB-1
  Raft beams           : RB1, RB1(300x600)
  Perimeter beams      : P1, P1(300x600)
  Secondary beams      : bs1, bs2a  (lowercase accepted)
  Anchorage beams      : AB1, AB-1
  Basement beams       : BB1, BB-1
  Floor/Fascia beams   : FFB12, TFB1
  Roof ridge/rafter    : RR
  Floor-tagged beams   : 1F_B47(200x450), MF_B8, LGF_B53(300x550),
                         UGF_B97a(450), SGF_B43(450x600), LPTB-5(900x550)
  Grouped (split each) : (B1,B2), (B1+B2)  -> record "B1" and "B2" separately
  Compound (keep whole): LBK1+LBK12  -> record as single label "LBK1+LBK12"
  Slash chains (keep whole): B23c/RMB1, B25a/RMB1, LB1/B24/RMB1
                         -> ONE label, the full chain exactly as printed.
                         The segments may be drawn in DIFFERENT COLOURS or
                         layers (e.g. "LB1/" cyan, "B24" yellow, "/RMB1" cyan)
                         but they sit on one line over one beam: read the whole
                         run of text joined by "/" as a single label. NEVER
                         report "LB1", "B24" or "RMB1" separately when they are
                         connected by "/".
  Label with size      : B1(300x600), PB1(300x600) — include the size string

  Key prefixes: B, PB, LB, SB, CB, DB, TB, HB, MB, RB, AB, BB, bs,
                FFB, TFB, STB, SBT, LBK, PTBB, LPTB, _B (floor-tagged)

--- SLAB ---
Slabs appear either as a named label or as a grid panel:

  Named labels   : S1, S2, SQ, S1M, STB1, FS1, RS1
  Grid layout    : Page shows X-axis letters (A, B, C...) and Y-axis numbers
                   (1, 2, 3...). Each panel is identified by its bounding grid
                   lines, e.g. "A-B / 1-2". Capture each distinct panel label.

  GRID REPETITION RULE: Count each physical occurrence of the same slab label
  separately. If S1 appears in 4 panels on this page, record count=4.

  Key prefixes: S, FS, RS, SQ, STB (slab), SM

--- COLUMN ---
Read from TOP VIEW column layout plan or column schedule table.

  Standard columns     : C1, C2, C34, C1A, C-1
  Shear walls          : SW1, SW-1, SW1A, BSW1
  Grouped shear walls  : (SW1+SW1A)  -> record as single label
  Load-bearing walls   : LW1, RW1
  Pedestal columns     : PC1, PC206-12, PC197A-8
  Arch/Special cols    : AC1, GC1, BC1, NC1, SC1 (Steam column)
  Circular pedestal    : CP1
  Stub/Stump columns   : r2  (lowercase accepted)
  Tier-tagged cols     : TA-C1, TB-C1, TC-C1
  Pillar/Pier          : P1, P11A
  Timber/Steel cols    : TW33, W23a

  Key prefixes: C, SW, LW, PC, AC, GC, BC, NC, SC, CP, RW, BSW,
                TA-, TB-, TC-, TW, W, P (pier/pillar)

--- FOOTING ---
PRIORITY: Read from "Schedule of Footings" table when available.
Footings are often cross-referenced by column number (C1 -> F for that column).

  Isolated footings    : F1, F2, F1A
  Raft foundations     : R1, Raft-1, ARF1
  Combined footings    : CF1, BRF2
  Pile caps            : PC1, CP1, FP1
  Basement footings    : BF1, NF1, FC1
  Anchor footings      : AF1
  Retaining wall ftg   : RW (Retaining Wall), CWF1, CWF2A
  Named by column ref  : C1, C12  (when listed in footing schedule as col ref)

  Key prefixes: F, BF, CF, AF, NF, FC, FP, ARF, CWF, RW, R (raft),
                Raft, PC (pile cap), CP, C (only when in footing schedule)

================================================================
EXTRACTION RULES
================================================================
1. Extract the EXACT label string as printed — preserve case, suffixes (a/A),
   dimension strings (300x600), floor prefixes (1F_, MF_, LGF_), hyphens, etc.
   CHARACTER-ACCURACY WARNINGS (labels are stroke-drawn CAD text):
   - Suffix letters are usually a, b, c, d, e, f, g, h. A letter that looks
     like "q" is almost always a misread "g" or "a" — look again.
   - Do NOT merge nearby standalone dimension numbers (450, 750, 1050...) into
     a label. "B50a" next to a "750" dimension is "B50a", never "B750a".
   - Standalone words are NOT labels: "BEAM", "RCC SLAB", "UP", "DN", "TYP",
     "C", "SB", grid letters (A, B, G, H...) and bare numbers must be ignored.
2. If a size is appended to the label e.g. B1(300x600), include the full string.
3. Grouped labels like (B1,B2) or (B1+B2) -> split into individual labels.
4. Compound labels like LBK1+LBK12 -> keep as ONE label string.
5. For each distinct label, count HOW MANY TIMES it physically appears in this
   image in the layout drawing. This is the "count" field inside each label object.
   Example: if B1 is drawn in 5 places in this image, its count=5.
   Count by actually locating each occurrence — do NOT estimate or round.
6. total_distinct = number of unique label strings found for that element type.
7. If an element type has no labels on this page -> total_distinct=0, labels=[].
8. Do NOT guess or hallucinate. Only report what is explicitly visible/legible.
9. CLASSIFY STRICTLY BY PREFIX. Never place a label under the wrong element:
   - "S" + digits (S1, S13, S23...)          -> ALWAYS SLAB, never COLUMN.
   - "B"/"RMB"/"LB" + digits (B5a, RMB1...)  -> ALWAYS BEAM, never SLAB.
   - "C" + digits (C1, C12...)               -> COLUMN (unless in a footing schedule).
10. For EVERY occurrence, also report its approximate centre position within
    THIS image as {"x": <0-1000>, "y": <0-1000>} — x=0 is the left edge,
    x=1000 the right edge, y=0 the top, y=1000 the bottom. The number of
    positions MUST equal "count". Positions are used to de-duplicate the
    overlap between tiles, so estimate them as carefully as you can.
11. Return ONLY a valid JSON object — no explanation, no markdown fences.

================================================================
REQUIRED OUTPUT  (strict JSON, no extra text outside the braces)
================================================================
{
  "BEAM":    {"labels": [{"label": <str>, "count": <int>, "positions": [{"x": <int>, "y": <int>}, ...]}, ...]},
  "SLAB":    {"labels": [...]},
  "COLUMN":  {"labels": [...]},
  "FOOTING": {"labels": [...]}
}

Example for an image with beam B1 appearing 2 times and slab S4 once:
{
  "BEAM":    {"labels": [{"label": "B1", "count": 2, "positions": [{"x": 120, "y": 340}, {"x": 700, "y": 855}]}]},
  "SLAB":    {"labels": [{"label": "S4", "count": 1, "positions": [{"x": 480, "y": 500}]}]},
  "COLUMN":  {"labels": []},
  "FOOTING": {"labels": []}
}
`;
