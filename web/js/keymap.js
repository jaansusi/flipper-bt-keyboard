// KeyboardEvent.code → HID usage (USB HID Usage Tables, Keyboard/Keypad page).

import { MOD } from "./constants.js";

export const CODE_TO_MOD = Object.freeze({
  ControlLeft: MOD.LCTRL,
  ShiftLeft: MOD.LSHIFT,
  AltLeft: MOD.LALT,
  MetaLeft: MOD.LGUI,
  ControlRight: MOD.RCTRL,
  ShiftRight: MOD.RSHIFT,
  AltRight: MOD.RALT,
  MetaRight: MOD.RGUI,
});

function buildUsageMap() {
  const map = {};
  const range = (prefix, names, first) =>
    names.forEach((name, i) => (map[`${prefix}${name}`] = first + i));

  range("Key", [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 0x04);
  range("Digit", [..."123456789"], 0x1e);
  map.Digit0 = 0x27;
  range("F", Array.from({ length: 12 }, (_, i) => i + 1), 0x3a);
  range("F", Array.from({ length: 12 }, (_, i) => i + 13), 0x68);
  range("Numpad", [..."123456789"], 0x59);
  map.Numpad0 = 0x62;

  Object.assign(map, {
    Enter: 0x28,
    Escape: 0x29,
    Backspace: 0x2a,
    Tab: 0x2b,
    Space: 0x2c,
    Minus: 0x2d,
    Equal: 0x2e,
    BracketLeft: 0x2f,
    BracketRight: 0x30,
    Backslash: 0x31,
    Semicolon: 0x33,
    Quote: 0x34,
    Backquote: 0x35,
    Comma: 0x36,
    Period: 0x37,
    Slash: 0x38,
    CapsLock: 0x39,
    PrintScreen: 0x46,
    ScrollLock: 0x47,
    Pause: 0x48,
    Insert: 0x49,
    Home: 0x4a,
    PageUp: 0x4b,
    Delete: 0x4c,
    End: 0x4d,
    PageDown: 0x4e,
    ArrowRight: 0x4f,
    ArrowLeft: 0x50,
    ArrowDown: 0x51,
    ArrowUp: 0x52,
    NumLock: 0x53,
    NumpadDivide: 0x54,
    NumpadMultiply: 0x55,
    NumpadSubtract: 0x56,
    NumpadAdd: 0x57,
    NumpadEnter: 0x58,
    NumpadDecimal: 0x63,
    IntlBackslash: 0x64,
    ContextMenu: 0x65,
    NumpadEqual: 0x67,
    IntlRo: 0x87,
    KanaMode: 0x88,
    IntlYen: 0x89,
    Convert: 0x8a,
    NonConvert: 0x8b,
  });
  return Object.freeze(map);
}

export const CODE_TO_USAGE = buildUsageMap();

export function isKnownCode(code) {
  return code in CODE_TO_MOD || code in CODE_TO_USAGE;
}
