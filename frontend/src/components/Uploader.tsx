import { useRef, useState } from "react";

export function Uploader({ onUpload }: { onUpload: (f: File) => Promise<void> | void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handle(f: File) {
    if (!f) return;
    setBusy(true);
    setName(f.name);
    try {
      await onUpload(f);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={"uploader" + (dragging ? " drag" : "")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handle(f);
      }}
    >
      <div className="uploader-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <polyline points="9 15 12 12 15 15" />
        </svg>
      </div>
      <p className="uploader-label">Drop a PDF here, or</p>
      <button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "Uploading…" : "Choose PDF"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      {name && <p className="fname">{name}</p>}
    </div>
  );
}
