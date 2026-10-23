import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonReports, KEY_GROUPS, StickyModifiers } from "../js/onscreen.js";
import { isValidReport, isZeroReport } from "../js/report.js";

const find = (label) => KEY_GROUPS.flatMap((g) => g.buttons).find((b) => b.label === label);
const hex = (r) => Buffer.from(r).toString("hex");

test("every button produces a valid press report followed by zero", () => {
  for (const button of KEY_GROUPS.flatMap((g) => g.buttons)) {
    const [press, release] = buttonReports(button);
    assert.ok(isValidReport(press), button.label);
    assert.ok(isZeroReport(release), button.label);
  }
});

test("combinations match SPEC §5.5", () => {
  assert.equal(hex(buttonReports(find("Ctrl+Alt+Del"))[0]), "05004c0000000000");
  assert.equal(hex(buttonReports(find("Ctrl+Alt+F2"))[0]), "05003b0000000000");
  assert.equal(hex(buttonReports(find("Win"))[0]), "0800000000000000");
});

test("sticky modifiers are added once and then cleared", () => {
  const sticky = new StickyModifiers();
  let changes = 0;
  sticky.addEventListener("change", () => changes++);
  sticky.toggle(0x01);
  sticky.toggle(0x04);
  assert.equal(hex(buttonReports(find("F3"), sticky.consume())[0]), "05003c0000000000");
  assert.equal(sticky.mask, 0);
  assert.equal(sticky.consume(), 0);
  assert.equal(changes, 3);
});

test("toggling a sticky modifier twice turns it off", () => {
  const sticky = new StickyModifiers();
  sticky.toggle(0x02);
  sticky.toggle(0x02);
  assert.equal(sticky.isActive(0x02), false);
});
