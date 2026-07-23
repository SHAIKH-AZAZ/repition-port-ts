/**
 * The single seam between the backend and the analysis pipeline (repo /src).
 * Everything the server needs from the pipeline is re-exported here, so if the
 * pipeline moves we only fix this one file.
 */

export { runAnalysis } from "../../src/analysis.js";
export type { RunOptions, Emit } from "../../src/analysis.js";
export type { AnalysisEvent, ProgressEnvelope, Summary } from "../../src/events.js";
