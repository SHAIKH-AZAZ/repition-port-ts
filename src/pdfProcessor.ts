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
  /**
   * Relative artifact path (no extension) for debug saving, assigned by the
   * pipeline, e.g. "r0_plan-top-left/tile_2" or "tile_5". Optional.
   */
  artifactName?: string;
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

// ── Agentic (Design B) helpers ────────────────────────────────────────────────

/** A page rendered once at full PDF_DPI, decoded to raw pixels. */
export interface RenderedPage {
  page: number; // 1-indexed
  pageWidth: number;
  pageHeight: number;
  /** Raw decoded pixels of the full page (reused for every crop). */
  raw: Buffer;
  channels: number;
}

/** A rectangle in full-resolution page pixels. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Yield each PDF page rendered once at PDF_DPI and decoded to raw pixels.
 * Used by the agentic pipeline: the raw buffer is cropped many times (once per
 * region the cropper model returns) without re-decoding the page.
 */
export async function* pdfToPages(
  pdfPath: string,
): AsyncGenerator<RenderedPage, void, void> {
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }
  const document = await pdf(pdfPath, { scale: PDF_DPI / 72 });

  let pageNum = 0;
  for await (const pageBuffer of document) {
    pageNum += 1;
    const { data: raw, info } = await sharp(pageBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    yield {
      page: pageNum,
      pageWidth: info.width,
      pageHeight: info.height,
      raw,
      channels: info.channels,
    };
  }
}

/**
 * Encode a downscaled preview of the full page (long side <= maxDim) as base64
 * PNG. This is what the cropper model sees — region-finding does not need full
 * resolution, and a smaller image keeps the strong-model call cheap.
 */
export async function encodePagePreview(
  page: RenderedPage,
  maxDim: number,
): Promise<string> {
  const png = await sharp(page.raw, {
    raw: {
      width: page.pageWidth,
      height: page.pageHeight,
      channels: page.channels as 1 | 2 | 3 | 4,
    },
  })
    .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return png.toString("base64");
}

/**
 * Crop one region out of the full-resolution page and split it into
 * TILE_SIZE tiles (with TILE_OVERLAP) so labels stay legible for the extractor
 * — a big region downscaled to one image would make small labels unreadable.
 * Blank sub-tiles are skipped. All tile origins are in ABSOLUTE page pixels so
 * the returned tiles plug straight into mergeTileExtractions() for cross-tile
 * dedupe.
 */
export async function tilesFromRegion(
  page: RenderedPage,
  region: PixelRect,
): Promise<PageTile[]> {
  const rawInput = {
    raw: {
      width: page.pageWidth,
      height: page.pageHeight,
      channels: page.channels as 1 | 2 | 3 | 4,
    },
  };

  // Clamp the region to the page bounds.
  const regLeft = Math.max(0, Math.min(page.pageWidth - 1, Math.floor(region.left)));
  const regTop = Math.max(0, Math.min(page.pageHeight - 1, Math.floor(region.top)));
  const regWidth = Math.max(1, Math.min(page.pageWidth - regLeft, Math.floor(region.width)));
  const regHeight = Math.max(1, Math.min(page.pageHeight - regTop, Math.floor(region.height)));

  // Tile origins RELATIVE to the region, then shifted into page coordinates.
  const xs = tileOrigins(regWidth, TILE_SIZE, TILE_OVERLAP).map((x) => regLeft + x);
  const ys = tileOrigins(regHeight, TILE_SIZE, TILE_OVERLAP).map((y) => regTop + y);

  const tiles: PageTile[] = [];
  let index = 0;
  for (const top of ys) {
    for (const left of xs) {
      const width = Math.min(TILE_SIZE, page.pageWidth - left);
      const height = Math.min(TILE_SIZE, page.pageHeight - top);

      const crop = await sharp(page.raw, rawInput)
        .extract({ left, top, width, height })
        .png()
        .toBuffer();

      index += 1;
      if (await isBlankTile(crop)) {
        continue;
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
  return tiles;
}
