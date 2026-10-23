import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, LiveState } from "../js/live.js";
import { CODE_TO_USAGE } from "../js/keymap.js";

const hex = (reports) => reports.map((r) => Buffer.from(r).toString("hex"));
const R = (mods, ...keys) => {
  const b = [mods, 0, ...keys];
  while (b.length < 8) b.push(0);
  return Buffer.from(b).toString("hex");
};

test("simple key press and release", () => {
  const s = new LiveState();
  assert.deepEqual(hex(s.keyDown("KeyA")), [R(0, 0x04)]);
  assert.deepEqual(hex(s.keyUp("KeyA")), [R(0)]);
  assert.ok(s.isEmpty);
});

test("Shift + key", () => {
  const s = new LiveState();
  assert.deepEqual(hex(s.keyDown("ShiftLeft")), [R(0x02)]);
  assert.deepEqual(hex(s.keyDown("KeyX")), [R(0x02, 0x1b)]);
  assert.deepEqual(hex(s.keyUp("KeyX")), [R(0x02)]);
  assert.deepEqual(hex(s.keyUp("ShiftLeft")), [R(0)]);
});

test("a 7th held key is ignored; duplicates produce nothing", () => {
  const s = new LiveState();
  for (const code of ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF"]) s.keyDown(code);
  assert.deepEqual(s.keyDown("KeyG"), []);
  assert.deepEqual(s.keyDown("KeyA"), []);
  assert.deepEqual(s.keyUp("KeyG"), []);
});

test("unknown codes are ignored", () => {
  const s = new LiveState();
  assert.deepEqual(s.keyDown("Fn"), []);
  assert.deepEqual(s.keyUp("Unidentified"), []);
});

test("releaseAll returns zero and resets state", () => {
  const s = new LiveState();
  s.keyDown("ControlLeft");
  s.keyDown("KeyC");
  assert.deepEqual(hex(s.releaseAll()), [R(0)]);
  assert.ok(s.isEmpty);
  assert.deepEqual(s.keyUp("KeyC"), []);
});

test("macOS CapsLock: either event sends a full tap", () => {
  const s = new LiveState({ platform: "mac" });
  assert.deepEqual(hex(s.keyDown("CapsLock")), [R(0, 0x39), R(0)]);
  assert.deepEqual(hex(s.keyUp("CapsLock")), [R(0, 0x39), R(0)]);
});

test("non-mac CapsLock behaves like any key", () => {
  const s = new LiveState({ platform: "windows" });
  assert.deepEqual(hex(s.keyDown("CapsLock")), [R(0, 0x39)]);
  assert.deepEqual(hex(s.keyUp("CapsLock")), [R(0)]);
});

test("macOS: releasing Cmd releases keys pressed while it was held", () => {
  const s = new LiveState({ platform: "mac" });
  s.keyDown("KeyA"); // held before Cmd: must stay
  s.keyDown("MetaLeft");
  s.keyDown("KeyC"); // keyup never arrives on macOS
  assert.deepEqual(hex(s.keyUp("MetaLeft")), [R(0, 0x04)]);
  assert.deepEqual(hex(s.keyUp("KeyA")), [R(0)]);
});

test("Windows AltGr: fake ControlLeft is removed", () => {
  const s = new LiveState({ platform: "windows" });
  assert.deepEqual(hex(s.keyDown("ControlLeft", 100.0)), [R(0x01)]);
  assert.deepEqual(hex(s.keyDown("AltRight", 100.5)), [R(0x40)]);
  assert.deepEqual(hex(s.keyDown("Digit2", 150)), [R(0x40, 0x1f)]);
  assert.deepEqual(hex(s.keyUp("Digit2")), [R(0x40)]);
  assert.deepEqual(s.keyUp("ControlLeft"), []);
  assert.deepEqual(hex(s.keyUp("AltRight")), [R(0)]);
});

test("Windows: real Ctrl then AltRight later keeps Ctrl", () => {
  const s = new LiveState({ platform: "windows" });
  s.keyDown("ControlLeft", 100);
  assert.deepEqual(hex(s.keyDown("AltRight", 400)), [R(0x41)]);
});

test("keymap covers SPEC Appendix A ranges", () => {
  assert.equal(CODE_TO_USAGE.KeyZ, 0x1d);
  assert.equal(CODE_TO_USAGE.Digit0, 0x27);
  assert.equal(CODE_TO_USAGE.F12, 0x45);
  assert.equal(CODE_TO_USAGE.F13, 0x68);
  assert.equal(CODE_TO_USAGE.F24, 0x73);
  assert.equal(CODE_TO_USAGE.Numpad0, 0x62);
  assert.equal(CODE_TO_USAGE.Numpad9, 0x61);
  assert.equal(CODE_TO_USAGE.IntlBackslash, 0x64);
  for (const usage of Object.values(CODE_TO_USAGE)) {
    assert.ok(usage >= 0x04 && usage <= 0xa4, `usage ${usage} out of range`);
  }
});

test("detectPlatform", () => {
  assert.equal(detectPlatform({ userAgentData: { platform: "macOS" } }), "mac");
  assert.equal(detectPlatform({ platform: "Win32" }), "windows");
  assert.equal(detectPlatform({ platform: "Linux x86_64" }), "other");
  assert.equal(detectPlatform({}), "other");
});
