# Step 10 — Web on-screen keys

**Depends on:** 08
**Spec:** §7.5

## Goal

Buttons for keys and combinations the client cannot capture or a phone keyboard
lacks, plus sticky modifiers for building any combination.

## Tasks

- [ ] `web/js/onscreen.js` with a data table of buttons (label, modifiers,
      usages), so adding a button is a one-line change.
- [ ] Buttons from SPEC §7.5:
  - [ ] Combinations: Ctrl+Alt+Del, Alt+Tab, Alt+F4, GUI, Ctrl+Alt+F1 … F7.
  - [ ] Keys: Esc, Tab, Enter, Backspace, Delete, Insert, Home, End, PgUp, PgDn,
        arrows, F1–F12, Print Screen.
  - [ ] Sticky modifiers: Ctrl, Shift, Alt, AltGr (Right Alt), GUI.
- [ ] Press behaviour: queue one report with all keys and active sticky
      modifiers, then `ZERO_REPORT`; then clear sticky modifiers.
- [ ] Sticky modifiers show an "on" state; tapping again turns one off.
- [ ] Arrow buttons repeat while held: first repeat after 400 ms, then every
      50 ms; stop on `pointerup`, `pointercancel`, `pointerleave`.
- [ ] Use pointer events so buttons work with mouse and touch; buttons have
      `touch-action: manipulation` to avoid double-tap zoom.
- [ ] Layout: grouped and collapsible (F-keys collapsed by default on phones);
      buttons at least 44×44 px on touch screens.
- [ ] The panel is visible in both live and compose mode.
- [ ] Unit tests: button table → reports; sticky modifiers are added once and then
      cleared.

## Done when

- Unit tests pass.
- From an Android phone: the Ctrl+Alt+F2 button switches the Linux VT; Sticky
  Ctrl, Sticky Alt, then the F3 button switches to VT3; holding the Down button
  scrolls a `less` page continuously and stops when released.
- From a Mac: the Ctrl+Alt+Del button reaches a Windows host's security screen.
