// On-screen keys and sticky modifiers (SPEC §7.5).

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
    collapsible: true,
    buttons: Array.from({ length: 12 }, (_, i) => key(`F${i + 1}`, K[`F${i + 1}`])),
  },
]);

export class StickyModifiers extends EventTarget {
  #mask = 0;

  get mask() {
    return this.#mask;
  }

  isActive(mod) {
    return (this.#mask & mod) !== 0;
  }

  toggle(mod) {
    this.#mask ^= mod;
    this.dispatchEvent(new Event("change"));
  }

  /** Return the active modifiers and turn them all off. */
  consume() {
    const mask = this.#mask;
    if (mask !== 0) {
      this.#mask = 0;
      this.dispatchEvent(new Event("change"));
    }
    return mask;
  }

  clear() {
    this.consume();
  }
}

/** Press a button's keys (plus extra modifiers), then release everything. */
export function buttonReports(button, extraMods = 0) {
  return [makeReport(button.mods | extraMods, button.keys), zeroReport()];
}
