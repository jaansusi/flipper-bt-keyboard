# Step 08 — Web client core

**Depends on:** 04 (pairing approach confirmed)
**Spec:** §7.1, §7.2, §7.3, §7.7

## Goal

The page's skeleton: feature detection, connect/pair/reconnect, and the send queue
that every mode uses. After this step, the page can connect and send arbitrary
reports from code.

## Modules

| File | Content |
|---|---|
| `web/js/constants.js` | UUIDs, timing constants from SPEC §8 |
| `web/js/report.js` | `makeReport(mods, keys[])` → `Uint8Array(8)`, `ZERO_REPORT`, validation mirroring SPEC §5.3 |
| `web/js/ble.js` | Feature detection, `connect()`, `reconnect()`, `write(bytes)`, disconnect event |
| `web/js/queue.js` | `SendQueue`: `push(report)`, `clear()`, `pending`, pairs reports into 16-byte writes |
| `web/js/ui.js` | Status line, mode switch (Live / Compose), panels |
| `web/js/main.js` | Wires it all together |

## Tasks

- [ ] **Feature detection** (SPEC §7.1): if `navigator.bluetooth` is missing or
      `getAvailability()` is `false`, show the "browser not supported" panel with
      the supported browsers, and hide the connect button.
- [ ] **Connect** (SPEC §7.2) using the approach confirmed in step 04, including
      the zero-report write and the single retry.
- [ ] **Disconnect**: listen for `gattserverdisconnected`; clear the queue; show
      "Disconnected" and a Reconnect button that reuses the same
      `BluetoothDevice`.
- [ ] **Send queue** (SPEC §7.3):
  - [ ] One write at a time with `writeValueWithResponse`, awaited.
  - [ ] If ≥ 2 reports are waiting, send the first two as one 16-byte write.
  - [ ] Never drop, merge or reorder.
  - [ ] On write failure: retry once; if it fails again, clear the queue and push
        `ZERO_REPORT`.
  - [ ] Expose an `onIdle` promise for compose mode (step 11).
- [ ] **Status** (SPEC §7.7): connection state only; no claim that keys arrived.
- [ ] Layout: works from 320 px phone width to desktop; status bar at top, mode
      panel below.
- [ ] Unit tests (`web/test/`, `node --test`): `makeReport`, report validation,
      and `SendQueue` with a fake `write` function (ordering, pairing into 16
      bytes, retry, clear-on-failure).

## Done when

- Unit tests pass.
- In Chrome on a Mac, the page connects to the Flipper, and calling
  `window.rk.send([0, 0, 4, 0, 0, 0, 0, 0])` then the zero report from the
  devtools console types `a` on the host. (`window.rk` is a debug hook, removed
  in step 12.)
- Turning the Flipper app off shows "Disconnected"; restarting it and clicking
  Reconnect works without the device chooser.
- Opening the page in Safari shows the "not supported" panel.
