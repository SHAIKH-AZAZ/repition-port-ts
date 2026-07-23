import { useEffect, useRef, useState } from "react";
import { jobsService, uploadPdf, startJob, cancelJob } from "./api/feathers";
import type { AnalysisEvent, ProgressEnvelope, Summary } from "./types";
import { Uploader } from "./components/Uploader";
import { PdfPreview } from "./components/PdfPreview";
import { LogConsole } from "./components/LogConsole";
import { ResultsTable } from "./components/ResultsTable";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<AnalysisEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const jobIdRef = useRef<string | null>(null);

  // Subscribe once to the jobs 'progress' stream; filter to the active job.
  useEffect(() => {
    const handler = (p: ProgressEnvelope) => {
      if (p.jobId !== jobIdRef.current) return;
      setEvents((prev) => [...prev, p.event]);
      if (p.event.type === "summary") setSummary(p.event.summary);
      if (p.event.type === "done" || p.event.type === "error") setRunning(false);
    };
    jobsService.on("progress", handler);
    return () => jobsService.removeListener?.("progress", handler);
  }, []);

  async function handleUpload(f: File) {
    setFile(f);
    setEvents([]);
    setSummary(null);
    const job = await uploadPdf(f);
    setJobId(job.id);
    jobIdRef.current = job.id;
  }

  async function handleStart() {
    if (!jobId) return;
    setEvents([]);
    setSummary(null);
    setRunning(true);
    await startJob(jobId);
  }

  async function handleCancel() {
    if (!jobId) return;
    await cancelJob(jobId);
    setRunning(false);
  }

  return (
    <div className="app">
      <header>
        <h1>RCC Drawing Element Analyzer</h1>
      </header>

      <section className="top">
        <div className="col">
          <Uploader onUpload={handleUpload} />
          {jobId && (
            <div className="actions">
              <button disabled={running} onClick={handleStart}>
                {running ? "Running…" : "Start extraction"}
              </button>
              {running && <button className="ghost" onClick={handleCancel}>Cancel</button>}
              <code>job {jobId.slice(0, 8)}</code>
            </div>
          )}
        </div>
        <div className="col">
          {file ? <PdfPreview file={file} /> : <p className="muted">Preview appears after upload.</p>}
        </div>
      </section>

      <section className="bottom">
        <div className="col">
          <h2>Live log</h2>
          <LogConsole events={events} />
        </div>
        <div className="col">
          <h2>Results</h2>
          <ResultsTable summary={summary} />
        </div>
      </section>
    </div>
  );
}
