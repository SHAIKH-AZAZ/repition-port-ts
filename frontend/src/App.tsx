import { useEffect, useMemo, useRef, useState } from "react";
import { jobsService, uploadPdf, startJob, cancelJob } from "./api/feathers";
import type { AnalysisEvent, ProgressEnvelope, StructuralElement, Summary, TileExtraction } from "./types";
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
  const [zoom, setZoom] = useState<number | null>(null);
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

  const allCrops = useMemo(
    () => events.filter((e): e is Extract<AnalysisEvent, { type: "crop" }> => e.type === "crop"),
    [events],
  );

  const extractionByKey = useMemo(() => {
    const map = new Map<string, TileExtraction>();
    for (const e of events) {
      if (e.type === "extraction") map.set(`${e.page}/${e.name}`, e.extraction);
    }
    return map;
  }, [events]);

  // Close lightbox with Escape; navigate with ArrowLeft / ArrowRight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (zoom === null) return;
      if (e.key === "Escape") { setZoom(null); return; }
      if (e.key === "ArrowLeft") { setZoom((i) => i !== null && i > 0 ? i - 1 : i); }
      if (e.key === "ArrowRight") { setZoom((i) => i !== null && i < allCrops.length - 1 ? i + 1 : i); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, allCrops.length]);

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

  const ELEMENTS: StructuralElement[] = ["BEAM", "SLAB", "COLUMN", "FOOTING"];

  return (
    <div className="app">
      <header>
        <div className="header-text">
          <h1>RCC Drawing Element Analyzer</h1>
          <p className="muted small">Extract structural element counts from engineering drawings</p>
        </div>
        {jobId && (
          <span className={`status status-${phase}`}>
            <span className="status-dot" />
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
          <LogConsole events={events} allCrops={allCrops} onZoom={(idx) => setZoom(idx)} />
        </div>
        <div className="col">
          <h2>Results</h2>
          <ResultsTable summary={summary} />
        </div>
      </section>

      {zoom !== null && allCrops[zoom] && (() => {
        const crop = allCrops[zoom];
        const ex = extractionByKey.get(`${crop.page}/${crop.name}`);
        return (
          <div className="lightbox" onClick={() => setZoom(null)}>
            <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
              <div className="lightbox-bar">
                <span className="mono">
                  page {crop.page} · {crop.name}
                </span>
                <span className="muted small">{zoom + 1} / {allCrops.length}</span>
                <button className="ghost sm" onClick={() => setZoom(null)}>close ✕</button>
              </div>
              <div className="lightbox-body">
                <button
                  className="lightbox-arrow left"
                  disabled={zoom === 0}
                  onClick={() => setZoom(zoom - 1)}
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <img src={crop.url} alt={crop.name} />
                <button
                  className="lightbox-arrow right"
                  disabled={zoom === allCrops.length - 1}
                  onClick={() => setZoom(zoom + 1)}
                  aria-label="Next image"
                >
                  ›
                </button>
              </div>
              {ex && (
                <div className="lightbox-extraction">
                  {ELEMENTS.map((el) => {
                    const items = ex[el];
                    if (!items?.length) return null;
                    return (
                      <div key={el} className="lightbox-extract-group">
                        <span className={`lightbox-extract-dot dot el-${el.toLowerCase()}`} />
                        <span className={`lightbox-extract-label el-${el.toLowerCase()}`}>{el}</span>
                        <div className="lightbox-extract-chips">
                          {items.map((item, i) => (
                            <span key={i} className={`pill el-${el.toLowerCase()}`}>
                              <span className="pill-label">{item.label}</span>
                              <span className="pill-count">x{item.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {ELEMENTS.every((el) => !ex[el]?.length) && (
                    <div className="lightbox-empty">No labels detected</div>
                  )}
                </div>
              )}
              {!ex && (
                <div className="lightbox-extraction">
                  <div className="lightbox-loading">
                    <span className="spinner" />
                    <span>Extracting…</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
