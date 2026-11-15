import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidMouseReport, makeMouseReport, zeroMouseReport } from "../js/mouse.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("encodes buttons and signed deltas", () => {
  assert.equal(hex(makeMouseReport({ buttons: 0x01, dx: 5, dy: -5, wheel: -1 })), "0105fbff");
  assert.equal(hex(makeMouseReport({ dx: 127, dy: -127 })), "007f8100");
  assert.equal(hex(zeroMouseReport()), "00000000");
});

test("rejects out-of-range values", () => {
  assert.throws(() => makeMouseReport({ dx: 128 }), RangeError);
  assert.throws(() => makeMouseReport({ wheel: -128 }), RangeError);
  assert.throws(() => makeMouseReport({ dy: 1.5 }), RangeError);
  assert.throws(() => makeMouseReport({ buttons: 0x08 }), RangeError);
});

test("validity mirrors the Flipper app", () => {
  assert.ok(isValidMouseReport(makeMouseReport({ buttons: 7, dx: -127, dy: 127, wheel: 1 })));
  assert.ok(!isValidMouseReport(Uint8Array.of(0x08, 0, 0, 0)));
  assert.ok(!isValidMouseReport(Uint8Array.of(0, 0x80, 0, 0)));
  assert.ok(!isValidMouseReport(Uint8Array.of(0, 0, 0, 0x80)));
  assert.ok(!isValidMouseReport(new Uint8Array(5)));
});
