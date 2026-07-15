import assert from "node:assert";
import { parseResponse, emptyResult } from "./aiExtractor.js";
import { parsePageList } from "./main.js";

const r1 = parseResponse('```json\n{"BEAM":{"total_distinct":2,"labels":[{"label":"B1","count":5},{"label":"B2","count":2}]}}\n```');
assert.equal(r1.BEAM.total_distinct, 2);
assert.equal(r1.BEAM.labels[0].count, 5);
assert.equal(r1.SLAB.total_distinct, 0);

const r2 = parseResponse('{"COLUMN":{"labels":["C1","C2"]}}');
assert.equal(r2.COLUMN.labels[1].label, "C2");
assert.equal(r2.COLUMN.labels[1].count, 1);
assert.equal(r2.COLUMN.total_distinct, 2);

assert.throws(() => parseResponse("not json"), /non-JSON/);

assert.deepEqual(parsePageList("1,3,5-8,10"), [1,3,5,6,7,8,10]);
assert.deepEqual(parsePageList("2-2"), [2]);
assert.throws(() => parsePageList("x"), /invalid/);

assert.deepEqual(Object.keys(emptyResult()), ["BEAM","SLAB","COLUMN","FOOTING"]);
console.log("logic checks PASS");
