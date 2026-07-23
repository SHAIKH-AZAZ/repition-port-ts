/**
 * src/types.ts
 * Shared data shapes for the analyzer.
 */

import type { StructuralElement } from "./config.js";

export interface LabelEntry {
  label: string;
  count: number;
}

/** Approximate centre of one physical occurrence, in 0–1000 tile units. */
export interface Position {
  x: number;
  y: number;
}

/** One label as extracted from a single tile, with occurrence positions. */
export interface OccurrenceEntry {
  label: string;
  count: number;
  positions: Position[];
}

/** Raw per-tile extraction: element -> occurrence entries. */
export type TileExtraction = Record<StructuralElement, OccurrenceEntry[]>;

export interface ElementEntry {
  total_distinct: number;
  labels: LabelEntry[];
}

/** One element type -> its per-page label data. */
export type ElementResult = Record<StructuralElement, ElementEntry>;

export interface PageResult {
  page: number;
  elements: ElementResult;
  error?: string;
}

/** element -> label string -> total occurrences across all pages. */
// okay
export type Summary = Record<StructuralElement, Record<string, number>>;

export interface PageError {
  page: number;
  error: string;
}
