import { useEffect, useMemo, useRef, useState } from "react";
import { jobsService, uploadPdf, startJob, cancelJob } from "./api/feathers";
import type { AnalysisEvent, ProgressEnvelope, Summary } from "./types";
import { Uploader } from "./components/Uploader";
import { PdfPreview } from "./components/PdfPreview";
import { LogConsole } from "./components/LogConsole";
import { ResultsTable } from "./components/ResultsTable";

type Phase = "idle" | "uploaded" | "running" | "done" | "error" | "cancelled";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [zoom, setZoom] = useState<{ url: string; title: string } | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Subscribe once to the jobs 'progress' stream; filter to the active job.
  useEffect(() => {
    const handler = (p: ProgressEnvelope) => {
      if (p.jobId !== jobIdRef.current) return;
      setEvents((prev) => [...prev, p.event]);
      if (p.event.type === "summary") setSummary(p.event.summary);
      if (p.event.type === "done") setPhase("done");
      if (p.event.type === "error") setPhase("error");
    };
    jobsService.on("progress", handler);
    return () => jobsService.removeListener?.("progress", handler);
  }, []);

  // Close the lightbox with Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const progress = useMemo(() => {
    let pages: number[] = [];
    let tilesTotal = 0;
    let tilesDone = 0;
    let pagesDone = 0;
    for (const e of events) {
      if (e.type === "job") pages = e.pages;
      if (e.type === "page-start") tilesTotal += e.tiles;
      if (e.type === "extraction") tilesDone += 1;
      if (e.type === "page-result" || e.type === "page-error") pagesDone += 1;
    }
    const pct = tilesTotal ? Math.min(100, Math.round((tilesDone / tilesTotal) * 100)) : 0;
    return { pages: pages.length, pagesDone, tilesTotal, tilesDone, pct };
  }, [events]);

  async function handleUpload(f: File) {
    setFile(f);
    setEvents([]);
    setSummary(null);
    setPhase("idle");
    const job = await uploadPdf(f);
    setJobId(job.id);
    jobIdRef.current = job.id;
    setPhase("uploaded");
  }

  async function handleStart() {
    if (!jobId) return;
    setEvents([]);
    setSummary(null);
    setPhase("running");
    await startJob(jobId);
  }

  async function handleCancel() {
    if (!jobId) return;
    await cancelJob(jobId);
    setPhase("cancelled");
  }

  const phaseLabel: Record<Phase, string> = {
    idle: "no job",
    uploaded: "ready",
    running: "running",
    done: "finished",
    error: "failed",
    cancelled: "cancelled",
  };

  return (
    <div className="app">
      <header>
        <h1>RCC Drawing Element Analyzer</h1>
        {jobId && (
          <span className={`status status-${phase}`}>
            {phaseLabel[phase]}
            <code>{jobId.slice(0, 8)}</code>
          </span>
        )}
      </header>

      <section className="top">
        <div className="col">
          <Uploader onUpload={handleUpload} />
          {jobId && (
            <div className="actions">
              <button disabled={phase === "running"} onClick={handleStart}>
                {phase === "running" ? "Running…" : phase === "done" ? "Run again" : "Start extraction"}
              </button>
              {phase === "running" && (
                <button className="ghost" onClick={handleCancel}>Cancel</button>
              )}
            </div>
          )}
          {(phase === "running" || phase === "done") && progress.tilesTotal > 0 && (
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <span className="muted small">
                {progress.pct}% — {progress.tilesDone}/{progress.tilesTotal} crops ·{" "}
                {progress.pagesDone}/{progress.pages || "?"} page(s)
              </span>
            </div>
          )}
        </div>
        <div className="col">
          {file ? <PdfPreview file={file} /> : (
            <div className="placeholder"><p className="muted">PDF preview appears after upload.</p></div>
          )}
        </div>
      </section>

      <section className="bottom">
        <div className="col">
          <h2>Live log</h2>
          <LogConsole events={events} onZoom={(url, title) => setZoom({ url, title })} />
        </div>
        <div className="col">
          <h2>Results</h2>
          <ResultsTable summary={summary} />
        </div>
      </section>

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-bar">
              <span className="mono">{zoom.title}</span>
              <button className="ghost sm" onClick={() => setZoom(null)}>close ✕</button>
            </div>
            <img src={zoom.url} alt={zoom.title} />
          </div>
        </div>
      )}
    </div>
  );
}
