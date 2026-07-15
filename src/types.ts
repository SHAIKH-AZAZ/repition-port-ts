/**
 * src/types.ts
 * Shared data shapes for the analyzer.
 */

import type { StructuralElement } from "./config.js";

export interface LabelEntry {
  label: string;
  count: number;
}

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
export type Summary = Record<StructuralElement, Record<string, number>>;

export interface PageError {
  page: number;
  error: string;
}
