// Ordered send queue (SPEC §7.3). Web Bluetooth allows one GATT operation at a time.

import { REPORT_SIZE } from "./constants.js";
import { zeroReport } from "./report.js";

export class SendQueue {
  #write;
  #onError;
  #items = [];
  #running = false;
  #idleWaiters = [];
  #generation = 0;

  /**
   * @param {(bytes: Uint8Array) => Promise<void>} write  sends one GATT write
   * @param {{ onError?: (error: Error) => void }} options
   */
  constructor(write, { onError } = {}) {
    this.#write = write;
    this.#onError = onError;
  }

  get pending() {
    return this.#items.length;
  }

  get busy() {
    return this.#running || this.#items.length > 0;
  }

  push(...reports) {
    this.#items.push(...reports);
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

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#items.length > 0) {
        // Two waiting reports share one 16-byte write (SPEC §4.4)
        const count = Math.min(2, this.#items.length);
        const batch = new Uint8Array(count * REPORT_SIZE);
        for (let i = 0; i < count; i++) batch.set(this.#items.shift(), i * REPORT_SIZE);
        await this.#writeWithRetry(batch);
      }
    } finally {
      this.#running = false;
      const waiters = this.#idleWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  }

  async #writeWithRetry(batch) {
    const generation = this.#generation;
    try {
      await this.#write(batch);
      return;
    } catch {
      // Cleared while the write was failing: nothing left to retry for.
      if (generation !== this.#generation) return;
    }
    try {
      await this.#write(batch);
    } catch (error) {
      // Second failure: give up on the queue and try to release all keys.
      this.#items.length = 0;
      this.#generation++;
      this.#onError?.(error);
      try {
        await this.#write(zeroReport());
      } catch {
        // Not connected any more; the Flipper releases keys on disconnect.
      }
    }
  }
}
