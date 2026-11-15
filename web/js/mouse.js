// Mouse reports (docs/bluetooth-protocol.md).

import { MOUSE_BUTTON, MOUSE_DELTA_MAX, MOUSE_REPORT_SIZE } from "./constants.js";

const BUTTONS_MASK = MOUSE_BUTTON.LEFT | MOUSE_BUTTON.RIGHT | MOUSE_BUTTON.MIDDLE;

const isDelta = (value) => Number.isInteger(value) && Math.abs(value) <= MOUSE_DELTA_MAX;

/** @returns {Uint8Array} 4 bytes: buttons, dx, dy, wheel (signed) */
export function makeMouseReport({ buttons = 0, dx = 0, dy = 0, wheel = 0 } = {}) {
  if (!Number.isInteger(buttons) || buttons & ~BUTTONS_MASK) {
    throw new RangeError(`invalid mouse buttons: ${buttons}`);
  }
  for (const value of [dx, dy, wheel]) {
    if (!isDelta(value)) throw new RangeError(`invalid mouse delta: ${value}`);
  }
  return Uint8Array.of(buttons, dx & 0xff, dy & 0xff, wheel & 0xff);
}

export function zeroMouseReport() {
  return new Uint8Array(MOUSE_REPORT_SIZE);
}

/** Validity rules. Mirrors rk_mouse_write_is_valid() in the Flipper app. */
export function isValidMouseReport(report) {
  if (report.length !== MOUSE_REPORT_SIZE || report[0] & ~BUTTONS_MASK) return false;
  // -128 is outside the USB mouse's range of -127..127
  return report[1] !== 0x80 && report[2] !== 0x80 && report[3] !== 0x80;
}
