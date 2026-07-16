/**
 * src/postProcess.ts
 * Deterministic cleanup of per-tile vision results:
 *
 * 1. CROSS-TILE DEDUPE — tiles overlap by TILE_OVERLAP px, so a label lying
 *    in the shared band is reported by two tiles. The same label reported by
 *    two DIFFERENT tiles within DEDUPE_RADIUS_PX page-pixels is one physical
 *    label seen twice — it is counted once. Same-tile occurrences are never
 *    merged (the model counted genuinely distinct spots).
 *
 * 2. RE-BUCKETING — labels are re-assigned to the element type their prefix
 *    dictates (an "S13" reported under COLUMN is moved to SLAB). When a label
 *    is valid for the element the model chose (e.g. "P1" is both a perimeter
 *    beam and a pier), the model's choice is kept.
 *
 * 3. NORMALISATION / JUNK DROP — known misread patterns are corrected
 *    (trailing "q" -> "g", dimension-merge artefacts dropped); strings that
 *    match no element pattern ("BEAM", "RCC SLAB", "UP", bare grid letters,
 *    bare numbers) are discarded.
 */

import {
  STRUCTURAL_ELEMENTS,
  DEDUPE_RADIUS_PX,
  NORMALIZE_TRAILING_Q,
  DROP_DIMENSION_MERGES,
} from "./config.js";
import type { StructuralElement } from "./config.js";
import type { ElementResult, LabelEntry, TileExtraction } from "./types.js";
import type { PageTile } from "./pdfProcessor.js";

// ── Label patterns per element ────────────────────────────────────────────────
// Optional trailing "(300x600)" size string allowed everywhere.
const SIZE = String.raw`(?:\(\d+\s*[xX]\s*\d+\))?`;

const PATTERNS: Record<StructuralElement, RegExp[]> = {
  BEAM: [
    // Optional floor prefix (1F_, MF_, LGF_, UGF_, SGF_...), then a beam
    // prefix, number, optional decimal part, optional span-suffix letter.
    new RegExp(
      String.raw`^(?:\d?[A-Z]{1,3}_)?(?:RMB|PTBB|LPTB|FFB|TFB|STB|SBT|LBK|PB|LB|SB|CB|DB|TB|HB|MB|RB|AB|BB|BS|B)-?\d+(?:\.\d+)?[A-Za-z]?${SIZE}$`,
      "i",
    ),
    // Compound / cross-referenced: B32a/RMB2, B39/LB1, LB1/B24/RMB1, LBK1+LBK12
    /^[A-Za-z]{1,4}\d+(?:\.\d+)?[A-Za-z]?(?:[/+][A-Za-z]{1,4}\d+[A-Za-z]?)+$/,
    /^RR$/,
    /^HB\d*$/, // hidden beams may be labelled bare "HB" (no digits)
    /^P-?\d+[A-Za-z]?$/, // perimeter beam (also matches pier under COLUMN)
  ],
  SLAB: [new RegExp(String.raw`^(?:FS|RS|SQ|SM|STB|S)-?\d+[A-Za-z]?${SIZE}$`)],
  COLUMN: [
    new RegExp(
      String.raw`^(?:BSW|SW|LW|RW|PC|AC|GC|BC|NC|SC|CP|TW|W|C)-?\d+(?:-\d+)?[A-Za-z]?${SIZE}$`,
    ),
    /^T[ABC]-C\d+[A-Za-z]?$/,
    /^\(SW\d+[A-Za-z]?(?:\+SW\d+[A-Za-z]?)+\)$/,
    /^P-?\d+[A-Za-z]?$/, // pier / pillar
    /^r\d+$/, // stub columns, lowercase
  ],
  FOOTING: [
    new RegExp(String.raw`^(?:ARF|CWF|BF|CF|AF|NF|FC|FP|PC|CP|F|R)-?\d+[A-Za-z]?${SIZE}$`),
    /^Raft-?\d*$/i,
    /^RW$/,
  ],
};

/** Order in which elements claim a label during re-bucketing. */
const REBUCKET_ORDER: StructuralElement[] = ["SLAB", "BEAM", "COLUMN", "FOOTING"];

export function matchesElement(label: string, element: StructuralElement): boolean {
  return PATTERNS[element].some((re) => re.test(label));
}

// ── Label normalisation ───────────────────────────────────────────────────────
/**
 * Fix known vision-model misread patterns.
 * Returns the corrected label, or null when the label is a recognised
 * artefact that should be dropped entirely.
 */
export function normalizeLabel(label: string): string | null {
  let out = label.trim();

  // Trailing "q" after digits is a misread "g" (CAD suffixes don't use q).
  if (NORMALIZE_TRAILING_Q) {
    out = out.replace(/(\d)q\b/g, "$1g");
  }

  // "B750"/"B750a": a dimension (multiple of 25, >= 300) merged into a beam
  // label. These are artefacts, not real beams — drop them.
  if (DROP_DIMENSION_MERGES) {
    const m = out.match(/^B(\d{3,4})[a-z]?$/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n >= 300 && n % 25 === 0) return null;
    }
  }

  return out;
}

/**
 * Decide which element a label belongs to.
 * Keeps the model's element when the label is plausible for it (handles
 * genuinely ambiguous prefixes like P1, PC1, CP1); otherwise re-buckets to
 * the first element whose pattern matches; returns null for junk.
 */
export function resolveElement(
  label: string,
  modelElement: StructuralElement,
): StructuralElement | null {
  if (matchesElement(label, modelElement)) return modelElement;
  for (const el of REBUCKET_ORDER) {
    if (matchesElement(label, el)) return el;
  }
  return null;
}

// ── Cross-tile dedupe merge ───────────────────────────────────────────────────

/** One tile's extraction together with its geometry. */
export interface TileResult {
  tile: Pick<PageTile, "left" | "top" | "width" | "height">;
  extraction: TileExtraction;
}

interface PlacedOccurrence {
  px: number;
  py: number;
  tileIdx: number;
}

/**
 * Merge per-tile extractions into one page-level ElementResult.
 *
 * All occurrences are converted to page coordinates. For each label, an
 * occurrence is dropped when an already-accepted occurrence of the SAME label
 * from a DIFFERENT tile lies within DEDUPE_RADIUS_PX — that is the same
 * physical label seen through the tile overlap. Occurrences without position
 * info are added as raw counts (no dedupe possible).
 */
export function mergeTileExtractions(
  tileResults: TileResult[],
  _pageWidth: number,
  _pageHeight: number,
): ElementResult {
  // element -> label -> collected occurrences
  const placed: Record<StructuralElement, Record<string, PlacedOccurrence[]>> = {
    BEAM: {},
    SLAB: {},
    COLUMN: {},
    FOOTING: {},
  };
  const blind: Record<StructuralElement, Record<string, number>> = {
    BEAM: {},
    SLAB: {},
    COLUMN: {},
    FOOTING: {},
  };

  tileResults.forEach(({ tile, extraction }, tileIdx) => {
    for (const modelElement of STRUCTURAL_ELEMENTS) {
      for (const occ of extraction[modelElement] ?? []) {
        const label = normalizeLabel(occ.label);
        if (!label) continue; // dimension-merge artefact
        const element = resolveElement(label, modelElement);
        if (!element) continue; // junk label

        if (occ.positions.length > 0) {
          const list = (placed[element][label] ??= []);
          for (const p of occ.positions) {
            list.push({
              px: tile.left + (p.x / 1000) * tile.width,
              py: tile.top + (p.y / 1000) * tile.height,
              tileIdx,
            });
          }
        } else {
          blind[element][label] = (blind[element][label] ?? 0) + occ.count;
        }
      }
    }
  });

  const result = {} as ElementResult;
  for (const element of STRUCTURAL_ELEMENTS) {
    const counts: Record<string, number> = {};

    for (const [label, occs] of Object.entries(placed[element])) {
      const accepted: PlacedOccurrence[] = [];
      for (const o of occs) {
        const isDuplicate = accepted.some(
          (a) =>
            a.tileIdx !== o.tileIdx &&
            Math.hypot(a.px - o.px, a.py - o.py) < DEDUPE_RADIUS_PX,
        );
        if (!isDuplicate) accepted.push(o);
      }
      counts[label] = accepted.length;
    }
    for (const [label, n] of Object.entries(blind[element])) {
      counts[label] = (counts[label] ?? 0) + n;
    }

    const labels: LabelEntry[] = Object.keys(counts)
      .sort()
      .map((label) => ({ label, count: counts[label] }));
    result[element] = { total_distinct: labels.length, labels };
  }
  return result;
}
