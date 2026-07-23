import { useEffect, useRef } from "react";
import type { AnalysisEvent, TileExtraction } from "../types";
import { CropLogItem } from "./CropLogItem";

/** Renders the live event stream: status → crop image + JSON → page results. */
export function LogConsole({ events }: { events: AnalysisEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  // Pair each crop with the extraction that follows it (by page/name).
  const extractionByKey = new Map<string, TileExtraction>();
  for (const e of events) {
    if (e.type === "extraction") extractionByKey.set(`${e.page}/${e.name}`, e.extraction);
  }

  return (
    <div className="log">
      {events.map((e, i) => {
        switch (e.type) {
          case "job":
            return <div key={i} className="line info">▶ {e.file} — {e.totalPages} page(s), {e.mode} mode</div>;
          case "status":
            return <div key={i} className="line">· {e.message}</div>;
          case "page-start":
            return (
              <div key={i} className="line">
                — Page {e.page}: {e.tiles} tile(s){e.blankSkipped ? ` (${e.blankSkipped} blank skipped)` : ""}
              </div>
            );
          case "regions":
            return <div key={i} className="line">✂ Page {e.page}: cropper chose {e.regions.length} region(s)</div>;
          case "crop":
            return <CropLogItem key={i} crop={e} extraction={extractionByKey.get(`${e.page}/${e.name}`)} />;
          case "page-result":
            return <div key={i} className="line ok">✓ Page {e.page} complete</div>;
          case "page-error":
            return <div key={i} className="line err">✗ Page {e.page}: {e.message}</div>;
          case "done":
            return <div key={i} className="line ok">Finished{e.errors ? ` (${e.errors} page error(s))` : ""}.</div>;
          case "error":
            return <div key={i} className="line err">Error: {e.message}</div>;
          default:
            return null; // 'extraction' is rendered inside its crop; 'summary' feeds the table
        }
      })}
      <div ref={endRef} />
    </div>
  );
}
