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
      <p>Drop a PDF here, or</p>
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
