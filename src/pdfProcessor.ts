/**
 * src/pdfProcessor.ts
 * Converts PDF pages to base64-encoded PNG images using pdf-to-img (pdf.js)
 * and sharp for optional downscaling.
 */

import { existsSync } from "node:fs";
import { pdf } from "pdf-to-img";
import sharp from "sharp";

import { PDF_DPI, MAX_IMAGE_DIM } from "./config.js";

/** Downscale a PNG buffer so its longest side does not exceed maxDim pixels. */
async function resizeIfNeeded(png: Buffer, maxDim: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.max(w, h) <= maxDim) {
    return png;
  }
  // sharp preserves aspect ratio when only one bound is given; `inside` fit
  // caps the longest side at maxDim.
  return sharp(png)
    .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

/**
 * Yield [pageNumber, base64PngString] for every page in the PDF.
 *
 * pageNumber is 1-indexed.
 * base64PngString is a standard base64-encoded PNG, ready for the OpenAI
 * vision API data URL: `data:image/png;base64,${b64}`.
 */
export async function* pdfToPageImages(
  pdfPath: string,
): AsyncGenerator<[number, string], void, void> {
  if (!existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  // pdf-to-img `scale` multiplies the 72-dpi default, matching PyMuPDF's zoom.
  const document = await pdf(pdfPath, { scale: PDF_DPI / 72 });

  let pageIndex = 0;
  for await (const pageBuffer of document) {
    pageIndex += 1;
    const resized = await resizeIfNeeded(pageBuffer, MAX_IMAGE_DIM);
    yield [pageIndex, resized.toString("base64")];
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
