// Ordered send queue (docs/web-client.md). Web Bluetooth allows one GATT operation at a time.

import { MOUSE_DELTA_MAX, REPORT_SIZE } from "./constants.js";
import { makeMouseReport, zeroMouseReport } from "./mouse.js";
import { zeroReport } from "./report.js";

const AXES = ["dx", "dy", "wheel"];

const clamp = (value) => Math.max(-MOUSE_DELTA_MAX, Math.min(MOUSE_DELTA_MAX, value));

export class SendQueue {
  #write;
  #onError;
  #transform;
  // { channel: "key", report } or { channel: "mouse", buttons, dx, dy, wheel }
  #items = [];
  #running = false;
  #idleWaiters = [];
  #generation = 0;
  #mouseUsed = false;

  /**
   * @param {(bytes: Uint8Array, channel: "key" | "mouse") => Promise<void>} write
   *   sends one GATT write to the Key Report or Mouse Report characteristic
   * @param {{
   *   onError?: (error: Error) => void,
   *   transform?: (report: Uint8Array) => Uint8Array,
   * }} options  transform is applied to every key report when it is pushed
   */
  constructor(write, { onError, transform = (report) => report } = {}) {
    this.#write = write;
    this.#onError = onError;
    this.#transform = transform;
  }

  get pending() {
    return this.#items.length;
  }

  get busy() {
    return this.#running || this.#items.length > 0;
  }

  /** Queue key reports. Never merged or dropped. */
  push(...reports) {
    for (const report of reports) this.#items.push({ channel: "key", report: this.#transform(report) });
    this.#pump();
  }

  /**
   * Queue a mouse state: buttons held, plus movement since the last one.
   * Movement is added to the last waiting mouse report if it has the same
   * buttons, as far as it fits in -127..127; the rest goes in new reports. So
   * movement is never lost or reordered, but piles up into few writes while
   * the link is busy. A change of buttons always starts a new report.
   */
  pushMouse({ buttons = 0, dx = 0, dy = 0, wheel = 0 }) {
    const rest = { dx, dy, wheel };
    const last = this.#items.at(-1);
    let item = last?.channel === "mouse" && last.buttons === buttons ? last : null;
    if (item === null) {
      item = this.#newMouseItem(buttons);
    }
    for (;;) {
      for (const axis of AXES) {
        const taken = clamp(item[axis] + rest[axis]) - item[axis];
        item[axis] += taken;
        rest[axis] -= taken;
      }
      if (AXES.every((axis) => rest[axis] === 0)) break;
      item = this.#newMouseItem(buttons);
    }
    this.#pump();
  }

  /** Drop everything not yet written. A write already in flight completes. */
  clear() {
    this.#items.length = 0;
    this.#generation++;
  }

  /** Resolves once every queued report has been written (or dropped). */
  whenIdle() {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #newMouseItem(buttons) {
    const item = { channel: "mouse", buttons, dx: 0, dy: 0, wheel: 0 };
    this.#items.push(item);
    return item;
  }

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#items.length > 0) {
        const item = this.#items.shift();
        if (item.channel === "mouse") {
          this.#mouseUsed = true;
          await this.#writeWithRetry(makeMouseReport(item), "mouse");
          continue;
        }
        // Two waiting key reports share one 16-byte write
        const reports = [item.report];
        if (this.#items[0]?.channel === "key") reports.push(this.#items.shift().report);
        const batch = new Uint8Array(reports.length * REPORT_SIZE);
        reports.forEach((report, i) => batch.set(report, i * REPORT_SIZE));
        await this.#writeWithRetry(batch, "key");
      }
    } finally {
      this.#running = false;
      const waiters = this.#idleWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  }

  async #writeWithRetry(bytes, channel) {
    const generation = this.#generation;
    try {
      await this.#write(bytes, channel);
      return;
    } catch {
      // Cleared while the write was failing: nothing left to retry for.
      if (generation !== this.#generation) return;
    }
    try {
      await this.#write(bytes, channel);
    } catch (error) {
      // Second failure: give up on the queue and try to release everything.
      this.#items.length = 0;
      this.#generation++;
      this.#onError?.(error);
      await this.#releaseAll();
    }
  }

  async #releaseAll() {
    const releases = [[zeroReport(), "key"]];
    if (this.#mouseUsed) releases.push([zeroMouseReport(), "mouse"]);
    for (const [bytes, channel] of releases) {
      try {
        await this.#write(bytes, channel);
      } catch {
        // Not connected any more; the Flipper releases everything on disconnect.
      }
    }
  }
}
