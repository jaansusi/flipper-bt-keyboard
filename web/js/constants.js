// Identifiers and timing (docs/bluetooth-protocol.md).

export const SERVICE_UUID = "ff6ad5ee-6d0c-4067-9f0b-25935584962d";
export const KEY_REPORT_UUID = "82e449f4-1910-47dd-bb18-a697f0e81a9c";
export const MOUSE_REPORT_UUID = "7be859e1-5cfe-4b84-850b-7b31e99b19f2";

export const REPORT_SIZE = 8;
export const REPORT_KEYS = 6;

export const MOUSE_REPORT_SIZE = 4;
export const MOUSE_DELTA_MAX = 127;

// Button bits in byte 0 of a mouse report
export const MOUSE_BUTTON = Object.freeze({
  LEFT: 0x01,
  RIGHT: 0x02,
  MIDDLE: 0x04,
});

// Modifier bits in byte 0
export const MOD = Object.freeze({
  LCTRL: 0x01,
  LSHIFT: 0x02,
  LALT: 0x04,
  LGUI: 0x08,
  RCTRL: 0x10,
  RSHIFT: 0x20,
  RALT: 0x40,
  RGUI: 0x80,
});

export const TIMING = Object.freeze({
  composeIntervalDefault: 20,
  composeIntervalMin: 16,
  composeIntervalMax: 1000,
  repeatDelay: 400,
  repeatInterval: 50,
  pairingRetryDelay: 3000,
  altGrWindow: 2,
  // Trackpad gestures (docs/web-client.md)
  tapMaxDuration: 250,
  dragWindow: 300,
});

export const TRACKPAD = Object.freeze({
  tapMaxTravel: 10, // CSS px a tap may move
  scrollStep: 20, // CSS px of two-finger travel per wheel step
  speedDefault: 2,
  speedMin: 0.5,
  speedMax: 5,
});
