import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYBOARD_LAYOUTS, TouchKeys } from "../js/keyboard.js";
import { isValidUsage } from "../js/report.js";

const hex = (r) => Buffer.from(r).toString("hex");

test("every key has a valid usage and every row of a layout has the same width", () => {
  for (const [name, rows] of Object.entries(KEYBOARD_LAYOUTS)) {
    const widths = rows.map((row) => row.reduce((sum, k) => sum + k.width, 0));
    assert.ok(
      widths.every((w) => w === widths[0]),
      `${name}: ${widths}`,
    );
    for (const k of rows.flat().filter((k) => k.type === "key")) {
      assert.ok(isValidUsage(k.usage), `${name}: ${k.code}`);
    }
  }
});

test("pages link to each other", () => {
  const layers = (name) => KEYBOARD_LAYOUTS[name].flat().filter((k) => k.type === "layer");
  assert.deepEqual(
    layers("letters").map((k) => k.to),
    ["symbols"],
  );
  assert.deepEqual(
    layers("symbols").map((k) => k.to),
    ["letters"],
  );
  assert.equal(layers("full").length, 0);
});

test("labels are US: shifted digits and letters", () => {
  const all = Object.values(KEYBOARD_LAYOUTS).flat(2);
  const find = (code) => all.find((k) => k.code === code);
  assert.equal(find("Digit2").shiftLabel, "@");
  assert.equal(find("KeyQ").label, "q");
  assert.equal(find("KeyQ").shiftLabel, "Q");
});

test("a key is held while the finger is down; once-modifiers stay with it", () => {
  const keys = new TouchKeys();
  assert.equal(hex(keys.down(1, 0x04, 0x02)), "0200040000000000"); // Shift (once) + a
  assert.equal(hex(keys.down(2, 0x05)), "0200040500000000"); // b while a is held
  assert.equal(hex(keys.up(1)), "0000050000000000");
  assert.equal(hex(keys.up(2)), "0000000000000000");
  assert.equal(keys.isEmpty, true);
});

test("the same key twice, unknown pointers and a seventh key change nothing", () => {
  const keys = new TouchKeys();
  keys.down(1, 0x04);
  assert.equal(keys.down(2, 0x04), null);
  assert.equal(keys.up(2), null);
  assert.equal(keys.down(1, 0x05), null);
  for (let i = 0; i < 5; i++) keys.down(10 + i, 0x05 + i);
  assert.equal(keys.down(20, 0x20), null);
  assert.equal(hex(keys.releaseAll()), "0000000000000000");
  assert.equal(keys.releaseAll(), null);
});
