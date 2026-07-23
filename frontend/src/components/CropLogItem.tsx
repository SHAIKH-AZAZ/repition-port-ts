import { useState } from "react";
import type { AnalysisEvent, StructuralElement, TileExtraction } from "../types";

const ELEMENTS: StructuralElement[] = ["BEAM", "SLAB", "COLUMN", "FOOTING"];

/**
 * Compact card: small thumbnail + label chips for what was read from the crop.
 * Click the thumbnail to open the full-size image in a lightbox.
 */
export function CropLogItem({
  crop,
  extraction,
  onZoom,
}: {
  crop: Extract<AnalysisEvent, { type: "crop" }>;
  extraction?: TileExtraction;
  onZoom: (url: string, title: string) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const chips = extraction ? toChips(extraction) : null;
  const title = `page ${crop.page} · ${crop.name}`;

  return (
    <div className="crop-item">
      <button className="thumb" onClick={() => onZoom(crop.url, title)} title="Click to enlarge">
        <img src={crop.url} alt={crop.name} loading="lazy" />
      </button>
      <div className="crop-body">
        <div className="crop-title">
          <span className="mono">{crop.name}</span>
          <span className="pill">p{crop.page}</span>
        </div>
        <div className="crop-chips">
          {chips === null && <span className="pill wait">extracting…</span>}
          {chips !== null && chips.length === 0 && <span className="pill empty">no labels</span>}
          {chips?.map((c, i) => (
            <span key={i} className={`pill el-${c.el.toLowerCase()}`}>
              {c.label} x{c.count}
            </span>
          ))}
        </div>
        {extraction && (
          <button className="linkish" onClick={() => setShowJson((s) => !s)}>
            {showJson ? "hide raw json" : "raw json"}
          </button>
        )}
        {showJson && extraction && (
          <pre className="json">{JSON.stringify(compact(extraction), null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function toChips(ex: TileExtraction): { el: StructuralElement; label: string; count: number }[] {
  const out: { el: StructuralElement; label: string; count: number }[] = [];
  for (const el of ELEMENTS) {
    for (const item of ex[el] ?? []) out.push({ el, label: item.label, count: item.count });
  }
  return out;
}

/** Raw JSON without positions noise (kept in artifacts on disk). */
function compact(ex: TileExtraction) {
  const out: Record<string, { label: string; count: number }[]> = {};
  for (const el of ELEMENTS) {
    if (ex[el]?.length) out[el] = ex[el].map(({ label, count }) => ({ label, count }));
  }
  return out;
}
