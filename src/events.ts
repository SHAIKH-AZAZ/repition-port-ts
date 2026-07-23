/**
 * src/events.ts
 * The live-update contract shared by the pipeline, the CLI, and the web
 * backend/frontend. `runAnalysis` (see analysis.ts) emits a stream of these;
 * the CLI prints them and the Feathers server forwards them over Socket.io.
 *
 * Keep this file dependency-light (types only) so the frontend can mirror it.
 */

import type { CropRegion } from "./cropper.js";
import type { ElementResult, Summary, TileExtraction } from "./types.js";

// Re-export the DTOs the events reference so a single import covers the contract.
export type { CropRegion } from "./cropper.js";
export type {
  ElementResult,
  ElementEntry,
  LabelEntry,
  OccurrenceEntry,
  Position,
  Summary,
  TileExtraction,
} from "./types.js";

export type AnalysisMode = "agentic" | "grid";

/**
 * One live update from the analysis pipeline. Discriminated by `type`.
 * Order over a run: job → (page-start → [regions] → (crop → extraction)* →
 * page-result|page-error)* → summary → done.
 */
export type AnalysisEvent =
  | { type: "status"; message: string }
  | {
      type: "job";
      jobId: string;
      file: string;
      totalPages: number;
      pages: number[];
      mode: AnalysisMode;
    }
  | { type: "page-start"; page: number; tiles: number; blankSkipped: number }
  | { type: "regions"; page: number; regions: CropRegion[] }
  | { type: "crop"; page: number; name: string; url: string }
  | { type: "extraction"; page: number; name: string; extraction: TileExtraction }
  | { type: "page-result"; page: number; elements: ElementResult }
  | { type: "page-error"; page: number; message: string }
  | { type: "summary"; summary: Summary }
  | { type: "done"; resultUrl: string; errors: number }
  | { type: "error"; message: string };

/** Envelope the Feathers `jobs` service publishes so clients can filter by job. */
export interface ProgressEnvelope {
  jobId: string;
  event: AnalysisEvent;
  ts: number;
}
