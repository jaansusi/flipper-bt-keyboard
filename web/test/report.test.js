import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidReport, isZeroReport, makeReport, zeroReport } from "../js/report.js";

const bytes = (...b) => Uint8Array.from(b);

test("makeReport builds the protocol examples", () => {
  assert.deepEqual(makeReport(0, [0x04]), bytes(0, 0, 0x04, 0, 0, 0, 0, 0));
  assert.deepEqual(makeReport(0x05, [0x4c]), bytes(0x05, 0, 0x4c, 0, 0, 0, 0, 0));
  assert.deepEqual(makeReport(), zeroReport());
});

test("makeReport rejects invalid input", () => {
  assert.throws(() => makeReport(0, [1, 2, 3, 4, 5, 6, 7].map((n) => n + 3)));
  assert.throws(() => makeReport(0, [0xe0]));
  assert.throws(() => makeReport(0, [0x03]));
  assert.throws(() => makeReport(0, [0x04, 0x04]));
  assert.throws(() => makeReport(0x100, []));
});

test("isValidReport follows the validity rules", () => {
  assert.ok(isValidReport(zeroReport()));
  assert.ok(isValidReport(bytes(0xff, 0, 4, 5, 6, 7, 8, 9)));
  assert.ok(!isValidReport(bytes(0, 1, 0, 0, 0, 0, 0, 0)));
  assert.ok(!isValidReport(bytes(0, 0, 0xa5, 0, 0, 0, 0, 0)));
  assert.ok(!isValidReport(bytes(0, 0, 0xe7, 0, 0, 0, 0, 0)));
  assert.ok(!isValidReport(bytes(0, 0, 4, 0, 0, 0, 0, 4)));
  assert.ok(!isValidReport(new Uint8Array(7)));
});

test("isZeroReport", () => {
  assert.ok(isZeroReport(zeroReport()));
  assert.ok(!isZeroReport(makeReport(0x02, [])));
});
