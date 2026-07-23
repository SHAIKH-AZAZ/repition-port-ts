# Web UI — Implementation Plan

**Goal:** Turn the CLI analyzer into an interactive local app: upload PDF(s),
preview them with zoom, watch extraction happen live (status logs → cropped
images → the JSON read from each crop), and see a final results table.

**Chosen stack (from discussion):**
- **Frontend:** React + Vite (TypeScript), separate app.
- **Backend:** **FeathersJS v5 ("Dove", TypeScript)** on the **Express** transport,
  separate app, wraps the existing pipeline.
- **Runs:** locally (single user, localhost). No auth / queue / cloud storage.
- **Connection:** Feathers **services** (REST) for actions + Feathers **real-time
  events over Socket.io** for the live log stream; a shared types package keeps
  the contract type-safe on both ends.

> Why Feathers fits: services emit events automatically and push them to
> connected clients over Socket.io, with **channels** deciding who receives what.
> That is exactly the "stream crop → JSON → result as it happens" behaviour we
> need — no custom SSE plumbing, and the browser gets a typed client for free.

---

## 1. How this maps to what already exists

The pipeline already does the hard parts and, crucially, **already writes each
crop image next to the JSON extracted from it** (`output/<pdf>_crops/page_N/…`).
The UI mostly needs to (a) drive the pipeline from a service call and (b) **push
the events it already produces** as a Feathers real-time event.

| Requested feature | Already have | New work |
|---|---|---|
| Upload PDF | CLI reads `input/` | multipart upload (multer) → `jobs.create` |
| Preview + zoom | 400-DPI page render exists | In-browser pdf.js preview + zoom/pan |
| Live logs | `console.log` throughout | Emit typed events → Feathers `progress` event → Socket.io |
| Show cropped image | crop PNGs saved to disk | Serve them statically, render on `crop` event |
| Log JSON extraction | raw per-crop JSON saved | Send it in the `extraction` event, render it |
| Final table | aggregated `Summary` JSON | Results table component |

Backbone = a **one-time refactor of the pipeline into an event-emitting library**
that both the CLI and the Feathers `jobs` service consume.

---

## 2. Architecture

```
┌─────────────── frontend/ (React + Vite, :5173) ─────────────────┐
│  Uploader → PdfPreview(zoom) → LogConsole → ResultsTable         │
│  @feathersjs/client over socket.io-client                        │
└───────▲───────────────── service calls ─────────────┬───────────┘
        │ jobs.on('progress', …)  (Socket.io)          │ upload (fetch FormData)
        │                                              │ jobs.create / patch(start|cancel)
        ▼                                              ▼
┌─────────────── backend/ FeathersJS v5 (Express, :4000) ──────────┐
│  transports: @feathersjs/express (REST) + @feathersjs/socketio   │
│  service 'jobs' (in-memory) ── custom event 'progress' ──►        │
│  channels.ts → publish 'progress' to channel 'job/<id>'          │
│  express route  POST /upload (multer)   static /crops  /pdf       │
│  pipeline/analysis.ts  ── emits AnalysisEvent ──► jobs.emit(…)    │
│    convertPdf → cropPage → tilesFromRegion → extract → merge      │
└──────────────────────────────────────────────────────────────────┘
        │ reads .env (OpenRouter key stays server-side only)
```

Dev connection: Vite proxies `/api` **and** the Socket.io path (`ws: true`) to
`:4000`. Keys live only in the backend `.env`; the browser never sees them.

> Transport note: Feathers v5's generator defaults to **Koa**, but we pick the
> **Express** transport so existing Express middleware (`multer`, `express.static`)
> drops in unchanged. (Koa is fine too — swap `multer` for `@koa/multer`.)

---

## 3. Repo layout (backend & frontend separate)

```
project/
  shared/                      # the contract, imported by both sides
    src/events.ts              # AnalysisEvent union + DTOs (Summary, CropRegion…)
    package.json               # name: @rcc/shared
  backend/                     # FeathersJS app
    src/
      app.ts                   # feathers + express + socketio wiring
      index.ts                 # listen(4000)
      channels.ts              # who receives 'progress' (per-job channel)
      services/
        jobs/
          jobs.class.ts        # in-memory job service (create/get/patch + 'progress' event)
          jobs.ts              # service registration + options (methods, events)
          jobs.hooks.ts        # start/cancel side-effects, validation
      middleware/
        upload.ts              # express route: POST /upload (multer) -> jobs.create
      pipeline/                # existing modules, refactored
        config.ts pdfProcessor.ts cropper.ts aiExtractor.ts
        postProcess.ts artifacts.ts types.ts
        analysis.ts            # NEW: runAnalysis(pdf, opts, emit) — event core
      cli/main.ts              # existing CLI, now a thin consumer of analysis.ts
    uploads/  output/          # per-job files + artifacts (gitignored)
    .env                       # OPENAI_* / OpenRouter keys
  frontend/
    src/
      api/feathers.ts          # feathers()+socketio(io()) client (typed by @rcc/shared)
      components/ Uploader.tsx PdfPreview.tsx LogConsole.tsx
                  CropLogItem.tsx ResultsTable.tsx
      App.tsx  main.tsx
    vite.config.ts             # proxy '/api' + '/socket.io' (ws:true) -> :4000
```

Wire the shared types with **npm workspaces** (root `package.json` with
`"workspaces": ["shared","backend","frontend"]`) so both import `@rcc/shared`
without publishing. (Fallback: duplicate `events.ts` in each side.)

---

## 4. The event contract (`shared/src/events.ts`)

One discriminated union is the whole live-update surface. It is delivered as the
payload of the Feathers **custom service event `progress`** (identical shape to
the earlier SSE design — only the transport changed):

```ts
export type AnalysisEvent =
  | { type: "status";      message: string }
  | { type: "job";         jobId: string; file: string; totalPages: number; mode: "agentic" | "grid" }
  | { type: "page-start";  page: number; tiles: number }
  | { type: "regions";     page: number; regions: CropRegion[] }
  | { type: "crop";        page: number; name: string; url: string }              // image ready
  | { type: "extraction";  page: number; name: string; extraction: TileExtraction } // JSON read from it
  | { type: "page-result"; page: number; elements: ElementResult }
  | { type: "summary";     summary: Summary }
  | { type: "error";       page?: number; message: string }
  | { type: "done";        resultUrl: string };

// carried by the Feathers event so clients can filter by job:
export interface ProgressEvent { jobId: string; event: AnalysisEvent }
```

`CropRegion`, `TileExtraction`, `ElementResult`, `Summary` move here from the
current `types.ts` / `cropper.ts` so both apps share them.

---

## 5. Backend (FeathersJS)

### 5.1 Pipeline refactor (`analysis.ts`) — the key change

Extract the body of today's `analyzePdf` into:

```ts
export async function runAnalysis(
  pdfPath: string,
  opts: { pages?: number[]; jobId: string; outDir: string; signal?: AbortSignal },
  emit: (e: AnalysisEvent) => void,
): Promise<Summary>
```

Every `console.log` / `process.stderr.write` becomes `emit(...)`. Artifact
saving stays as-is; right after a crop is saved we `emit({type:"crop", url})`,
then after extraction `emit({type:"extraction", extraction})`. `cli/main.ts`
becomes a thin consumer that prints events — **CLI behaviour is preserved.**
Thread an `AbortSignal` so a job can be cancelled from the UI.

### 5.2 `jobs` service (`services/jobs`)

In-memory `Map<jobId, Job>` (local single-user, no DB). Registered with a custom
event:

```ts
app.use("jobs", new JobsService(app), {
  methods: ["create", "get", "patch"],
  events: ["progress"],          // <- our live stream event
});
```

- `create({ file })` — register an uploaded PDF, return `{ id, totalPages, status }`.
- `get(id)` — status + `resultUrl` when finished.
- `patch(id, { action: "start", pages })` — kick off `runAnalysis`; the `emit`
  callback calls `app.service("jobs").emit("progress", { jobId: id, event })`.
- `patch(id, { action: "cancel" })` — trip the job's `AbortController`.

Using standard `create`/`get`/`patch` (rather than custom methods) keeps REST
mapping obvious and works identically over Socket.io.

### 5.3 Channels (`channels.ts`) — who gets the stream

```ts
app.on("connection", (c) => app.channel("everybody").join(c));   // local single-user
app.service("jobs").publish("progress", (data) =>
  app.channel(`job/${data.jobId}`),                              // scope per job
);
```

Clients join their job's channel (a tiny `join` handled on connection, or — for
a single local user — just publish to `"everybody"` and let the client filter by
`jobId`). Per-job channels are the best-practice version and the path to
multi-user later.

### 5.4 Upload + static files

Feathers-on-Express, so plain Express middleware works:

- `POST /upload` — `multer` saves `uploads/<id>/file.pdf`, then calls
  `app.service("jobs").create({ file })`, returns the job. (Feathers services
  don't parse multipart, so uploads go through this route, not a service.)
- `app.use("/crops", express.static(OUTPUT_DIR))` — serves crop PNG/JSON; the
  `crop` event's `url` points here.
- `app.use("/pdf", express.static(UPLOADS_DIR))` — original PDF for the preview.

### 5.5 Packages

`@feathersjs/feathers`, `@feathersjs/express`, `@feathersjs/socketio`,
`@feathersjs/configuration`, `@feathersjs/errors`, `multer` (+ existing pipeline
deps: `sharp`, `pdf-to-img`, `openai`). Optional: `@feathersjs/schema` +
`@feathersjs/typebox` for request validation. Dev runner: `tsx watch src/index.ts`.

---

## 6. Frontend (React + Vite)

Feathers gives the browser a typed client; no manual EventSource/WebSocket code.

```ts
// api/feathers.ts
import io from "socket.io-client";
import { feathers } from "@feathersjs/feathers";
import socketio from "@feathersjs/socketio-client";
export const app = feathers().configure(socketio(io("/", { path: "/socket.io" })));
export const jobs = app.service("jobs");
```

Component-to-feature map (covers everything you listed):

- **Uploader.tsx** — drag-drop / file-picker (multi-file). Uploads via
  `fetch("/api/upload", { method:"POST", body: FormData })` (multipart), gets a
  `jobId`.
- **PdfPreview.tsx** — renders the PDF in-browser with **pdf.js** (`pdfjs-dist`)
  inside **`react-zoom-pan-pinch`** for zoom/pan + page nav. (Heavy 400-DPI render
  stays server-side.)
- **LogConsole.tsx** — subscribes once: `jobs.on("progress", ({ jobId, event }) =>
  reducer(event))` (filtered to the active `jobId`), then triggers
  `jobs.patch(jobId, { action: "start", pages })`. Renders as events arrive:
  - `status` / `page-start` → a log line.
  - `regions` → "Page N: cropper chose K regions" (optionally overlay boxes on preview).
  - `crop` → render the **cropped image** (thumbnail from `url`, click to zoom).
  - `extraction` → render the **JSON** read from that crop under its image
    (collapsible, pretty-printed, BEAM/SLAB/COLUMN/FOOTING highlighted).
  - `page-result` → per-page mini-summary chip.
  - `done` → fetch `jobs.get(id)` for the final summary.
- **CropLogItem.tsx** — the paired "image + its JSON" card used by the log.
- **ResultsTable.tsx** — on `summary`/`done`, render element → label → count,
  grouped with totals, per-page toggle, and "Download JSON". **TanStack Table**
  for sort/filter (or a simple table for MVP).

State: a `useReducer` folding `AnalysisEvent`s into the view model; `@feathersjs/client`
for calls + the `progress` subscription.

`vite.config.ts` dev proxy (note the websocket line):

```ts
server: { proxy: {
  "/api":       { target: "http://localhost:4000", rewrite: p => p.replace(/^\/api/, "") },
  "/socket.io": { target: "http://localhost:4000", ws: true },
}}
```

---

## 7. End-to-end flow

1. Drop `drawing.pdf` → `POST /api/upload` (multer) → `jobs.create` → `{ jobId, totalPages }`.
2. Preview renders (pdf.js) with zoom; user picks pages (optional).
3. Client subscribes to `jobs` `progress`, then `jobs.patch(id, {action:"start"})`.
4. Backend runs `runAnalysis`; `emit` → `jobs.emit("progress", …)` → channels →
   Socket.io → browser. Each `crop` shows the image; each `extraction` shows its
   JSON right under it — the "cropped then logged" view you asked for.
5. `summary` + `done` → results table renders; JSON downloadable.
6. Optional **Cancel** → `jobs.patch(id, {action:"cancel"})` aborts mid-run.

---

## 8. Phased milestones

**Phase 0 — Pipeline as a library.** Extract `runAnalysis(pdf, opts, emit)`; move
shared types to `shared/`; keep the CLI green via a console consumer. Verify
`npm run check` + a CLI run still work.

**Phase 1 — Feathers backend skeleton.** `app.ts` (express+socketio), in-memory
`jobs` service with the `progress` event, `channels.ts`, `POST /upload` (multer),
static `/crops` and `/pdf`. Test with the Feathers client / a socket console.

**Phase 2 — Frontend skeleton.** Vite React app, Feathers client, Uploader, and a
raw LogConsole that prints `progress` events. Prove the round trip.

**Phase 3 — PDF preview + zoom.** pdf.js + react-zoom-pan-pinch + page nav.

**Phase 4 — Rich live log.** Crop image cards + pretty JSON + region summaries;
autoscroll, collapse, filter by element/page.

**Phase 5 — Results table.** Grouped table, per-page toggle, totals, JSON/CSV download.

**Phase 6 — Polish.** Cancel, multi-file queue, error surfaces, blank-page states,
optional Tailwind styling, and (optional) serving the built SPA from Feathers for
a one-command local launch.

---

## 9. Decisions already made / defaults

- **Feathers real-time (Socket.io), not SSE** — services emit events and channels
  route them to the right client out of the box; the browser gets a typed client.
- **Express transport** (over Feathers' default Koa) — reuse `multer` + `express.static`.
- **Uploads via a multer route, not a service** — Feathers services don't parse
  multipart; the route then calls `jobs.create`.
- **Preview in the browser (pdf.js)** — smooth zoom, no extra server render load.
- **In-memory jobs** — fine for local single-user; swap for SQLite/a Feathers DB
  adapter later if you want run history or multi-user.

## 10. Risks & notes

- **API keys stay server-side.** The frontend never receives `OPENAI_*`. (Also:
  rotate the key shared in chat.)
- **`sharp` native binaries are per-OS** — install on the machine running the backend.
- **Socket.io through Vite** needs `ws: true` in the proxy, or the stream won't connect.
- **Long jobs** — Socket.io keeps the connection alive; still handle disconnect
  (client resubscribes; server keeps an event buffer per job for replay).
- **Large crops** — served static and lazy-loaded as thumbnails; full image on click.
- **Two processes in dev** — run backend (`:4000`) and frontend (`:5173`) together
  (root `npm run dev` with `concurrently`). Phase 6 can serve the SPA from Feathers.

---

## 11. Dependencies to add

- **shared:** none (types only).
- **backend:** `@feathersjs/feathers`, `@feathersjs/express`, `@feathersjs/socketio`,
  `@feathersjs/configuration`, `@feathersjs/errors`, `multer` (+ existing pipeline
  deps); optional `@feathersjs/schema` + `@feathersjs/typebox`; dev: `tsx`, `@types/*`.
- **frontend:** `react`, `react-dom`, `vite`, `@feathersjs/client`, `socket.io-client`,
  `pdfjs-dist`, `react-zoom-pan-pinch`, `@tanstack/react-table` (optional), `@rcc/shared`.
```
