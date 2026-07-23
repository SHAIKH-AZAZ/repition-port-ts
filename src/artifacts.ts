/**
 * src/artifacts.ts
 * Persist per-crop debug artifacts so each cropped image can be inspected
 * alongside the JSON that was extracted from it.
 *
 * Layout written under output/<pdf>_crops/ :
 *
 *   page_1/
 *     regions.json                 cropper's chosen regions (agentic mode)
 *     r0_plan-top-left/
 *       tile_0.png                 the cropped image sent to the extractor
 *       tile_0.json                RAW extraction for that crop
 *       tile_1.png / tile_1.json
 *     r1_section-a/
 *       tile_0.png / tile_0.json
 *     page_result.json             merged + cleaned result for the whole page
 *
 * In grid mode (no cropper) tiles are stored flat as page_N/tile_<i>.(png|json).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ElementResult, TileExtraction } from "./types.js";
import type { CropRegion } from "./cropper.js";

/** Create (if needed) and return the folder for one page's artifacts. */
export function ensurePageDir(base: string, page: number): string {
  const dir = path.join(base, `page_${page}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write the cropper's chosen regions for a page. */
export function saveRegions(pageDir: string, regions: CropRegion[]): void {
  writeFileSync(
    path.join(pageDir, "regions.json"),
    JSON.stringify(regions, null, 2),
    "utf-8",
  );
}

/**
 * Save one crop's image and the raw JSON extracted from it. `relName` may
 * contain a sub-folder (e.g. "r0_plan/tile_0"); it is created as needed. The
 * .png and .json share the same base name so they stay paired.
 */
export function saveTileArtifacts(
  pageDir: string,
  relName: string,
  b64Png: string,
  extraction: TileExtraction,
): void {
  const target = path.join(pageDir, relName);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(`${target}.png`, Buffer.from(b64Png, "base64"));
  writeFileSync(`${target}.json`, JSON.stringify(extraction, null, 2), "utf-8");
}

/** Write the merged, cleaned element result for a whole page. */
export function savePageResult(pageDir: string, elements: ElementResult): void {
  writeFileSync(
    path.join(pageDir, "page_result.json"),
    JSON.stringify(elements, null, 2),
    "utf-8",
  );
}
