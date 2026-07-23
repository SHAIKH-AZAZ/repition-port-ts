# Multi-Model Extraction — Design Document

**Project:** `rcc-drawing-element-analyzer` (repition-port-ts)
**Goal:** Introduce a two-tier model architecture — a **stronger model for locating/cropping the regions worth reading**, and a **cheaper model for extracting labels from those regions** — to cut cost and improve accuracy without disturbing the existing deterministic pipeline.
**Status:** Design proposal (no code changed yet)

---

## 1. Motivation

Today the analyzer sends **every non-blank tile of every page to a single vision model** (`OPENAI_VISION_MODEL`). Two problems follow from that:

1. **Cost scales with tile count, not information.** A dense A0 sheet can produce 50–150 tiles. Many of those tiles are schedule tables, title blocks, legends, or dimension-only regions that the prompt explicitly tells the model to ignore — yet each one still costs a full extraction call.
2. **One model must do two very different jobs at once.** It has to (a) understand page layout well enough to know *what kind of region a tile belongs to* and (b) read tiny stroke-drawn CAD labels accurately. These need different strengths. A cheaper model is usually fine at (b) on a clean crop, but weak at (a); a stronger model is good at (a) but wasteful to run on every tile.

A multi-model split lets us **spend the expensive model once per page on judgment (which regions matter)** and **spend a cheap model on the bulk work (reading small crops)**.

The sibling project `beam-detect` already validates the pattern in a LangChain/OpenRouter stack via separate `CROPPER_MODEL` and `EXTRACT_MODEL` env vars. This document adapts the idea to the deterministic pipeline in this repo.

---

## 2. Current architecture (baseline)

```
main.ts
  └─ pdfToPageTiles()            [pdfProcessor.ts]  render @400 DPI → tile into 1024px overlapping crops, drop blank tiles
       └─ for each tile:
            extractElementsFromImage()  [aiExtractor.ts]  ONE model call → JSON of {label,count,positions}
       └─ mergeTileExtractions()  [postProcess.ts]  cross-tile dedupe + re-bucket + normalize
  └─ aggregateResults()          sum label counts across pages → output/<name>_elements.json
```

Key properties we must preserve:

- **Deterministic tiling** already solves the small-label legibility problem, so we do **not** need an LLM to physically crop.
- **`postProcess.ts`** (dedupe by page-pixel proximity, prefix re-bucketing, `q→g` / dimension-merge normalization) is pure and well-tested (`_check.ts`). It should remain untouched.
- **Provider-agnostic client** already exists (`OPENAI_BASE_URL` / `OPENAI_API_KEY`), so pointing different stages at different providers is a natural extension.

---

## 3. Proposed design (Design A — Region-router + tile-extractor)

Add one **router stage** in front of the existing tile-extraction loop.

```
main.ts
  └─ for each page:
       renderFullPage()                 render page ONCE (already happens inside pdfProcessor)
       ┌─────────────────────────────────────────────────────────────┐
       │ STRONG MODEL — 1 call per page                               │
       │ routePageRegions()  [pageRouter.ts]                          │
       │   input : downscaled full-page image                         │
       │   output: keep-regions (layout drawings) + ignore-regions    │
       │           (schedules, title blocks, legends), as boxes       │
       └─────────────────────────────────────────────────────────────┘
       tileOrigins + isBlankTile        (unchanged)
       filterTilesByRegion()            keep only tiles overlapping a keep-region
       ┌─────────────────────────────────────────────────────────────┐
       │ CHEAP MODEL — 1 call per kept tile                           │
       │ extractElementsFromImage(tile, model = EXTRACT_MODEL)        │
       └─────────────────────────────────────────────────────────────┘
       mergeTileExtractions()           (unchanged)
```

### 3.1 Why route on a downscaled full page?

Region classification (drawing vs schedule vs title block) is a **coarse, whole-page** judgment. It does not need the 400-DPI detail that label reading needs. Sending a downscaled full page (e.g. long side ~1536px) to the strong model is one cheap-ish call that returns the map of what to read. This is where the stronger model earns its cost.

### 3.2 Router contract

The router returns normalized boxes over the **full page** (0–1000 units, consistent with the extraction prompt's coordinate convention):

```jsonc
{
  "keep":   [ { "x1": 0,   "y1": 0,   "x2": 620, "y2": 1000, "kind": "layout" } ],
  "ignore": [ { "x1": 620, "y1": 0,   "x2": 1000,"y2": 480,  "kind": "schedule" },
              { "x1": 620, "y1": 820, "x2": 1000,"y2": 1000, "kind": "titleblock" } ]
}
```

Rules:
- If the router returns **no keep-regions**, fall back to **process all tiles** (fail-open — never silently drop a page).
- Expand each keep-region by a small margin (e.g. +3% of page size) before the overlap test, so labels near a region edge aren't lost.
- A tile is kept if it overlaps **any** keep-region and is **not** fully inside an ignore-region.

### 3.3 Tile filtering

`pdfProcessor.ts` already computes each tile's `left/top/width/height` in full-page pixels. Convert keep-regions from 0–1000 units to page pixels once, then keep a tile when its rectangle intersects a keep-region rectangle. This is a few lines of pure geometry and is unit-testable in `_check.ts`.

---

## 4. Alternative (Design B — Agentic crop + extract)

Port `beam-detect`'s approach: a strong model with `crop_cell`-style tools visually crops each region of interest, and a cheap model reads each crop.

- **Pros:** most faithful to "AI crops, AI extracts"; good when the target is **detailed schedule tables** (reinforcement, stirrups, sizes) rather than counting layout labels.
- **Cons:** non-deterministic; an agent loop per page (many strong-model calls); redundant here because tiling already guarantees legibility; harder to test.

**Recommendation:** not for this repo's counting task. Keep Design B in mind only if the scope later expands to structured schedule extraction (which is really `beam-detect`'s domain).

---

## 5. Model selection

| Stage | Job | Suggested tier | Example slugs |
|-------|-----|----------------|---------------|
| Router | Whole-page region classification | Stronger vision | `gpt-4.1`, `google/gemini-2.5-pro` |
| Extractor | Read labels from a clean tile | Cheaper vision | `gpt-4.1-mini`, `google/gemini-2.5-flash` |

Exact slugs are configurable; the point is the router is the pricier model called rarely, the extractor is the cheap model called often. Both go through the same OpenAI-compatible client, so mixing providers (e.g. router on OpenAI, extractor on OpenRouter) is possible if we allow per-stage base URL/key.

---

## 6. Configuration changes (`config.ts`)

Additive and backward-compatible — if the new vars are unset, behaviour collapses to today's single-model flow.

```ts
// Router (strong) — leave empty to DISABLE routing and process all tiles.
export const OPENAI_ROUTER_MODEL = process.env.OPENAI_ROUTER_MODEL ?? "";

// Extractor (cheap) — falls back to the existing single-model var.
export const OPENAI_EXTRACT_MODEL =
  process.env.OPENAI_EXTRACT_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";

// Optional per-stage provider overrides (default to the shared base URL/key).
export const OPENAI_ROUTER_BASE_URL = process.env.OPENAI_ROUTER_BASE_URL ?? OPENAI_BASE_URL;
export const OPENAI_ROUTER_API_KEY  = process.env.OPENAI_ROUTER_API_KEY  ?? OPENAI_API_KEY;

// Router input: downscale the full page to this long-side px before routing.
export const ROUTER_PAGE_MAX_DIM = 1536;
// Margin (fraction of page size) added around keep-regions before tile filtering.
export const KEEP_REGION_MARGIN = 0.03;
```

A dedicated `ROUTER_PROMPT` string is added alongside `EXTRACTION_PROMPT` (asks only for keep/ignore boxes, no label reading).

---

## 7. File-by-file change list

| File | Change | Risk |
|------|--------|------|
| `config.ts` | Add router/extractor model vars, margins, `ROUTER_PROMPT`. | Low — additive |
| `aiExtractor.ts` | Accept a `model` (and optionally a client) parameter so router and extractor can differ. Add a `getClient(kind)` that caches a second client for the router provider. | Low–Med |
| `pageRouter.ts` **(new)** | `routePageRegions(pageImage): Promise<Regions>` — downscale, one strong-model call, parse keep/ignore boxes, fail-open on empty/bad JSON. | Med — new logic |
| `pdfProcessor.ts` | Expose full-page image (or a hook) so the router can see the whole page; add `tileIntersectsRegions()` geometry helper. Tiling itself unchanged. | Low–Med |
| `main.ts` | Per page: call router (if enabled) → filter tiles → extract with `EXTRACT_MODEL`. Log kept/skipped tile counts. | Low |
| `postProcess.ts` | **No change.** | — |
| `_check.ts` | Add tests for region parsing, fail-open, and tile↔region intersection. | Low |
| `.env.example` / `README.md` | Document new vars and the two-tier flow. | Low |

---

## 8. Cost model

Let a page have **T** non-blank tiles, of which **K** overlap keep-regions (K ≤ T). Let `Cr` = router cost/call, `Cs` = strong extraction cost/tile, `Cc` = cheap extraction cost/tile.

- **Baseline (today):** `T × Cs`
- **Design A:** `Cr + K × Cc`

Design A wins whenever `Cr + K·Cc < T·Cs`. It pays off most on **schedule/title-block-heavy sheets** (K ≪ T) and when `Cc ≪ Cs`. On a page that is *all* layout drawing (K ≈ T), the router adds one call but the cheap extractor still lowers per-tile cost — usually still net cheaper, and typically **more accurate** because the cheap model never sees confusing schedule tiles.

**Accuracy angle:** filtering out schedule tiles removes a known false-positive source (labels read from reinforcement tables the prompt wants ignored), which the deterministic re-bucketing can't always catch.

---

## 9. Risks & mitigations

- **Router mis-draws boxes / drops a real drawing region.** → Fail-open (empty result ⇒ process all tiles), generous keep-region margin, and a config flag to disable routing entirely.
- **Coordinate convention drift.** → Router uses the same 0–1000 normalized space as the extraction prompt; convert to page pixels in exactly one helper, covered by tests.
- **Two providers = two keys/limits to manage.** → Per-stage base URL/key are optional; default to the shared client.
- **Extra latency from the serial router step.** → One call per page, on a small downscaled image; negligible vs the tile fan-out that already dominates.
- **Cheap model slightly weaker on borderline labels.** → Keep `temperature=0`; the router doesn't change extraction accuracy on the tiles it keeps, and post-processing normalization still applies. Easy A/B: run baseline vs Design A on the same PDF and diff the JSON.

---

## 10. Rollout plan

1. **Phase 0 — config plumbing.** Add vars; make `extractElementsFromImage` take a model param. `OPENAI_ROUTER_MODEL` empty ⇒ identical behaviour to today. Ship, verify no regression via `npm run check`.
2. **Phase 1 — router, dark launch.** Add `pageRouter.ts` and tile filtering, but log kept/skipped counts **without** dropping tiles. Inspect logs on real sheets to confirm the router's keep/ignore boxes look right.
3. **Phase 2 — enable filtering.** Actually drop non-kept tiles. A/B one representative PDF (baseline JSON vs new JSON) and compare label counts + cost.
4. **Phase 3 — tune.** Adjust `KEEP_REGION_MARGIN`, router prompt, and model choices based on the diff.

---

## 11. Validation

- Extend `_check.ts` with pure-function tests: region JSON parsing (incl. fenced/garbled output → fail-open), 0–1000 ↔ pixel conversion, tile/region intersection with margins.
- End-to-end A/B: `output/<pdf>_elements.json` from baseline vs Design A on the same input; the label sets should match on layout-only pages and *shrink* (fewer schedule false positives) on schedule-heavy pages.
- Track token usage per stage (a small counter, or port `beam-detect`'s `TokenTracker`) to confirm the cost model in practice.

---

## 12. Summary

Design A is a **small, additive, backward-compatible** change: one new file (`pageRouter.ts`), a model parameter in `aiExtractor.ts`, a geometry filter in `pdfProcessor.ts`, and wiring in `main.ts`. It leaves the deterministic tiling and the tested post-processing untouched, degrades gracefully to today's single-model flow when the router is disabled, and delivers the intended "strong model decides where to look, cheap model does the reading" architecture with a clear cost and accuracy win on real-world drawing sheets.
