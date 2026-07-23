import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
// Vite returns a URL string for the worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Renders the uploaded PDF locally with pdf.js; zoom via re-render at scale. */
export function PdfPreview({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);

  useEffect(() => {
    let cancelled = false;
    file.arrayBuffer()
      .then((buf) => pdfjs.getDocument({ data: buf }).promise)
      .then((d: any) => {
        if (cancelled) return;
        setDoc(d);
        setNumPages(d.numPages);
        setPage(1);
      })
      .catch(() => { /* ignore load errors in skeleton */ });
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc.getPage(page).then((pg: any) => {
      if (cancelled) return;
      const viewport = pg.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pg.render({ canvasContext: ctx, viewport });
    });
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  return (
    <div className="preview">
      <div className="toolbar">
        <button onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(4, +(s + 0.2).toFixed(2)))}>+</button>
        <span className="sep" />
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span>Page {page}/{numPages || "?"}</span>
        <button disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
