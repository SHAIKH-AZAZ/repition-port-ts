/**
 * src/pdfProcessor.ts
 * Converts PDF pages to base64-encoded PNG images using pdf-to-img (pdf.js)
 * and sharp.
 *
 * Pages are rendered at full PDF_DPI and split into overlapping high-res
 * tiles so small element labels (2–3 mm text on A1/A0 sheets) stay legible
 * for the vision model. Blank tiles (empty drawing regions) are skipped to
 * save API calls.
 */

import { existsSync } from "node:fs";
import { pdf } from "pdf-to-img";
import sharp from "sharp";

import {
  PDF_DPI,
  TILE_SIZE,
  TILE_OVERLAP,
  BLANK_TILE_STD_THRESHOLD,
} from "./config.js";

/** A single high-res crop of a rendered PDF page. */
export interface PageTile {
  /** 0-based tile index within the page (reading order). */
  index: number;
  /** Tile origin in full-resolution page pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Base64-encoded PNG of the crop. */
  b64: string;
}

/** All tiles for one page. */
export interface PageTiles {
  page: number; // 1-indexed
  /** Full-resolution page size in pixels. */
  pageWidth: number;
  pageHeight: number;
  /** Number of grid positions (before blank-skipping). */
  gridTiles: number;
  /** Non-blank tiles actually produced. */
  tiles: PageTile[];
}

/**
 * Compute tile origins along one axis so that consecutive tiles overlap by
 * TILE_OVERLAP pixels and the last tile ends exactly at the page edge.
 */
function tileOrigins(total: number, tileSize: number, overlap: number): number[] {
  if (total <= tileSize) return [0];
  const step = tileSize - overlap;
  const origins: number[] = [];
  for (let pos = 0; pos + tileSize < total; pos += step) {
    origins.push(pos);
  }
  origins.push(total - tileSize); // final tile flush with the edge
  return origins;
}

/**
 * True when a crop contains essentially no drawing content (uniform colour).
 * Line drawings on white have a small-but-nonzero channel stddev; a truly
 * empty region is ~0.
 */
async function isBlankTile(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).stats();
  return stats.channels.every((c) => c.stdev < BLANK_TILE_STD_THRESHOLD);
}

/**
 * Yield tiles for every page in the PDF.
 *
 * Each page is rendered once at PDF_DPI, then cropped into TILE_SIZE px
 * tiles with TILE_OVERLAP px of overlap between neighbours (so labels cut
 * by one tile's edge appear whole in the adjacent tile). Blank tiles are
 * dropped. Small pages that fit within a single tile are yielded whole.
 */
export async function* pdfToPageTiles(
  pdfPath: string,
): AsyncGenerator<PageTiles, void, void> {
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  // pdf-to-img `scale` multiplies the 72-dpi default.
  const document = await pdf(pdfPath, { scale: PDF_DPI / 72 });

  let pageNum = 0;
  for await (const pageBuffer of document) {
    pageNum += 1;

    // Decode the page PNG ONCE to raw pixels; cropping from raw avoids
    // re-decoding the multi-megapixel page for every tile.
    const { data: raw, info } = await sharp(pageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pageWidth = info.width;
    const pageHeight = info.height;
    const rawInput = {
      raw: { width: pageWidth, height: pageHeight, channels: info.channels },
    };

    const xs = tileOrigins(pageWidth, TILE_SIZE, TILE_OVERLAP);
    const ys = tileOrigins(pageHeight, TILE_SIZE, TILE_OVERLAP);
    const gridTiles = xs.length * ys.length;

    const tiles: PageTile[] = [];
    let index = 0;
    for (const top of ys) {
      for (const left of xs) {
        const width = Math.min(TILE_SIZE, pageWidth - left);
        const height = Math.min(TILE_SIZE, pageHeight - top);

        const crop = await sharp(raw, rawInput)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();

        index += 1;
        if (await isBlankTile(crop)) {
          continue; // nothing drawn here — skip the API call
        }
        tiles.push({
          index: index - 1,
          left,
          top,
          width,
          height,
          b64: crop.toString("base64"),
        });
      }
    }

    yield { page: pageNum, pageWidth, pageHeight, gridTiles, tiles };
  }
}

/** Return the total number of pages in a PDF. */
export async function getPageCount(pdfPath: string): Promise<number> {
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }
  const document = await pdf(pdfPath);
  return document.length;
}
