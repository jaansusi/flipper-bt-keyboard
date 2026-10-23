import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const us = JSON.parse(readFileSync(new URL("../layouts/us.json", import.meta.url), "utf8"));

// SPEC §5.3: key usages 0x04–0xA4, never modifier usages
const isValidStroke = ([mods, usage]) =>
  Number.isInteger(mods) && mods >= 0 && mods <= 0xff &&
  Number.isInteger(usage) && usage >= 0x04 && usage <= 0xa4;

test("US layout covers all printable ASCII plus newline and tab", () => {
  for (let c = 0x20; c < 0x7f; c++) {
    assert.ok(String.fromCharCode(c) in us.map, `missing ${JSON.stringify(String.fromCharCode(c))}`);
  }
  assert.deepEqual(us.map["\n"], [[0, 0x28]]);
  assert.deepEqual(us.map["\t"], [[0, 0x2b]]);
});

test("US layout strokes are valid", () => {
  for (const [char, strokes] of Object.entries(us.map)) {
    assert.ok(strokes.length >= 1, `no strokes for ${JSON.stringify(char)}`);
    for (const stroke of strokes) {
      assert.ok(isValidStroke(stroke), `invalid stroke for ${JSON.stringify(char)}: ${stroke}`);
    }
  }
});

test("US layout matches SPEC Appendix B examples", () => {
  assert.deepEqual(us.map.a, [[0, 0x04]]);
  assert.deepEqual(us.map.A, [[0x02, 0x04]]);
  assert.deepEqual(us.map["!"], [[0x02, 0x1e]]);
  assert.deepEqual(us.map["0"], [[0, 0x27]]);
  assert.deepEqual(us.map["?"], [[0x02, 0x38]]);
});
