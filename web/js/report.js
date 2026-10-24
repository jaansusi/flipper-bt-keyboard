// Key reports (docs/bluetooth-protocol.md).

import { REPORT_KEYS, REPORT_SIZE } from "./constants.js";

export function zeroReport() {
  return new Uint8Array(REPORT_SIZE);
}

/** Usages allowed in bytes 2–7. */
export function isValidUsage(usage) {
  return Number.isInteger(usage) && usage >= 0x04 && usage <= 0xa4;
}

export function makeReport(mods = 0, keys = []) {
  if (!Number.isInteger(mods) || mods < 0 || mods > 0xff) {
    throw new RangeError(`invalid modifier mask: ${mods}`);
  }
  if (keys.length > REPORT_KEYS) {
    throw new RangeError(`at most ${REPORT_KEYS} keys, got ${keys.length}`);
  }
  const report = zeroReport();
  report[0] = mods;
  keys.forEach((usage, i) => {
    if (!isValidUsage(usage)) throw new RangeError(`invalid usage: ${usage}`);
    report[2 + i] = usage;
  });
  if (!isValidReport(report)) throw new RangeError("duplicate usage in report");
  return report;
}

/** Validity rules. Mirrors rk_report_is_valid() in the Flipper app. */
export function isValidReport(report) {
  if (report.length !== REPORT_SIZE || report[1] !== 0) return false;
  const seen = new Set();
  for (let i = 2; i < REPORT_SIZE; i++) {
    const usage = report[i];
    if (usage === 0) continue;
    if (!isValidUsage(usage) || seen.has(usage)) return false;
    seen.add(usage);
  }
  return true;
}

export function isZeroReport(report) {
  return report.every((b) => b === 0);
}
