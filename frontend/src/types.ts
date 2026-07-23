/**
 * types.ts — MIRROR of the backend contract in ../../src/events.ts.
 * Keep in sync (or promote to a shared workspace package later).
 */

export type StructuralElement = "BEAM" | "SLAB" | "COLUMN" | "FOOTING";

export interface Position { x: number; y: number }
export interface LabelEntry { label: string; count: number }
export interface OccurrenceEntry { label: string; count: number; positions: Position[] }
export type TileExtraction = Record<StructuralElement, OccurrenceEntry[]>;
export interface ElementEntry { total_distinct: number; labels: LabelEntry[] }
export type ElementResult = Record<StructuralElement, ElementEntry>;
export type Summary = Record<StructuralElement, Record<string, number>>;

export interface CropRegion {
  x1: number; y1: number; x2: number; y2: number;
  label: string; kind: string;
}

export type AnalysisMode = "agentic" | "grid";

export type AnalysisEvent =
  | { type: "status"; message: string }
  | { type: "job"; jobId: string; file: string; totalPages: number; pages: number[]; mode: AnalysisMode }
  | { type: "page-start"; page: number; tiles: number; blankSkipped: number }
  | { type: "regions"; page: number; regions: CropRegion[] }
  | { type: "crop"; page: number; name: string; url: string }
  | { type: "extraction"; page: number; name: string; extraction: TileExtraction }
  | { type: "page-result"; page: number; elements: ElementResult }
  | { type: "page-error"; page: number; message: string }
  | { type: "summary"; summary: Summary }
  | { type: "done"; resultUrl: string; errors: number }
  | { type: "error"; message: string };

export interface ProgressEnvelope { jobId: string; event: AnalysisEvent; ts: number }

export interface JobView {
  id: string;
  file: string;
  status: "uploaded" | "running" | "done" | "error" | "cancelled";
  totalPages?: number;
  resultUrl?: string;
  error?: string;
}
