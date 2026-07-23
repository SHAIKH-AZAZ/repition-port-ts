#!/usr/bin/env node
/**
 * main.ts
 * RCC Drawing Element Analyzer — CLI entry point.
 *
 * Thin consumer of the event-emitting core in analysis.ts: it builds run
 * options and an emitter that prints progress, preserving the original console
 * output. The same core powers the web backend (which emits over Socket.io).
 *
 * Usage:
 *     npm start                                  # all PDFs in input/
 *     npm start -- --file drawing.pdf            # one PDF
 *     npm start -- --file drawing.pdf --pages 1,3,5-8
 *     npm start -- --file drawing.pdf --output my_report.json
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  STRUCTURAL_ELEMENTS,
  DEFAULT_OUTPUT_SUFFIX,
  INPUT_DIR,
  OUTPUT_DIR,
  OPENAI_CROP_MODEL,
  SAVE_ARTIFACTS,
  ARTIFACTS_SUFFIX,
} from "./config.js";
import { runAnalysis } from "./analysis.js";
import type { Emit } from "./analysis.js";
import type { AnalysisEvent, Summary } from "./events.js";

const BAR = "=".repeat(60);

/** Build an emitter that reproduces the original CLI console output. */
function makeConsoleEmitter(pdfPath: string, outputPath: string): Emit {
  return (e: AnalysisEvent) => {
    switch (e.type) {
      case "job":
        console.log(`\n${BAR}`);
        console.log("  RCC Drawing Element Analyzer");
        console.log(BAR);
        console.log(`  PDF    : ${pdfPath}`);
        console.log(`  Output : ${outputPath}`);
        console.log(
          `  Mode   : ${OPENAI_CROP_MODEL ? `agentic crop (${OPENAI_CROP_MODEL}) + extract` : "grid tiling"}`,
        );
        console.log(`  Pages  : ${e.totalPages} total | processing ${e.pages.length} page(s)`);
        console.log(`${BAR}\n`);
        break;
      case "status":
        console.log(`  ${e.message}`);
        break;
      case "page-start":
        process.stderr.write(
          `Page ${e.page}: ${e.tiles} tile(s) to analyse` +
            (e.blankSkipped ? ` (${e.blankSkipped} blank skipped)` : "") +
            "\n",
        );
        break;
      case "page-result":
        process.stderr.write(`Analysed page ${e.page}\n`);
        break;
      case "page-error":
        console.log(`\n  ERROR on page ${e.page}: ${e.message}`);
        break;
      case "summary":
        printSummary(e.summary);
        break;
      case "done":
        if (e.errors) {
          console.log(`\n  !  ${e.errors} page(s) had errors (not included in JSON output).`);
        }
        console.log(`\n  JSON report saved -> ${e.resultUrl}\n`);
        break;
      // crop / extraction / regions are for the UI; the CLI stays quiet on those.
    }
  };
}

function printSummary(summary: Summary): void {
  console.log(`\n${BAR}`);
  console.log("  RESULTS SUMMARY");
  console.log(BAR);
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
}

/** Analyse one PDF via the core, printing progress to the console. */
async function analyzePdf(
  pdfPath: string,
  outputPath: string,
  pageFilter: number[] | null = null,
): Promise<Summary> {
  const stem = path.basename(pdfPath, path.extname(pdfPath));
  const artifactsDir = SAVE_ARTIFACTS
    ? path.join(OUTPUT_DIR, stem + ARTIFACTS_SUFFIX)
    : null;
  if (artifactsDir) {
    console.log(`  Crops  : per-crop images + JSON -> ${artifactsDir}`);
  }
  return runAnalysis(
    pdfPath,
    { pageFilter, outputPath, artifactsDir },
    makeConsoleEmitter(pdfPath, outputPath),
  );
}

// ── CLI helpers ────────────────────────────────────────────────────────────────

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

// ── CLI ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string", short: "f" },
      output: { type: "string", short: "o" },
      pages: { type: "string", short: "p" },
    },
    allowPositionals: false,
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });

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

// Only run when executed directly.
const isDirectRun =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((exc) => {
    console.error(exc);
    process.exit(1);
  });
}
