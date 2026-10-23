# Step 09 — Web live mode

**Depends on:** 08
**Spec:** §7.4, Appendix A

## Goal

Typing on the laptop's keyboard types on the server, with keys pressed and
released exactly as on the laptop.

## Modules

| File | Content |
|---|---|
| `web/js/keymap.js` | `CODE_TO_MOD` and `CODE_TO_USAGE` from SPEC Appendix A |
| `web/js/live.js` | `LiveState` (pure, testable) and DOM event wiring |

## Tasks

- [ ] `keymap.js`: transcribe Appendix A completely. Generate ranges (`KeyA`–`KeyZ`,
      `Digit1`–`Digit9`, `F1`–`F24`, `Numpad1`–`Numpad9`) in code, list the rest
      explicitly.
- [ ] `LiveState` class, no DOM access:
  - [ ] `keyDown(code, timeStamp)` / `keyUp(code, timeStamp)` → report or `null`
        if nothing changed.
  - [ ] Max 6 held keys; a 7th is ignored.
  - [ ] `releaseAll()` → `ZERO_REPORT`.
  - [ ] Platform quirks (SPEC §7.4), selected by a `platform` option:
    - [ ] macOS CapsLock: either event → returns press and release reports.
    - [ ] macOS Cmd: releasing `MetaLeft`/`MetaRight` also releases keys pressed
          while it was held.
    - [ ] Windows AltGr: `ControlLeft` down followed by `AltRight` down within
          2 ms → drop the Left Ctrl bit; ignore the matching `ControlLeft` up.
- [ ] DOM wiring:
  - [ ] A focusable capture area (`tabindex="0"`) with clear "click here and
        type" text and a visible focused state.
  - [ ] `keydown`/`keyup`: ignore `isComposing`, empty/`Unidentified`/unknown
        codes, and `repeat`; `preventDefault()`; push reports to the queue.
  - [ ] `blur`, `visibilitychange` to hidden, mode switch, disconnect → `releaseAll`.
  - [ ] Platform detection: `navigator.userAgentData?.platform` with a
        `navigator.platform` fallback.
- [ ] Fullscreen + Keyboard Lock button (desktop Chrome/Edge only; hide if
      `navigator.keyboard?.lock` is missing). Exit with a long Esc press, as
      Chrome shows.
- [ ] Unit tests for `LiveState`: simple key; Shift+key; 7 keys; repeat ignored;
      releaseAll; each quirk; unknown code ignored.

## Done when

- Unit tests pass.
- From a Mac with Chrome to a Linux TTY: normal typing, Shift capitals, holding
  an arrow auto-repeats, Ctrl+C interrupts a running `sleep 100`.
- Holding a key and switching browser tab releases it on the host.
- From Windows with Edge and an Estonian layout on both sides: `õ ä ö ü` and
  AltGr characters (e.g. `@` = AltGr+2) come out right, with no stray Ctrl.
- In fullscreen with Keyboard Lock, Alt+Tab and the Windows key go to the host.
