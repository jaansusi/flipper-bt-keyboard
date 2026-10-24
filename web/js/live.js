// Live mode: forward physical key presses (docs/web-client.md).

import { MOD, REPORT_KEYS, TIMING } from "./constants.js";
import { CODE_TO_MOD, CODE_TO_USAGE, isKnownCode } from "./keymap.js";
import { makeReport, zeroReport } from "./report.js";

const GUI_BITS = MOD.LGUI | MOD.RGUI;

export function detectPlatform(nav = globalThis.navigator) {
  const name = nav?.userAgentData?.platform || nav?.platform || "";
  if (/mac/i.test(name)) return "mac";
  if (/win/i.test(name)) return "windows";
  return "other";
}

/** Keyboard state; no DOM access, so it can be unit-tested. */
export class LiveState {
  #platform;
  #mods = 0;
  #keys = [];
  #keysPressedDuringMeta = new Set();
  #ctrlLeftDownAt = null;
  #ignoreCtrlLeftUp = false;

  /** @param {{ platform?: "mac" | "windows" | "other" }} options */
  constructor({ platform = "other" } = {}) {
    this.#platform = platform;
  }

  get isEmpty() {
    return this.#mods === 0 && this.#keys.length === 0;
  }

  /** @returns {Uint8Array[]} reports to send, possibly none */
  keyDown(code, timeStamp = 0) {
    if (this.#platform === "mac" && code === "CapsLock") return this.#tapCapsLock();

    if (code in CODE_TO_MOD) {
      const bit = CODE_TO_MOD[code];
      if (code === "ControlLeft") this.#ctrlLeftDownAt = timeStamp;
      if (code === "AltRight" && this.#isFakeAltGrCtrl(timeStamp)) {
        // Windows sends a fake ControlLeft right before AltRight for AltGr
        this.#mods &= ~MOD.LCTRL;
        this.#ignoreCtrlLeftUp = true;
      } else if (this.#mods & bit) {
        return [];
      }
      this.#mods |= bit;
      return [this.#report()];
    }

    const usage = CODE_TO_USAGE[code];
    if (usage === undefined) return [];
    if (this.#keys.includes(usage) || this.#keys.length >= REPORT_KEYS) return [];
    this.#keys.push(usage);
    if (this.#platform === "mac" && this.#mods & GUI_BITS) this.#keysPressedDuringMeta.add(usage);
    return [this.#report()];
  }

  /** @returns {Uint8Array[]} reports to send, possibly none */
  keyUp(code) {
    if (this.#platform === "mac" && code === "CapsLock") return this.#tapCapsLock();

    if (code in CODE_TO_MOD) {
      if (code === "ControlLeft" && this.#ignoreCtrlLeftUp) {
        this.#ignoreCtrlLeftUp = false;
        return [];
      }
      const bit = CODE_TO_MOD[code];
      if (!(this.#mods & bit)) return [];
      this.#mods &= ~bit;
      // macOS fires no keyup for keys released while Cmd was held
      if (this.#platform === "mac" && bit & GUI_BITS && !(this.#mods & GUI_BITS)) {
        this.#keys = this.#keys.filter((usage) => !this.#keysPressedDuringMeta.has(usage));
        this.#keysPressedDuringMeta.clear();
      }
      return [this.#report()];
    }

    const usage = CODE_TO_USAGE[code];
    const index = this.#keys.indexOf(usage);
    if (index === -1) return [];
    this.#keys.splice(index, 1);
    this.#keysPressedDuringMeta.delete(usage);
    return [this.#report()];
  }

  /** Forget all held keys. @returns {Uint8Array[]} the all-zero report */
  releaseAll() {
    this.#mods = 0;
    this.#keys = [];
    this.#keysPressedDuringMeta.clear();
    this.#ignoreCtrlLeftUp = false;
    return [zeroReport()];
  }

  // macOS Chrome reports CapsLock toggling, not press/release: send a full tap
  #tapCapsLock() {
    if (this.#keys.length >= REPORT_KEYS) return [];
    const usage = CODE_TO_USAGE.CapsLock;
    return [makeReport(this.#mods, [...this.#keys, usage]), this.#report()];
  }

  #isFakeAltGrCtrl(timeStamp) {
    return (
      this.#platform === "windows" &&
      this.#mods & MOD.LCTRL &&
      this.#ctrlLeftDownAt !== null &&
      Math.abs(timeStamp - this.#ctrlLeftDownAt) <= TIMING.altGrWindow
    );
  }

  #report() {
    return makeReport(this.#mods, this.#keys);
  }
}

/**
 * Wire a focusable element to a LiveState.
 * @param {HTMLElement} element
 * @param {LiveState} state
 * @param {(reports: Uint8Array[]) => void} send
 */
export function attachLiveCapture(element, state, send) {
  const handle = (down) => (event) => {
    if (event.isComposing) return;
    if (!isKnownCode(event.code)) return;
    event.preventDefault();
    // The host auto-repeats held keys itself
    if (down && event.repeat) return;
    const reports = down ? state.keyDown(event.code, event.timeStamp) : state.keyUp(event.code);
    if (reports.length) send(reports);
  };
  const release = () => {
    if (!state.isEmpty) send(state.releaseAll());
  };

  element.addEventListener("keydown", handle(true));
  element.addEventListener("keyup", handle(false));
  element.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") release();
  });
  return { release };
}
