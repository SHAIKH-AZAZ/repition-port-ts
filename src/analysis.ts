/**
 * src/analysis.ts
 * Event-emitting analysis core. Produces the same result as the old
 * `analyzePdf`, but instead of printing to the console it calls `emit(event)`
 * for every step, so any consumer (CLI, Feathers server) can render progress.
 *
 * The CLI (main.ts) passes an emitter that prints; the web backend passes one
 * that forwards events over Socket.io.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  STRUCTURAL_ELEMENTS,
  TILE_CONCURRENCY,
  OPENAI_CROP_MODEL,
  CROP_PAGE_MAX_DIM,
} from "./config.js";
import {
  pdfToPageTiles,
  pdfToPages,
  encodePagePreview,
  tilesFromRegion,
  getPageCount,
} from "./pdfProcessor.js";
import type { PageTile, PixelRect } from "./pdfProcessor.js";
import { cropPage } from "./cropper.js";
import type { CropRegion } from "./cropper.js";
import { extractElementsFromImage, emptyResult } from "./aiExtractor.js";
import { mergeTileExtractions } from "./postProcess.js";
import type { TileResult } from "./postProcess.js";
import {
  ensurePageDir,
  saveRegions,
  saveTileArtifacts,
  savePageResult,
} from "./artifacts.js";
import type { PageError, PageResult, Summary } from "./types.js";
import type { AnalysisEvent } from "./events.js";

export type Emit = (event: AnalysisEvent) => void;

export interface RunOptions {
  /** Identifier surfaced in the `job` event (web jobs); "" for the CLI. */
  jobId?: string;
  /** Pages to process (1-based). null/empty = all pages. */
  pageFilter?: number[] | null;
  /** Where the aggregated summary JSON is written. */
  outputPath: string;
  /** Filesystem dir for per-crop artifacts. null disables artifact saving. */
  artifactsDir?: string | null;
  /** URL prefix for emitted crop image URLs (e.g. "/crops/<job>"). */
  cropUrlBase?: string | null;
  /** Public URL/path reported in the `done` event (defaults to outputPath). */
  resultUrl?: string;
  /** Abort mid-run (checked between pages). */
  signal?: AbortSignal;
}

const noopEmit: Emit = () => {};

/** Provider error bodies can be huge; keep event/log messages bounded. */
function shortMsg(exc: unknown, max = 300): string {
  const msg = exc instanceof Error ? exc.message : String(exc);
  return msg.length > max ? msg.slice(0, max) + "… [truncated]" : msg;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runAnalysis(
  pdfPath: string,
  opts: RunOptions,
  emit: Emit = noopEmit,
): Promise<Summary> {
  const {
    jobId = "",
    pageFilter = null,
    outputPath,
    artifactsDir = null,
    cropUrlBase = null,
    resultUrl,
    signal,
  } = opts;

  const mode = OPENAI_CROP_MODEL ? "agentic" : "grid";
  const totalPages = await getPageCount(pdfPath);
  const pagesToProcess =
    pageFilter && pageFilter.length ? pageFilter : rangeInclusive(1, totalPages);
  const pagesToProcessSet = new Set(pagesToProcess);

  emit({
    type: "job",
    jobId,
    file: path.basename(pdfPath),
    totalPages,
    pages: pagesToProcess,
    mode,
  });

  const perPageResults: PageResult[] = [];
  const errors: PageError[] = [];

  for await (const work of producePageWork(pdfPath, pagesToProcessSet, emit)) {
    if (signal?.aborted) {
      emit({ type: "status", message: "Cancelled before page " + work.page });
      break;
    }
    const pageNum = work.page;
    const blankSkipped =
      work.gridTiles !== undefined ? work.gridTiles - work.tiles.length : 0;

    emit({ type: "page-start", page: pageNum, tiles: work.tiles.length, blankSkipped });

    // Prepare this page's artifact folder and dump the cropper regions.
    const pageArt = artifactsDir ? ensurePageDir(artifactsDir, pageNum) : null;
    if (pageArt && work.regions) {
      saveRegions(pageArt, work.regions);
    }
    if (work.regions) {
      emit({ type: "regions", page: pageNum, regions: work.regions });
    }

    try {
      const tileResults: TileResult[] = await mapWithConcurrency(
        work.tiles,
        TILE_CONCURRENCY,
        async (tile: PageTile) => {
          const extraction = await extractElementsFromImage(pageNum, tile.b64);
          const name = tile.artifactName;
          if (pageArt && name) {
            saveTileArtifacts(pageArt, name, tile.b64, extraction);
            const rel = `page_${pageNum}/${name}.png`;
            const url = cropUrlBase ? `${cropUrlBase}/${rel}` : path.join(pageArt, `${name}.png`);
            emit({ type: "crop", page: pageNum, name, url });
          }
          if (name) {
            emit({ type: "extraction", page: pageNum, name, extraction });
          }
          return { tile, extraction };
        },
      );
      const elements = mergeTileExtractions(tileResults, work.pageWidth, work.pageHeight);
      if (pageArt) savePageResult(pageArt, elements);
      perPageResults.push({ page: pageNum, elements });
      emit({ type: "page-result", page: pageNum, elements });
    } catch (exc) {
      const errMsg = shortMsg(exc);
      errors.push({ page: pageNum, error: errMsg });
      perPageResults.push({ page: pageNum, elements: emptyResult(), error: errMsg });
      emit({ type: "page-error", page: pageNum, message: errMsg });
    }
  }

  perPageResults.sort((a, b) => a.page - b.page);
  const summary = aggregateResults(perPageResults);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf-8");

  emit({ type: "summary", summary });
  emit({ type: "done", resultUrl: resultUrl ?? outputPath, errors: errors.length });

  return summary;
}

// ── Per-page tile production (grid or agentic cropper) ─────────────────────────

/** One page's tiles ready for extraction, from either pipeline. */
export interface PageWork {
  page: number;
  pageWidth: number;
  pageHeight: number;
  tiles: PageTile[];
  gridTiles?: number;
  regions?: CropRegion[];
}

/** Turn a region label into a filesystem-safe folder name. */
function safeName(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "region";
}

async function* producePageWork(
  pdfPath: string,
  pageSet: Set<number>,
  emit: Emit,
): AsyncGenerator<PageWork, void, void> {
  if (OPENAI_CROP_MODEL) {
    for await (const page of pdfToPages(pdfPath)) {
      if (!pageSet.has(page.page)) continue; // don't spend cropper calls on skipped pages

      const wholePage: PixelRect = {
        left: 0,
        top: 0,
        width: page.pageWidth,
        height: page.pageHeight,
      };
      const tiles: PageTile[] = [];
      let regions: CropRegion[] = [];

      try {
        const preview = await encodePagePreview(page, CROP_PAGE_MAX_DIM);
        regions = await cropPage(page.page, preview);
        if (regions.length === 0) {
          const ft = await tilesFromRegion(page, wholePage);
          ft.forEach((t, i) => (t.artifactName = `fullpage/tile_${i}`));
          tiles.push(...ft);
        } else {
          for (let ri = 0; ri < regions.length; ri++) {
            const r = regions[ri];
            const rect: PixelRect = {
              left: r.x1 * page.pageWidth,
              top: r.y1 * page.pageHeight,
              width: (r.x2 - r.x1) * page.pageWidth,
              height: (r.y2 - r.y1) * page.pageHeight,
            };
            const rt = await tilesFromRegion(page, rect);
            const folder = `r${ri}_${safeName(r.label)}`;
            rt.forEach((t, ti) => (t.artifactName = `${folder}/tile_${ti}`));
            tiles.push(...rt);
          }
        }
      } catch (exc) {
        emit({
          type: "status",
          message: `[Page ${page.page}] cropper stage failed (${shortMsg(exc)}); tiling whole page.`,
        });
        regions = [];
        const ft = await tilesFromRegion(page, wholePage);
        ft.forEach((t, i) => (t.artifactName = `fullpage/tile_${i}`));
        tiles.push(...ft);
      }

      yield {
        page: page.page,
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        tiles,
        regions,
      };
    }
  } else {
    for await (const pageTiles of pdfToPageTiles(pdfPath)) {
      pageTiles.tiles.forEach((t) => (t.artifactName = `tile_${t.index}`));
      yield {
        page: pageTiles.page,
        pageWidth: pageTiles.pageWidth,
        pageHeight: pageTiles.pageHeight,
        tiles: pageTiles.tiles,
        gridTiles: pageTiles.gridTiles,
      };
    }
  }
}

// ── Aggregation + helpers ──────────────────────────────────────────────────────

/** element -> label -> total occurrences across all pages. */
export function aggregateResults(perPage: PageResult[]): Summary {
  const summary = {} as Summary;
  for (const element of STRUCTURAL_ELEMENTS) {
    const labelCounts: Record<string, number> = {};
    for (const pageData of perPage) {
      const entry = pageData.elements[element] ?? { total_distinct: 0, labels: [] };
      for (const { label, count } of entry.labels) {
        labelCounts[label] = (labelCounts[label] ?? 0) + count;
      }
    }
    const sorted: Record<string, number> = {};
    for (const key of Object.keys(labelCounts).sort()) {
      sorted[key] = labelCounts[key];
    }
    summary[element] = sorted;
  }
  return summary;
}

/** Map over items with at most `limit` promises in flight; preserves order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function rangeInclusive(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
