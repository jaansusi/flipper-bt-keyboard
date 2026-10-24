// Web Bluetooth connection to the Flipper (docs/web-client.md).

import { KEY_REPORT_UUID, SERVICE_UUID, TIMING } from "./constants.js";
import { zeroReport } from "./report.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function bluetoothSupported() {
  if (!("bluetooth" in navigator)) return false;
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return false;
  }
}

/**
 * Events:
 *   "statechange" — `state` is "disconnected", "connecting" or "connected"
 */
export class FlipperConnection extends EventTarget {
  #device = null;
  #characteristic = null;
  #state = "disconnected";

  get state() {
    return this.#state;
  }

  get connected() {
    return this.#state === "connected";
  }

  /** True once a device has been chosen, so reconnect() needs no chooser. */
  get hasDevice() {
    return this.#device !== null;
  }

  get deviceName() {
    return this.#device?.name ?? null;
  }

  /** Show the device chooser and connect. Must be called from a user gesture. */
  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });
    if (device !== this.#device) {
      this.#device?.removeEventListener("gattserverdisconnected", this.#onDisconnected);
      this.#device = device;
      device.addEventListener("gattserverdisconnected", this.#onDisconnected);
    }
    await this.#setup();
  }

  /** Reconnect to the device chosen earlier, without the chooser. */
  async reconnect() {
    if (!this.#device) return this.connect();
    await this.#setup();
  }

  disconnect() {
    this.#device?.gatt.disconnect();
  }

  async write(bytes) {
    if (!this.connected) throw new Error("Not connected");
    await this.#characteristic.writeValueWithResponse(bytes);
  }

  async #setup() {
    this.#setState("connecting");
    try {
      await this.#openCharacteristic();
      await this.#firstWrite();
      this.#setState("connected");
    } catch (error) {
      this.#characteristic = null;
      if (this.#device?.gatt.connected) this.#device.gatt.disconnect();
      this.#setState("disconnected");
      throw error;
    }
  }

  async #openCharacteristic() {
    const server = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.#characteristic = await service.getCharacteristic(KEY_REPORT_UUID);
  }

  // The Flipper requests pairing on connect; if the OS has not finished pairing
  // yet, this write fails with an authentication error. Retry once.
  async #firstWrite() {
    try {
      await this.#characteristic.writeValueWithResponse(zeroReport());
      return;
    } catch {
      await sleep(TIMING.pairingRetryDelay);
    }
    if (!this.#device.gatt.connected) await this.#openCharacteristic();
    await this.#characteristic.writeValueWithResponse(zeroReport());
  }

  #onDisconnected = () => {
    this.#characteristic = null;
    this.#setState("disconnected");
  };

  #setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
