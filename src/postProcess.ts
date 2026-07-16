/**
 * src/postProcess.ts
 * Deterministic cleanup of per-tile vision results:
 *
 * 1. OWNERSHIP FILTER — tiles overlap by TILE_OVERLAP px, so a label lying in
 *    the shared band is reported by two tiles. Each tile "owns" only its
 *    interior (inset by TILE_OVERLAP/2 on sides that have a neighbour);
 *    occurrences whose reported position falls outside the owned region are
 *    dropped — the neighbouring tile owns and counts them.
 *
 * 2. RE-BUCKETING — labels are re-assigned to the element type their prefix
 *    dictates (an "S13" reported under COLUMN is moved to SLAB). When a label
 *    is valid for the element the model chose (e.g. "P1" is both a perimeter
 *    beam and a pier), the model's choice is kept.
 *
 * 3. JUNK DROP — strings that match no element pattern ("BEAM", "RCC SLAB",
 *    "UP", bare grid letters, bare numbers) are discarded.
 */

import {
  STRUCTURAL_ELEMENTS,
  TILE_OVERLAP,
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
    // Compound / cross-referenced: B32a/RMB2, B39/LB1, LBK1+LBK12
    /^[A-Za-z]{1,4}\d+(?:\.\d+)?[A-Za-z]?(?:[/+][A-Za-z]{1,4}\d+[A-Za-z]?)+$/,
    /^RR$/,
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

// ── Ownership filter ──────────────────────────────────────────────────────────
interface OwnedRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Region of the page (in full-res pixels) that this tile exclusively owns:
 * the tile inset by half the overlap on every side that has a neighbour.
 */
export function ownedRegion(
  tile: Pick<PageTile, "left" | "top" | "width" | "height">,
  pageWidth: number,
  pageHeight: number,
  overlap: number = TILE_OVERLAP,
): OwnedRegion {
  const half = overlap / 2;
  return {
    left: tile.left === 0 ? 0 : tile.left + half,
    top: tile.top === 0 ? 0 : tile.top + half,
    right: tile.left + tile.width >= pageWidth ? pageWidth : tile.left + tile.width - half,
    bottom: tile.top + tile.height >= pageHeight ? pageHeight : tile.top + tile.height - half,
  };
}

/** One tile's extraction together with its geometry. */
export interface TileResult {
  tile: Pick<PageTile, "left" | "top" | "width" | "height">;
  extraction: TileExtraction;
}

/**
 * Merge per-tile extractions into one page-level ElementResult:
 * ownership-filter positions, re-bucket labels, drop junk, sum counts.
 */
export function mergeTileExtractions(
  tileResults: TileResult[],
  pageWidth: number,
  pageHeight: number,
): ElementResult {
  const counts: Record<StructuralElement, Record<string, number>> = {
    BEAM: {},
    SLAB: {},
    COLUMN: {},
    FOOTING: {},
  };

  for (const { tile, extraction } of tileResults) {
    const owned = ownedRegion(tile, pageWidth, pageHeight);

    for (const modelElement of STRUCTURAL_ELEMENTS) {
      for (const occ of extraction[modelElement] ?? []) {
        const label = normalizeLabel(occ.label);
        if (!label) continue; // dimension-merge artefact
        const element = resolveElement(label, modelElement);
        if (!element) continue; // junk label

        let kept: number;
        if (occ.positions.length > 0) {
          kept = occ.positions.filter((p) => {
            const px = tile.left + (p.x / 1000) * tile.width;
            const py = tile.top + (p.y / 1000) * tile.height;
            return px >= owned.left && px < owned.right && py >= owned.top && py < owned.bottom;
          }).length;
        } else {
          // No position info — keep the raw count (may double-count overlap).
          kept = occ.count;
        }
        if (kept > 0) {
          counts[element][label] = (counts[element][label] ?? 0) + kept;
        }
      }
    }
  }

  const result = {} as ElementResult;
  for (const element of STRUCTURAL_ELEMENTS) {
    const labels: LabelEntry[] = Object.keys(counts[element])
      .sort()
      .map((label) => ({ label, count: counts[element][label] }));
    result[element] = { total_distinct: labels.length, labels };
  }
  return result;
}
