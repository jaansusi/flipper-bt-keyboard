# Step 02 — Flipper app skeleton and USB HID

**Depends on:** 01
**Spec:** §6.1, §6.2 steps 1–3, §6.6, §6.7 steps 2, 7–8

## Goal

The app switches the Flipper's USB port to a keyboard on start and restores it on
exit. The static screen and button handling are final. No Bluetooth yet.

## Tasks

- [ ] App context struct in `remote_keyboard.c`: GUI, view port, input event
      queue, `FuriHalUsbInterface* usb_prev`.
- [ ] Startup (SPEC §6.2 steps 1–3):
  - [ ] `usb_prev = furi_hal_usb_get_config()`.
  - [ ] `furi_hal_usb_unlock()`, then `furi_hal_usb_set_config(&usb_hid, NULL)`.
        If it returns `false`, show an error screen for 2 s and exit.
  - [ ] `furi_hal_hid_set_state_callback(...)` that sets a flag for the worker
        (used in step 06; for now it only records the state).
- [ ] Static screen with the text from SPEC §6.6. It shows nothing else.
- [ ] Input handling (SPEC §6.6):
  - [ ] Short Back → exit.
  - [ ] OK held ≥ 3 s → placeholder that shows "Paired devices forgotten" for 2 s
        (the real call is added in step 03). Use `InputTypeLong` plus a timer, or
        track press/release times; `InputTypeLong` alone fires after ~0.5 s, so
        it is not enough.
- [ ] Exit (SPEC §6.7, USB parts only): `furi_hal_hid_kb_release_all()`,
      `furi_hal_hid_set_state_callback(NULL, NULL)`,
      `furi_hal_usb_set_config(usb_prev, NULL)`.
- [ ] **Temporary debug build only:** behind `#ifdef RK_DEBUG_TYPE`, pressing Up
      types `a` (`furi_hal_hid_kb_press(HID_KEYBOARD_A)` then release). Remove in
      step 06.

## Done when

- Starting the app on a Flipper plugged into a Linux PC: `dmesg` shows a new USB
  HID keyboard, and `lsusb -v` shows interface subclass 1 (boot).
- In the debug build, pressing Up types `a` into a terminal on the PC.
- Pressing Back exits: the HID device disappears and qFlipper can connect to the
  Flipper over USB again.
- Holding OK for 3 s shows the placeholder message; a short OK press does nothing.
