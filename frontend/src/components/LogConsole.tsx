import { useEffect, useRef, useState } from "react";
import type { AnalysisEvent, TileExtraction } from "../types";
import { CropLogItem } from "./CropLogItem";

type Filter = "all" | "crops" | "status";

/** Live event stream: status lines + compact crop cards (with lightbox). */
export function LogConsole({
  events,
  allCrops,
  onZoom,
}: {
  events: AnalysisEvent[];
  allCrops: Extract<AnalysisEvent, { type: "crop" }>[];
  onZoom: (index: number) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ block: "end" });
  }, [events.length, autoScroll, filter]);

  // Pair each crop with the extraction that follows it (by page/name).
  const extractionByKey = new Map<string, TileExtraction>();
  for (const e of events) {
    if (e.type === "extraction") extractionByKey.set(`${e.page}/${e.name}`, e.extraction);
  }

  const cropCount = events.filter((e) => e.type === "crop").length;

  function visible(e: AnalysisEvent): boolean {
    if (filter === "all") return e.type !== "extraction" && e.type !== "summary";
    if (filter === "crops") return e.type === "crop";
    return ["status", "job", "page-start", "regions", "page-result", "page-error", "done", "error"].includes(e.type);
  }

  return (
    <div className="log-shell">
      <div className="log-bar">
        {(["all", "crops", "status"] as Filter[]).map((f) => (
          <button
            key={f}
            className={"tab" + (filter === f ? " active" : "")}
            onClick={() => setFilter(f)}
          >
            {f === "crops" ? `crops (${cropCount})` : f}
          </button>
        ))}
        <span className="spacer" />
        <label className="muted small">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />{" "}
          autoscroll
        </label>
      </div>

      <div className="log" ref={wrapRef}>
        {events.length === 0 && (
          <p className="muted">Waiting for events — upload a PDF and press Start.</p>
        )}
        {events.map((e, i) => {
          if (!visible(e)) return null;
          switch (e.type) {
            case "job":
              return (
                <div key={i} className="line line-job">
                  <span className="line-icon">▶</span>
                  <span className="line-content">
                    <span className="line-file">{e.file}</span> — {e.totalPages} page(s), <b>{e.mode}</b> mode
                  </span>
                </div>
              );
            case "status":
              return (
                <div key={i} className="line line-status">
                  <span className="line-icon">·</span>
                  <span className="line-content">{e.message}</span>
                </div>
              );
            case "page-start":
              return (
                <div key={i} className="line line-page">
                  <span className="line-icon">—</span>
                  <span className="line-content">
                    Page {e.page}: {e.tiles} tile(s)
                    {e.blankSkipped ? <span className="line-dim"> ({e.blankSkipped} blank skipped)</span> : ""}
                  </span>
                </div>
              );
            case "regions":
              return (
                <div key={i} className="line line-crop">
                  <span className="line-icon">✂</span>
                  <span className="line-content">
                    Page {e.page}: cropper chose {e.regions.length} region(s) —{" "}
                    <span className="line-dim">{e.regions.map((r) => r.label).join(", ")}</span>
                  </span>
                </div>
              );
            case "crop":
              return (
                <CropLogItem
                  key={i}
                  crop={e}
                  extraction={extractionByKey.get(`${e.page}/${e.name}`)}
                  onZoom={() => {
                    const idx = allCrops.findIndex((c) => c.page === e.page && c.name === e.name);
                    if (idx !== -1) onZoom(idx);
                  }}
                />
              );
            case "page-result":
              return (
                <div key={i} className="line line-success">
                  <span className="line-icon">✓</span>
                  <span className="line-content">Page {e.page} complete</span>
                </div>
              );
            case "page-error":
              return (
                <div key={i} className="line line-error">
                  <span className="line-icon">✗</span>
                  <span className="line-content">Page {e.page}: {e.message}</span>
                </div>
              );
            case "done":
              return (
                <div key={i} className="line line-done">
                  <span className="line-icon">■</span>
                  <span className="line-content">
                    Finished{e.errors ? <span className="line-dim"> ({e.errors} page error(s))</span> : ""}.
                  </span>
                </div>
              );
            case "error":
              return (
                <div key={i} className="line line-error">
                  <span className="line-icon">⚠</span>
                  <span className="line-content">Error: {e.message}</span>
                </div>
              );
            default:
              return null;
          }
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
