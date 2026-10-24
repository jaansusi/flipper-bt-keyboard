import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonReports, KEY_GROUPS, ModifierMode, StickyModifiers, withHeld } from "../js/onscreen.js";
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

test("modifiers cycle off → once → held → off", () => {
  const sticky = new StickyModifiers();
  let changes = 0;
  sticky.addEventListener("change", () => changes++);
  assert.equal(sticky.cycle(0x04), ModifierMode.Once);
  assert.equal(sticky.onceMask, 0x04);
  assert.equal(sticky.cycle(0x04), ModifierMode.Held);
  assert.equal(sticky.onceMask, 0);
  assert.equal(sticky.heldMask, 0x04);
  assert.equal(sticky.cycle(0x04), ModifierMode.Off);
  assert.equal(sticky.heldMask, 0);
  assert.equal(changes, 3);
});

test("once-modifiers are added to the next key only", () => {
  const sticky = new StickyModifiers();
  sticky.cycle(0x01);
  sticky.cycle(0x04);
  assert.equal(hex(buttonReports(find("F3"), sticky.consume())[0]), "05003c0000000000");
  assert.equal(sticky.onceMask, 0);
  assert.equal(sticky.consume(), 0);
});

test("held modifiers survive consume() and are cleared by clear()", () => {
  const sticky = new StickyModifiers();
  sticky.cycle(0x04);
  sticky.cycle(0x04); // Alt held
  sticky.cycle(0x01); // Ctrl once
  assert.equal(sticky.consume(), 0x01);
  assert.equal(sticky.mode(0x04), ModifierMode.Held);
  sticky.clear();
  assert.equal(sticky.heldMask, 0);
  assert.equal(sticky.mode(0x04), ModifierMode.Off);
});

test("withHeld keeps Alt pressed through Tab taps (Alt+Tab switching)", () => {
  const [press, release] = buttonReports(find("Tab")).map((r) => withHeld(r, 0x04));
  assert.equal(hex(press), "04002b0000000000");
  assert.equal(hex(release), "0400000000000000");
});

test("withHeld leaves reports unchanged when nothing is held", () => {
  const [press] = buttonReports(find("Tab"));
  assert.equal(withHeld(press, 0), press);
});
