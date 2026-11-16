// Full-screen on-screen keyboard: layouts and held-key state (docs/web-client.md).
// Keys are physical keys, as on a USB keyboard: the target applies its own
// layout. Labels are those of a US keyboard.

import { MOD, REPORT_KEYS } from "./constants.js";
import { CODE_TO_USAGE } from "./keymap.js";
import { makeReport } from "./report.js";

// US labels: [unshifted, shifted]
const LABELS = {
  Backquote: ["`", "~"],
  Digit1: ["1", "!"],
  Digit2: ["2", "@"],
  Digit3: ["3", "#"],
  Digit4: ["4", "$"],
  Digit5: ["5", "%"],
  Digit6: ["6", "^"],
  Digit7: ["7", "&"],
  Digit8: ["8", "*"],
  Digit9: ["9", "("],
  Digit0: ["0", ")"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
};

const NAMED = {
  Escape: { label: "Esc" },
  Tab: { label: "Tab" },
  Enter: { label: "Enter", aria: "Enter" },
  Backspace: { label: "⌫", aria: "Backspace" },
  Delete: { label: "Del", aria: "Delete" },
  Space: { label: "", aria: "Space" },
  ArrowLeft: { label: "←", aria: "Left arrow" },
  ArrowUp: { label: "↑", aria: "Up arrow" },
  ArrowDown: { label: "↓", aria: "Down arrow" },
  ArrowRight: { label: "→", aria: "Right arrow" },
};

/** A key that sends one physical key. */
function key(code, width = 1) {
  if (!(code in CODE_TO_USAGE)) throw new Error(`unknown key code: ${code}`);
  const usage = CODE_TO_USAGE[code];
  if (code.startsWith("Key")) {
    const letter = code.slice(3).toLowerCase();
    return { type: "key", code, usage, width, label: letter, shiftLabel: letter.toUpperCase() };
  }
  if (code in LABELS) {
    const [label, shiftLabel] = LABELS[code];
    return { type: "key", code, usage, width, label, shiftLabel };
  }
  const { label, aria } = NAMED[code];
  return { type: "key", code, usage, width, label, shiftLabel: label, aria };
}

const keys = (codes) => codes.split(" ").map((code) => key(code));
const letters = (chars) => [...chars].map((c) => key(`Key${c.toUpperCase()}`));
const digits = () => [..."1234567890"].map((d) => key(`Digit${d}`));
const mod = (label, bit, width = 1) => ({ type: "mod", mod: bit, label, width });
const layer = (label, to, width = 1) => ({ type: "layer", to, label, width });
const gap = (width) => ({ type: "gap", width });

const bottomRow = (layerKey) => [
  layerKey,
  mod("Ctrl", MOD.LCTRL, 1.25),
  mod("Alt", MOD.LALT, 1.25),
  key("Space", 3),
  key("Tab", 1.25),
  key("Enter", 1.75),
];

/**
 * Compact layouts, for phones: letters, and a second page with digits,
 * symbols and arrows. Full layout: when the keyboard is at least
 * FULL_LAYOUT_MIN_WIDTH wide (tablets, landscape). Every row of a layout adds
 * up to the same width, in key units, so columns line up.
 */
export const KEYBOARD_LAYOUTS = Object.freeze({
  letters: [
    letters("qwertyuiop"),
    [gap(0.5), ...letters("asdfghjkl"), gap(0.5)],
    [mod("Shift", MOD.LSHIFT, 1.5), ...letters("zxcvbnm"), key("Backspace", 1.5)],
    bottomRow(layer("123", "symbols", 1.5)),
  ],
  symbols: [
    digits(),
    [key("Escape", 2), ...keys("Minus Equal BracketLeft BracketRight Backslash Semicolon Quote Backquote")],
    [
      mod("Shift", MOD.LSHIFT, 1.5),
      ...keys("Comma Period Slash ArrowLeft ArrowUp ArrowDown ArrowRight"),
      key("Backspace", 1.5),
    ],
    bottomRow(layer("abc", "letters", 1.5)),
  ],
  full: [
    [key("Backquote"), ...digits(), key("Minus"), key("Equal"), key("Backspace", 2)],
    [key("Tab", 1.5), ...letters("qwertyuiop"), key("BracketLeft"), key("BracketRight"), key("Backslash", 1.5)],
    // Esc where Caps Lock usually is
    [key("Escape", 1.75), ...letters("asdfghjkl"), key("Semicolon"), key("Quote"), key("Enter", 2.25)],
    [
      mod("Shift", MOD.LSHIFT, 2.25),
      ...letters("zxcvbnm"),
      ...keys("Comma Period Slash"),
      key("ArrowUp"),
      key("Delete", 1.75),
    ],
    [
      mod("Ctrl", MOD.LCTRL, 1.5),
      mod("Win", MOD.LGUI, 1.25),
      mod("Alt", MOD.LALT, 1.25),
      key("Space", 6.75),
      mod("AltGr", MOD.RALT, 1.25),
      ...keys("ArrowLeft ArrowDown ArrowRight"),
    ],
  ],
});

export const FULL_LAYOUT_MIN_WIDTH = 700;

/**
 * Keys held down on the screen, one per finger. Each key carries the
 * once-modifiers that were waiting when it went down, so Shift (once) + a
 * stays Shift+a until the a is released. Held modifiers are added by the
 * send queue.
 */
export class TouchKeys {
  #held = new Map(); // pointer id → { usage, mods }

  get isEmpty() {
    return this.#held.size === 0;
  }

  /** @returns {Uint8Array | null} the report to send, or null if nothing changed */
  down(id, usage, mods = 0) {
    if (this.#held.has(id)) return null;
    const usages = [...this.#held.values()].map((k) => k.usage);
    if (usages.includes(usage) || usages.length >= REPORT_KEYS) return null;
    this.#held.set(id, { usage, mods });
    return this.#report();
  }

  /** @returns {Uint8Array | null} */
  up(id) {
    if (!this.#held.delete(id)) return null;
    return this.#report();
  }

  /** @returns {Uint8Array | null} all-zero report, or null if nothing was held */
  releaseAll() {
    if (this.#held.size === 0) return null;
    this.#held.clear();
    return this.#report();
  }

  #report() {
    const held = [...this.#held.values()];
    const mods = held.reduce((mask, k) => mask | k.mods, 0);
    return makeReport(
      mods,
      held.map((k) => k.usage),
    );
  }
}
