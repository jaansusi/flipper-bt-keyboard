// On-screen keys and modifiers (docs/web-client.md).

import { MOD } from "./constants.js";
import { CODE_TO_USAGE as K } from "./keymap.js";
import { makeReport, zeroReport } from "./report.js";

const key = (label, usage, extra = {}) => ({ label, mods: 0, keys: [usage], ...extra });
const combo = (label, mods, keys = []) => ({ label, mods, keys });

const CTRL_ALT = MOD.LCTRL | MOD.LALT;

export const STICKY_MODIFIERS = Object.freeze([
  { label: "Ctrl", mod: MOD.LCTRL },
  { label: "Shift", mod: MOD.LSHIFT },
  { label: "Alt", mod: MOD.LALT },
  { label: "AltGr", mod: MOD.RALT },
  { label: "Win/Cmd", mod: MOD.LGUI },
]);

export const KEY_GROUPS = Object.freeze([
  {
    id: "main",
    label: "Keys",
    buttons: [
      key("Esc", K.Escape),
      key("Tab", K.Tab),
      key("Enter", K.Enter),
      key("Bksp", K.Backspace, { repeat: true }),
      key("Del", K.Delete, { repeat: true }),
      key("Space", K.Space),
    ],
  },
  {
    id: "arrows",
    label: "Arrows",
    buttons: [
      key("←", K.ArrowLeft, { repeat: true, aria: "Left arrow" }),
      key("↑", K.ArrowUp, { repeat: true, aria: "Up arrow" }),
      key("↓", K.ArrowDown, { repeat: true, aria: "Down arrow" }),
      key("→", K.ArrowRight, { repeat: true, aria: "Right arrow" }),
    ],
  },
  {
    id: "nav",
    label: "Navigation",
    buttons: [
      key("Ins", K.Insert),
      key("Home", K.Home),
      key("End", K.End),
      key("PgUp", K.PageUp, { repeat: true }),
      key("PgDn", K.PageDown, { repeat: true }),
      key("PrtSc", K.PrintScreen),
    ],
  },
  {
    id: "combos",
    label: "Combinations",
    buttons: [
      combo("Ctrl+Alt+Del", CTRL_ALT, [K.Delete]),
      combo("Alt+Tab", MOD.LALT, [K.Tab]),
      combo("Alt+F4", MOD.LALT, [K.F4]),
      combo("Win", MOD.LGUI),
      ...Array.from({ length: 7 }, (_, i) => combo(`Ctrl+Alt+F${i + 1}`, CTRL_ALT, [K[`F${i + 1}`]])),
    ],
  },
  {
    id: "fkeys",
    label: "F1–F12",
    buttons: Array.from({ length: 12 }, (_, i) => key(`F${i + 1}`, K[`F${i + 1}`])),
  },
]);

export const ModifierMode = Object.freeze({ Off: "off", Once: "once", Held: "held" });

/**
 * Modifier buttons cycle Off → Once → Held → Off.
 * Once: added to the next key press, then turns off.
 * Held: stays pressed on the target until turned off.
 * Events: "change" whenever any modifier's mode changes.
 */
export class StickyModifiers extends EventTarget {
  #once = 0;
  #held = 0;

  /** Modifiers waiting for the next key. */
  get onceMask() {
    return this.#once;
  }

  /** Modifiers held down on the target. */
  get heldMask() {
    return this.#held;
  }

  mode(mod) {
    if (this.#held & mod) return ModifierMode.Held;
    if (this.#once & mod) return ModifierMode.Once;
    return ModifierMode.Off;
  }

  /** Advance one modifier to its next mode. @returns the new mode */
  cycle(mod) {
    if (this.#held & mod) {
      this.#held &= ~mod;
    } else if (this.#once & mod) {
      this.#once &= ~mod;
      this.#held |= mod;
    } else {
      this.#once |= mod;
    }
    this.dispatchEvent(new Event("change"));
    return this.mode(mod);
  }

  /** Return the once-modifiers and turn them off. Held modifiers stay. */
  consume() {
    const mask = this.#once;
    if (mask !== 0) {
      this.#once = 0;
      this.dispatchEvent(new Event("change"));
    }
    return mask;
  }

  /** Turn everything off (e.g. on disconnect). */
  clear() {
    if (this.#once === 0 && this.#held === 0) return;
    this.#once = 0;
    this.#held = 0;
    this.dispatchEvent(new Event("change"));
  }
}

/** Press a button's keys (plus extra modifiers), then release everything. */
export function buttonReports(button, extraMods = 0) {
  return [makeReport(button.mods | extraMods, button.keys), zeroReport()];
}

/** Add held modifiers to a report, so they stay pressed through every report. */
export function withHeld(report, heldMask) {
  if (heldMask === 0) return report;
  const copy = report.slice();
  copy[0] |= heldMask;
  return copy;
}
