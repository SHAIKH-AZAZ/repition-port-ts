#!/usr/bin/env node
/**
 * main.ts
 * RCC Drawing Element Analyzer — Entry Point (TypeScript port)
 * ──────────────────────────────────────────────────────────
 * Scans the `input/` folder for PDF drawing files, analyses each one for
 * BEAM, SLAB, COLUMN, and FOOTING repetitions using GPT-4.1-mini vision,
 * and writes per-file JSON reports to the `output/` folder.
 *
 * Usage:
 *     # Analyse ALL PDFs in input/
 *     npm start
 *
 *     # Analyse a specific PDF inside input/
 *     npm start -- --file drawing.pdf
 *
 *     # Analyse only specific pages
 *     npm start -- --file drawing.pdf --pages 1,3,5-8
 *
 *     # Custom output file name (written to output/)
 *     npm start -- --file drawing.pdf --output my_report.json
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  STRUCTURAL_ELEMENTS,
  DEFAULT_OUTPUT_SUFFIX,
  INPUT_DIR,
  OUTPUT_DIR,
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
import { extractElementsFromImage, emptyResult } from "./aiExtractor.js";
import { mergeTileExtractions } from "./postProcess.js";
import type { TileResult } from "./postProcess.js";
import type { PageError, PageResult, Summary } from "./types.js";

/** One page's tiles ready for extraction, from either pipeline. */
interface PageWork {
  page: number;
  pageWidth: number;
  pageHeight: number;
  tiles: PageTile[];
  /** Grid positions before blank-skipping (grid mode only). */
  gridTiles?: number;
}

/**
 * Produce per-page tiles using the selected pipeline.
 *  - Agentic (Design B, when OPENAI_CROP_MODEL is set): a strong model crops
 *    the regions worth reading, each region is tiled for legibility.
 *    Falls back to whole-page tiling when the cropper returns nothing or fails.
 *  - Grid (default): the original deterministic overlapping-tile pipeline.
 */
async function* producePageWork(
  pdfPath: string,
  pageSet: Set<number>,
): AsyncGenerator<PageWork, void, void> {
  if (OPENAI_CROP_MODEL) {
    for await (const page of pdfToPages(pdfPath)) {
      if (!pageSet.has(page.page)) continue; // don't spend cropper calls on skipped pages

      let tiles: PageTile[] = [];
      try {
        const preview = await encodePagePreview(page, CROP_PAGE_MAX_DIM);
        const regions = await cropPage(page.page, preview);
        if (regions.length === 0) {
          tiles = await tilesFromRegion(page, {
            left: 0,
            top: 0,
            width: page.pageWidth,
            height: page.pageHeight,
          });
        } else {
          for (const r of regions) {
            const rect: PixelRect = {
              left: r.x1 * page.pageWidth,
              top: r.y1 * page.pageHeight,
              width: (r.x2 - r.x1) * page.pageWidth,
              height: (r.y2 - r.y1) * page.pageHeight,
            };
            tiles.push(...(await tilesFromRegion(page, rect)));
          }
        }
      } catch (exc) {
        const msg = exc instanceof Error ? exc.message : String(exc);
        console.log(`\n  [Page ${page.page}] cropper stage failed (${msg}); tiling whole page.`);
        tiles = await tilesFromRegion(page, {
          left: 0,
          top: 0,
          width: page.pageWidth,
          height: page.pageHeight,
        });
      }

      yield { page: page.page, pageWidth: page.pageWidth, pageHeight: page.pageHeight, tiles };
    }
  } else {
    for await (const pageTiles of pdfToPageTiles(pdfPath)) {
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

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Compute document-level label repetition counts from per-page results.
 * Each element maps label -> total occurrences summed across all pages,
 * e.g. { "BEAM": { "B1": 5, "B2": 2 }, ... }
 */
function aggregateResults(perPage: PageResult[]): Summary {
  const summary = {} as Summary;
  for (const element of STRUCTURAL_ELEMENTS) {
    const labelCounts: Record<string, number> = {};
    for (const pageData of perPage) {
      const entry = pageData.elements[element] ?? { total_distinct: 0, labels: [] };
      for (const { label, count } of entry.labels) {
        labelCounts[label] = (labelCounts[label] ?? 0) + count;
      }
    }
    // Sort alphabetically so output is stable
    const sorted: Record<string, number> = {};
    for (const key of Object.keys(labelCounts).sort()) {
      sorted[key] = labelCounts[key];
    }
    summary[element] = sorted;
  }
  return summary;
}

// ── Core analysis pipeline ────────────────────────────────────────────────────

async function analyzePdf(
  pdfPath: string,
  outputPath: string,
  pageFilter: number[] | null = null,
): Promise<Summary> {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log("  RCC Drawing Element Analyzer");
  console.log(bar);
  console.log(`  PDF    : ${pdfPath}`);
  console.log(`  Output : ${outputPath}`);
  console.log(
    `  Mode   : ${OPENAI_CROP_MODEL ? `agentic crop (${OPENAI_CROP_MODEL}) + extract` : "grid tiling"}`,
  );

  const totalPages = await getPageCount(pdfPath);
  const pagesToProcess = pageFilter && pageFilter.length ? pageFilter : rangeInclusive(1, totalPages);
  const pagesToProcessSet = new Set(pagesToProcess);

  console.log(`  Pages  : ${totalPages} total | processing ${pagesToProcess.length} page(s)`);
  console.log(`${bar}\n`);

  const perPageResults: PageResult[] = [];
  const errors: PageError[] = [];

  let done = 0;
  for await (const work of producePageWork(pdfPath, pagesToProcessSet)) {
    const pageNum = work.page;
    if (!pagesToProcessSet.has(pageNum)) {
      continue;
    }

    const skipped =
      work.gridTiles !== undefined ? work.gridTiles - work.tiles.length : 0;
    process.stderr.write(
      `\rPage ${pageNum}: ${work.tiles.length} tile(s) to analyse` +
        (skipped ? ` (${skipped} blank skipped)` : "") +
        "\n",
    );

    try {
      const tileResults: TileResult[] = await mapWithConcurrency(
        work.tiles,
        TILE_CONCURRENCY,
        async (tile: PageTile, i: number) => {
          const extraction = await extractElementsFromImage(pageNum, tile.b64);
          process.stderr.write(
            `\r  Page ${pageNum} tiles [${i + 1}/${work.tiles.length}]`,
          );
          return { tile, extraction };
        },
      );
      const elements = mergeTileExtractions(
        tileResults,
        work.pageWidth,
        work.pageHeight,
      );
      perPageResults.push({ page: pageNum, elements });
    } catch (exc) {
      const errMsg = exc instanceof Error ? exc.message : String(exc);
      console.log(`\n  ERROR on page ${pageNum}: ${errMsg}`);
      errors.push({ page: pageNum, error: errMsg });
      // Still record the page with zeros so it appears in output
      perPageResults.push({ page: pageNum, elements: emptyResult(), error: errMsg });
    } finally {
      done += 1;
      process.stderr.write(`\rAnalysed page ${pageNum} [${done}/${pagesToProcess.length}]\n`);
    }
  }
  process.stderr.write("\n");

  // Sort per-page results by page number
  perPageResults.sort((a, b) => a.page - b.page);

  // Aggregate across pages — final report is just { ELEMENT: { label: count } }
  const summary = aggregateResults(perPageResults);

  // Write JSON to output/
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf-8");

  // ── Console summary ─────────────────────────────────────────────────────────
  console.log(`\n${bar}`);
  console.log("  RESULTS SUMMARY");
  console.log(bar);
  for (const element of STRUCTURAL_ELEMENTS) {
    const entries = Object.entries(summary[element]);
    const totalInstances = entries.reduce((acc, [, count]) => acc + count, 0);
    const distinct = entries.length;
    const labelsStr = entries.length
      ? entries.map(([lbl, count]) => `${lbl}: ${count}`).join(", ")
      : "-";
    console.log(
      `  ${element.padEnd(10)}  distinct=${String(distinct).padStart(3)}  total_instances=${String(totalInstances).padStart(4)}   ${labelsStr}`,
    );
  }
  if (errors.length) {
    console.log(`\n  !  ${errors.length} page(s) had errors (not included in JSON output).`);
  }
  console.log(`\n  JSON report saved -> ${outputPath}\n`);

  return summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map over items with at most `limit` promises in flight; preserves order. */
async function mapWithConcurrency<T, R>(
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

function rangeInclusive(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** Parse '1,3,5-8,10' style page specification into a sorted list of ints. */
export function parsePageList(raw: string): number[] {
  const pages = new Set<number>();
  for (const partRaw of raw.split(",")) {
    const part = partRaw.trim();
    if (part.includes("-")) {
      const [startS, endS] = part.split("-", 2);
      const start = Number.parseInt(startS, 10);
      const end = Number.parseInt(endS, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`invalid range: '${part}'`);
      }
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      const n = Number.parseInt(part, 10);
      if (Number.isNaN(n)) {
        throw new Error(`invalid page number: '${part}'`);
      }
      pages.add(n);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/** Return all PDF files found in the input/ folder. */
function discoverPdfs(): string[] {
  if (!existsSync(INPUT_DIR)) {
    mkdirSync(INPUT_DIR, { recursive: true });
  }
  return readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => path.join(INPUT_DIR, f));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string", short: "f" },
      output: { type: "string", short: "o" },
      pages: { type: "string", short: "p" },
    },
    allowPositionals: false,
  });

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Resolve page filter
  let pageFilter: number[] | null = null;
  if (values.pages) {
    try {
      pageFilter = parsePageList(values.pages);
    } catch (exc) {
      console.error(`ERROR: Invalid --pages value: ${exc instanceof Error ? exc.message : exc}`);
      process.exit(1);
    }
  }

  if (values.file) {
    const pdfPath = path.join(INPUT_DIR, values.file);
    if (!existsSync(pdfPath)) {
      console.error(`ERROR: File not found in input/: ${pdfPath}`);
      process.exit(1);
    }
    const stem = path.basename(values.file, path.extname(values.file));
    const outputPath = values.output
      ? path.join(OUTPUT_DIR, values.output)
      : path.join(OUTPUT_DIR, stem + DEFAULT_OUTPUT_SUFFIX);

    await analyzePdf(pdfPath, outputPath, pageFilter);
  } else {
    // Batch mode — process every PDF in input/
    const pdfs = discoverPdfs();
    if (!pdfs.length) {
      console.log(`No PDF files found in ${INPUT_DIR}. Drop your drawings there and re-run.`);
      process.exit(0);
    }

    console.log(`Found ${pdfs.length} PDF(s) in ${INPUT_DIR}:`);
    for (const p of pdfs) {
      console.log(`  • ${path.basename(p)}`);
    }

    for (const pdfPath of pdfs) {
      const stem = path.basename(pdfPath, path.extname(pdfPath));
      const outputPath = path.join(OUTPUT_DIR, stem + DEFAULT_OUTPUT_SUFFIX);
      await analyzePdf(pdfPath, outputPath, pageFilter);
    }

    console.log(`\nAll done. Reports written to → ${OUTPUT_DIR}\n`);
  }
}

// Only run when executed directly (mirrors Python's `if __name__ == "__main__"`).
// Compare real filesystem paths — string-comparing URLs breaks when the path
// contains spaces (encoded as %20 in import.meta.url).
const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((exc) => {
    console.error(exc);
    process.exit(1);
  });
}
