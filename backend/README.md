# RCC Analyzer — Backend (FeathersJS)

FeathersJS (v5, Express transport) API that wraps the analysis pipeline in
`../src` and streams progress to the frontend over Socket.io.

## Install & run

```bash
cd backend
cp .env.example .env      # optional: set PORT (default 4000)
npm install
npm run dev               # tsx watch, http://localhost:4000
npm run typecheck         # tsc --noEmit  (validates against Feathers types)
```

Model / OpenRouter keys are **not** set here — the pipeline reads them from the
repo-root `../.env` (the same file the CLI uses). Make sure that file has
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_CROP_MODEL`, `OPENAI_EXTRACT_MODEL`.

`sharp` needs its platform binary; run `npm install` on the machine that runs
the server.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/upload` | multipart (`file`) → saves PDF, returns `{ id, file, status }` |
| `GET`  | `/jobs` / `/jobs/:id` | list / get job status |
| `PATCH`| `/jobs/:id` | body `{ action:"start", pages?:number[] }` or `{ action:"cancel" }` |
| `GET`  | `/crops/:id/summary.json` | final aggregated result |
| `GET`  | `/crops/:id/crops/page_N/...` | crop images + per-crop JSON |
| `GET`  | `/pdf/:id/source.pdf` | original uploaded PDF |

Realtime: connect Socket.io, then listen to the `jobs` service `progress`
event. Each payload is `{ jobId, event, ts }` where `event` is an
`AnalysisEvent` (see `../src/events.ts`): `job → page-start → regions →
(crop → extraction)* → page-result → summary → done`.

## Typical flow

1. `POST /upload` → `{ id }`.
2. Open Socket.io, subscribe to `jobs` `progress` (filter by `jobId`).
3. `PATCH /jobs/:id { action:"start", pages:[1] }`.
4. Render events live; on `done`, `GET /crops/:id/summary.json`.

## Structure

```
src/
  index.ts            start server
  app.ts              feathers + express + socketio wiring
  config.ts           paths + PORT
  pipeline.ts         single seam re-exporting runAnalysis from ../src
  channels.ts         publish 'progress' to connected clients
  middleware/upload.ts  POST /upload (multer)
  services/jobs/jobs.class.ts  in-memory job registry + runner
```
