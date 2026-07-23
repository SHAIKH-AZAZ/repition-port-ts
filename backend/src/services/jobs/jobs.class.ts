/**
 * jobs service — in-memory job registry that drives the pipeline and streams
 * progress. Standard methods (find/get/create/patch) + a custom "progress"
 * event published to Socket.io clients (see channels.ts).
 *
 *   POST   /upload            -> multer route -> jobs.create({file,pdfPath})
 *   jobs.patch(id,{action})   -> "start" | "cancel"
 *   jobs.get(id)              -> status + resultUrl
 *   jobs 'progress' event     -> { jobId, event: AnalysisEvent, ts }
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { runAnalysis } from "../../pipeline.js";
import type { AnalysisEvent } from "../../pipeline.js";
import { OUTPUTS_DIR } from "../../config.js";

type JobStatus = "uploaded" | "running" | "done" | "error" | "cancelled";

interface JobRecord {
  id: string;
  file: string;
  pdfPath: string;
  status: JobStatus;
  totalPages?: number;
  resultUrl?: string;
  error?: string;
  events: AnalysisEvent[]; // buffered for replay/debugging
  controller: AbortController;
}

/** What clients are allowed to see (no internal buffers / controllers). */
export interface JobView {
  id: string;
  file: string;
  status: JobStatus;
  totalPages?: number;
  resultUrl?: string;
  error?: string;
}

function view(j: JobRecord): JobView {
  return {
    id: j.id,
    file: j.file,
    status: j.status,
    totalPages: j.totalPages,
    resultUrl: j.resultUrl,
    error: j.error,
  };
}

export class JobsService {
  private jobs = new Map<string, JobRecord>();

  // `app` is the Feathers application; typed loosely to avoid coupling.
  constructor(private app: any) {}

  async find(): Promise<JobView[]> {
    return [...this.jobs.values()].map(view);
  }

  async get(id: string): Promise<JobView> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    return view(job);
  }

  /** Register an uploaded PDF (called by the /upload route). */
  async create(data: { id?: string; file: string; pdfPath: string }): Promise<JobView> {
    const id = data.id ?? randomUUID();
    const job: JobRecord = {
      id,
      file: data.file,
      pdfPath: data.pdfPath,
      status: "uploaded",
      events: [],
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    return view(job);
  }

  /** Actions: { action: "start", pages? } | { action: "cancel" }. */
  async patch(
    id: string,
    data: { action: "start" | "cancel"; pages?: number[] },
  ): Promise<JobView> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);

    if (data.action === "cancel") {
      job.controller.abort();
      job.status = "cancelled";
      return view(job);
    }
    if (data.action === "start" && job.status === "uploaded") {
      this.startJob(job, data.pages ?? null); // fire-and-forget; progress via events
    }
    return view(job);
  }

  // ── Runner ──────────────────────────────────────────────────────────────────
  private startJob(job: JobRecord, pages: number[] | null): void {
    job.status = "running";
    const outDir = path.join(OUTPUTS_DIR, job.id);
    mkdirSync(outDir, { recursive: true });

    const emit = (event: AnalysisEvent) => {
      job.events.push(event);
      if (event.type === "job") job.totalPages = event.totalPages;
      if (event.type === "done") {
        job.status = "done";
        job.resultUrl = `/crops/${job.id}/summary.json`;
      }
      this.broadcast(job.id, event);
    };

    runAnalysis(
      job.pdfPath,
      {
        jobId: job.id,
        pageFilter: pages,
        outputPath: path.join(outDir, "summary.json"),
        artifactsDir: path.join(outDir, "crops"),
        cropUrlBase: `/crops/${job.id}/crops`, // OUTPUTS_DIR served at /crops
        resultUrl: `/crops/${job.id}/summary.json`,
        signal: job.controller.signal,
      },
      emit,
    ).catch((err: unknown) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      this.broadcast(job.id, { type: "error", message: job.error });
    });
  }

  /**
   * Emit the custom `progress` event so channels.ts pushes it to clients.
   * NOTE: must NOT be named `publish` — Feathers skips installing its own
   * channel-publishing mixin on services that already define `publish`,
   * which silently kills ALL realtime event dispatch for the service.
   */
  private broadcast(jobId: string, event: AnalysisEvent): void {
    this.app.service("jobs").emit("progress", { jobId, event, ts: Date.now() });
  }
}
