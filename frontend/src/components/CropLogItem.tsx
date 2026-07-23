import { useState } from "react";
import type { AnalysisEvent, StructuralElement, TileExtraction } from "../types";

const ELEMENTS: StructuralElement[] = ["BEAM", "SLAB", "COLUMN", "FOOTING"];

/** One crop image with the JSON that was read from it (the "cropped → logged" pair). */
export function CropLogItem({
  crop,
  extraction,
}: {
  crop: Extract<AnalysisEvent, { type: "crop" }>;
  extraction?: TileExtraction;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="crop-item">
      <div className="crop-head">
        <span>🖼 Page {crop.page} · {crop.name}</span>
        <button onClick={() => setOpen((o) => !o)}>{open ? "hide json" : "show json"}</button>
      </div>
      <img src={crop.url} alt={crop.name} loading="lazy" />
      {open && (
        <pre className="json">{extraction ? summarize(extraction) : "…extracting"}</pre>
      )}
    </div>
  );
}

function summarize(ex: TileExtraction): string {
  const parts: string[] = [];
  for (const el of ELEMENTS) {
    const items = ex[el];
    if (items && items.length) {
      parts.push(`${el}: ` + items.map((i) => `${i.label}×${i.count}`).join(", "));
    }
  }
  return parts.length ? parts.join("\n") : "(nothing found)";
}
