// Identifiers and timing from SPEC §4.1 and §8.

export const SERVICE_UUID = "ff6ad5ee-6d0c-4067-9f0b-25935584962d";
export const KEY_REPORT_UUID = "82e449f4-1910-47dd-bb18-a697f0e81a9c";

export const REPORT_SIZE = 8;
export const REPORT_KEYS = 6;

// Modifier bits in byte 0 (SPEC §5.2)
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
});
