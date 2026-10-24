// Compose mode: type text as key presses (docs/web-client.md).

import { TIMING } from "./constants.js";
import { makeReport, zeroReport } from "./report.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeText(text) {
  return text.normalize("NFC").replace(/\r\n?/g, "\n");
}

export function clampInterval(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return TIMING.composeIntervalDefault;
  return Math.min(TIMING.composeIntervalMax, Math.max(TIMING.composeIntervalMin, n));
}

/**
 * @returns {{ chars: { char: string, strokes: number[][] }[], skipped: number }}
 */
export function textToStrokes(text, layout) {
  const chars = [];
  let skipped = 0;
  for (const char of normalizeText(text)) {
    const strokes = layout.map[char];
    if (strokes) chars.push({ char, strokes });
    else skipped++;
  }
  return { chars, skipped };
}

export class ComposeSender {
  #queue;
  #stopped = false;
  #sending = false;

  /** @param {import("./queue.js").SendQueue} queue */
  constructor(queue) {
    this.#queue = queue;
  }

  get sending() {
    return this.#sending;
  }

  /**
   * @param {(sent: number, total: number) => void} onProgress
   * @returns {Promise<{ sent: number, total: number, skipped: number, stopped: boolean }>}
   */
  async send(text, layout, intervalMs, onProgress = () => {}) {
    if (this.#sending) throw new Error("already sending");
    const { chars, skipped } = textToStrokes(text, layout);
    const interval = clampInterval(intervalMs);
    this.#sending = true;
    this.#stopped = false;
    let sent = 0;
    try {
      for (const { strokes } of chars) {
        if (this.#stopped) break;
        for (const [mods, usage] of strokes) {
          this.#queue.push(makeReport(mods, [usage]), zeroReport());
        }
        await this.#queue.whenIdle();
        if (this.#stopped) break;
        sent++;
        onProgress(sent, chars.length);
        if (sent < chars.length) await sleep(interval);
      }
    } finally {
      this.#sending = false;
    }
    return { sent, total: chars.length, skipped, stopped: this.#stopped };
  }

  /** Stop typing, drop queued reports and release all keys. */
  stop({ release = true } = {}) {
    if (!this.#sending) return;
    this.#stopped = true;
    this.#queue.clear();
    if (release) this.#queue.push(zeroReport());
  }
}
