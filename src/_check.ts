import assert from "node:assert";
import { parseResponse, emptyResult, emptyExtraction } from "./aiExtractor.js";
import { mergeTileExtractions, resolveElement, normalizeLabel } from "./postProcess.js";
import { parsePageList } from "./main.js";

// ── parseResponse: new positions format ───────────────────────────────────────
const r1 = parseResponse(
  '```json\n{"BEAM":{"labels":[{"label":"B1","count":2,"positions":[{"x":100,"y":200},{"x":900,"y":800}]}]}}\n```',
);
assert.equal(r1.BEAM.length, 1);
assert.equal(r1.BEAM[0].count, 2);
assert.equal(r1.BEAM[0].positions.length, 2);
assert.equal(r1.SLAB.length, 0);

// positions win over an inconsistent count
const r1b = parseResponse('{"BEAM":{"labels":[{"label":"B1","count":9,"positions":[{"x":5,"y":5}]}]}}');
assert.equal(r1b.BEAM[0].count, 1);

// count-only and flat-string fallbacks
const r2 = parseResponse('{"COLUMN":{"labels":[{"label":"C1","count":3},"C2"]}}');
assert.equal(r2.COLUMN[0].count, 3);
assert.deepEqual(r2.COLUMN[0].positions, []);
assert.equal(r2.COLUMN[1].label, "C2");
assert.equal(r2.COLUMN[1].count, 1);

assert.throws(() => parseResponse("not json"), /non-JSON/);

// ── resolveElement: re-bucketing and junk drop ────────────────────────────────
assert.equal(resolveElement("S13", "COLUMN"), "SLAB"); // wrong bucket -> fixed
assert.equal(resolveElement("RMB1", "SLAB"), "BEAM");
assert.equal(resolveElement("B5a", "SLAB"), "BEAM");
assert.equal(resolveElement("B32a/RMB2", "BEAM"), "BEAM");
assert.equal(resolveElement("P1", "BEAM"), "BEAM"); // ambiguous -> keep model's
assert.equal(resolveElement("P1", "COLUMN"), "COLUMN");
assert.equal(resolveElement("B1(300x600)", "BEAM"), "BEAM");
assert.equal(resolveElement("RCC SLAB", "SLAB"), null); // junk
assert.equal(resolveElement("BEAM", "BEAM"), null);
assert.equal(resolveElement("C", "COLUMN"), null);
assert.equal(resolveElement("450", "BEAM"), null);

// ── normalizeLabel: misread fixes ─────────────────────────────────────────────
assert.equal(normalizeLabel("B32q"), "B32g"); // q suffix -> g
assert.equal(normalizeLabel("B50q/RMB1"), "B50g/RMB1");
assert.equal(normalizeLabel("B44c"), "B44c"); // untouched
assert.equal(normalizeLabel("B750"), null); // dimension merge -> dropped
assert.equal(normalizeLabel("B750a"), null);
assert.equal(normalizeLabel("B64"), "B64"); // real beam numbers kept
assert.equal(normalizeLabel("B93"), "B93");

// slash-chain compounds must survive resolveElement whole
assert.equal(resolveElement("LB1/B24/RMB1", "BEAM"), "BEAM");
assert.equal(resolveElement("B25a/RMB1", "BEAM"), "BEAM");

// bare HB (hidden beam, no digits) is valid
assert.equal(resolveElement("HB", "BEAM"), "BEAM");
assert.equal(resolveElement("HB1", "BEAM"), "BEAM");

// ── mergeTileExtractions: cross-tile proximity dedupe ─────────────────────────
// Two horizontally adjacent tiles; S4 sits in the shared overlap band and is
// reported by BOTH tiles at (nearly) the same page position -> counted once.
// Position error tolerance: anything within DEDUPE_RADIUS_PX merges.
const tileA = { left: 0, top: 0, width: 1024, height: 1024 };
const tileB = { left: 864, top: 0, width: 1024, height: 1024 };
const exA = emptyExtraction();
exA.SLAB = [
  { label: "S4", count: 2, positions: [{ x: 300, y: 500 }, { x: 900, y: 500 }] },
  // x=900 -> page px 921.6, inside overlap band [864,1024): owned by A? A owns [0,944) -> kept
];
const exB = emptyExtraction();
exB.SLAB = [
  { label: "S4", count: 1, positions: [{ x: 56, y: 500 }] },
  // x=56 -> page px 864 + 57.3 = 921.3 -> same physical label; B owns [944, ...) -> dropped
];
const merged = mergeTileExtractions(
  [{ tile: tileA, extraction: exA }, { tile: tileB, extraction: exB }],
  4678,
  1024,
);
assert.deepEqual(merged.SLAB.labels, [{ label: "S4", count: 2 }]); // not 3
assert.equal(merged.SLAB.total_distinct, 1);

// junk + misclassification cleaned during merge
const exC = emptyExtraction();
exC.SLAB = [
  { label: "RMB1", count: 1, positions: [{ x: 500, y: 500 }] },
  { label: "RCC SLAB", count: 4, positions: [] },
];
const merged2 = mergeTileExtractions([{ tile: tileA, extraction: exC }], 1024, 1024);
assert.deepEqual(merged2.BEAM.labels, [{ label: "RMB1", count: 1 }]);
assert.deepEqual(merged2.SLAB.labels, []);

// far-apart occurrences from different tiles are NOT merged; same-tile pairs never merge
const exD = emptyExtraction();
exD.BEAM = [{ label: "B7", count: 2, positions: [{ x: 100, y: 100 }, { x: 200, y: 120 }] }];
// tile-local distance ~104px < radius, but SAME tile -> both kept
const exE = emptyExtraction();
exE.BEAM = [{ label: "B7", count: 1, positions: [{ x: 500, y: 900 }] }];
// page pos (1376, 921.6) — far from tile A's B7s -> kept
const merged3 = mergeTileExtractions(
  [{ tile: tileA, extraction: exD }, { tile: tileB, extraction: exE }],
  4678,
  1024,
);
assert.deepEqual(merged3.BEAM.labels, [{ label: "B7", count: 3 }]);

// ── misc ──────────────────────────────────────────────────────────────────────
assert.deepEqual(parsePageList("1,3,5-8,10"), [1, 3, 5, 6, 7, 8, 10]);
assert.deepEqual(parsePageList("2-2"), [2]);
assert.throws(() => parsePageList("x"), /invalid/);
assert.deepEqual(Object.keys(emptyResult()), ["BEAM", "SLAB", "COLUMN", "FOOTING"]);

console.log("logic checks PASS");
