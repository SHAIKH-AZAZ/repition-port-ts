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
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// ── Directory layout ──────────────────────────────────────────────────────────
export const INPUT_DIR: string = path.join(ROOT_DIR, "input"); // PDF files placed here
export const OUTPUT_DIR: string = path.join(ROOT_DIR, "output"); // JSON reports written here

// ── OpenAI Settings ───────────────────────────────────────────────────────────
export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY ?? "";
// Read model from OPENAI_VISION_MODEL env var; fall back to gpt-4.1-mini
export const OPENAI_MODEL: string = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";

// ── Structural Elements to Detect ─────────────────────────────────────────────
export const STRUCTURAL_ELEMENTS = ["BEAM", "SLAB", "COLUMN", "FOOTING"] as const;
export type StructuralElement = (typeof STRUCTURAL_ELEMENTS)[number];

// ── PDF Processing ────────────────────────────────────────────────────────────
// Resolution for rendering PDF pages to images (higher = more detail for OCR)
export const PDF_DPI = 200;

// Maximum image dimension (px) to keep API payload manageable
export const MAX_IMAGE_DIM = 2048;

// ── Output ────────────────────────────────────────────────────────────────────
export const DEFAULT_OUTPUT_SUFFIX = "_elements.json";

// ── Prompt Template ───────────────────────────────────────────────────────────
// Sent with each page image to the OpenAI vision model.
// The model must reply ONLY with valid JSON matching the schema below.
export const EXTRACTION_PROMPT = `You are an expert RCC/civil structural engineer and drawing interpreter.
Your task is to extract ALL structural element labels from this drawing page with high precision,
AND count how many times each label physically appears on the page.

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
2. If a size is appended to the label e.g. B1(300x600), include the full string.
3. Grouped labels like (B1,B2) or (B1+B2) -> split into individual labels.
4. Compound labels like LBK1+LBK12 -> keep as ONE label string.
5. For each distinct label, count HOW MANY TIMES it physically appears on this
   page in the layout drawing. This is the "count" field inside each label object.
   Example: if B1 is drawn in 5 places on this page, its count=5.
6. total_distinct = number of unique label strings found for that element type.
7. If an element type has no labels on this page -> total_distinct=0, labels=[].
8. Do NOT guess or hallucinate. Only report what is explicitly visible/legible.
9. Return ONLY a valid JSON object — no explanation, no markdown fences.

================================================================
REQUIRED OUTPUT  (strict JSON, no extra text outside the braces)
================================================================
{
  "BEAM":    {"total_distinct": <int>, "labels": [{"label": <str>, "count": <int>}, ...]},
  "SLAB":    {"total_distinct": <int>, "labels": [{"label": <str>, "count": <int>}, ...]},
  "COLUMN":  {"total_distinct": <int>, "labels": [{"label": <str>, "count": <int>}, ...]},
  "FOOTING": {"total_distinct": <int>, "labels": [{"label": <str>, "count": <int>}, ...]}
}

Example for a page with beams B1 appearing 5 times and B2 appearing 2 times:
{
  "BEAM":    {"total_distinct": 2, "labels": [{"label": "B1", "count": 5}, {"label": "B2", "count": 2}]},
  "SLAB":    {"total_distinct": 0, "labels": []},
  "COLUMN":  {"total_distinct": 0, "labels": []},
  "FOOTING": {"total_distinct": 0, "labels": []}
}
`;
