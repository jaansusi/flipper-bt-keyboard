# Step 06 — Flipper receive and apply pipeline

**Depends on:** 03, 05
**Spec:** §6.3.1, §6.3.2, §6.4, §6.5, §6.8

## Goal

Writes received over Bluetooth are validated, queued, and typed on the host with
correct ordering, timing, and key release on disconnect. After this step the
Flipper app is feature-complete.

## Tasks

### Receive path (Bluetooth thread)

- [ ] Replace the debug counter from step 03 with the real RX callback:
  - [ ] `rk_write_is_valid(data, len)`; on failure return (whole write dropped).
  - [ ] `furi_message_queue_put(queue, report, 0)` for each 8-byte report; on
        failure stop processing the rest of the write.
- [ ] Queue: `furi_message_queue_alloc(512, sizeof(RkReport))`.
- [ ] The callback MUST NOT call `furi_hal_hid_*`, take a mutex held by the
      worker, or block.

### Apply path (`rk_worker.c`, own thread)

- [ ] Worker thread with a stack of 1 KB (increase if `furi_thread` reports stack
      overflow in debug builds).
- [ ] Loop: `furi_message_queue_get(queue, &next, timeout)`; check a stop flag.
- [ ] Drop reports while `furi_hal_hid_is_connected()` is false.
- [ ] Apply with `rk_report_diff` and map each action to `furi_hal_hid_kb_press`
      / `furi_hal_hid_kb_release` (modifiers shifted left by 8).
- [ ] If any call returned `false` while the host is connected, re-send with
      `furi_hal_hid_kb_press(HID_KEYBOARD_NONE)` until it returns `true` or 50 ms
      have passed.
- [ ] Make each report last at least 8 ms: record `furi_get_tick()` before
      applying, then `furi_delay_ms` for the remainder before taking the next.
- [ ] `current = next` after applying.

### Disconnect and host events

- [ ] Status callback: on a change from `BtStatusConnected` to anything else, send
      a "client disconnected" event to the worker. The worker resets the queue,
      calls `furi_hal_hid_kb_release_all()` and zeroes `current` (SPEC §6.4).
- [ ] HID state callback: on host disconnect, send a "host disconnected" event;
      the worker resets the queue and zeroes `current` (SPEC §6.5).
- [ ] Use a separate small event queue or thread flags for these events, so they
      are not stuck behind 512 queued reports.

### Exit

- [ ] Stop the worker before the Bluetooth and USB teardown (SPEC §6.7 step 1).

### Clean-up

- [ ] Remove the `RK_DEBUG_TYPE` code from step 02 and the counter from step 03.
- [ ] Check that no log line prints report bytes (SPEC §6.8).

## Done when

Using nRF Connect (or `bluetoothctl`) to write hex values from a paired phone:

- `00 00 04 00 00 00 00 00` then `00 00 00 00 00 00 00 00` types `a` on the host.
- `05 00 4C 00 00 00 00 00` sends Ctrl+Alt+Del (check on a Linux TTY or Windows).
- Writing `00 00 51 00 00 00 00 00` (Down held), then disconnecting: the host
  auto-repeats until the disconnect, then stops.
- Writing `00 00 51 …`, then pressing Back on the Flipper: repeat stops, the app
  exits, qFlipper reconnects.
- Unplugging and replugging USB while connected, then writing `a`: `a` is typed.

The full protocol test suite runs in step 07.
