# RCC Analyzer — Frontend (React + Vite)

Upload a PDF, preview it with zoom, watch extraction stream live (status →
cropped image + its JSON → per-page results), and see the final table.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (proxies to backend :4000)
npm run typecheck
```

Start the **backend first** (`../backend`, port 4000) — Vite proxies `/api`,
`/socket.io`, `/crops`, and `/pdf` to it.

## Structure

```
src/
  api/feathers.ts        Feathers client over Socket.io + uploadPdf()
  types.ts               MIRROR of ../../src/events.ts (keep in sync)
  App.tsx                orchestration + 'progress' subscription
  components/
    Uploader.tsx         drag-drop / picker -> POST /api/upload
    PdfPreview.tsx       pdf.js render + zoom + page nav
    LogConsole.tsx       live event stream
    CropLogItem.tsx      crop image + the JSON read from it
    ResultsTable.tsx     final element -> label -> count table
```

## Flow

1. Upload → job created.
2. Click **Start extraction** → `jobs.patch(id,{action:"start"})`.
3. `progress` events render live; crops show as images with their JSON.
4. On `done`, the results table fills in (Download JSON available).

> Note: `src/types.ts` duplicates the backend contract. To make it truly
> single-source, promote it to a shared workspace package (`@rcc/shared`) later.
