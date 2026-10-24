# Flipper app

The app in [`flipper/remote_keyboard/`](../flipper/remote_keyboard) turns the
Flipper into a USB keyboard that types whatever arrives over Bluetooth LE.

## Source files

| File | Content |
|---|---|
| [`remote_keyboard.c`](../flipper/remote_keyboard/remote_keyboard.c) | Entry point, startup and exit, screen and buttons, Bluetooth and USB callbacks |
| [`rk_profile.c/.h`](../flipper/remote_keyboard/rk_profile.c) | Custom Bluetooth profile: advertising config and the GATT service with the Key Report characteristic |
| [`rk_worker.c/.h`](../flipper/remote_keyboard/rk_worker.c) | Report queue and the thread that applies reports to USB |
| [`rk_report.c/.h`](../flipper/remote_keyboard/rk_report.c) | Report validation and the press/release diff; no Flipper headers, unit-tested on the host |
| [`application.fam`](../flipper/remote_keyboard/application.fam) | App manifest (`appid`, version, icon, category USB); reads `RK_DEBUG` for the [debug build](#debug-build) |

## Startup

In order:

1. Show the static screen and start the worker thread (first, so no callback can
   signal it before it exists).
2. Save the current USB configuration and switch USB to HID keyboard mode
   (`furi_hal_usb_set_config(&usb_hid, NULL)`). The device enumerates as a boot
   protocol keyboard, so BIOS/UEFI and bootloaders recognise it.
3. Register a USB HID state callback.
4. Disconnect any Bluetooth client and wait 200 ms.
5. Point the Bluetooth bond storage at the app's own key file.
6. Start the custom profile with `bt_profile_start` and set its receive callback.
7. Start advertising and register a Bluetooth status callback.

If USB or the profile cannot be started, the app shows an error for 2 seconds,
undoes what it did and exits.

## From Bluetooth write to keystroke

**Receive (Bluetooth thread).** For each write to the characteristic, the
service event handler checks the length and every report (see
[bluetooth-protocol.md](bluetooth-protocol.md)). Invalid writes are dropped
whole. Valid reports go into a queue of 512 reports without blocking; if the
queue is full, the rest of the write is dropped. The handler never touches USB.

**Apply (worker thread).** The worker keeps the last applied report and, for
each new one, calls the firmware's HID functions in this order:

1. release keys that are no longer held,
2. release modifiers that are no longer held,
3. press new modifiers,
4. press new keys.

So modifiers go down before keys and come up after them, like a person typing.
Each call sends one USB report, so the server sees every change in order.

- If a USB send fails while the server is connected, the worker re-sends the
  current state (pressing `HID_KEYBOARD_NONE` changes nothing and re-sends) for
  up to 50 ms.
- Each report lasts at least 8 ms before the next one is applied, so slow BIOS
  input handlers see every key.
- Reports arriving while the server's USB is disconnected are dropped.

## Disconnects

- **Client disconnects:** the queue is emptied and all keys are released, so
  nothing stays held. Advertising restarts by itself; the client can reconnect
  without touching the Flipper.
- **Server USB disconnects** (reboot, power off): the queue is emptied and the
  state reset. The app keeps running and keeps its Bluetooth connection, so
  typing works again as soon as the server enumerates the keyboard, e.g. during
  POST to reach BIOS setup.

## Screen and buttons

The screen is static: a title, "Pair or connect from the web client", and the
button hints. It never shows connection state or received data. The PIN during
pairing is drawn by the firmware.

| Button | Action |
|---|---|
| Back | Release all keys and exit |
| OK held 3 s | Forget all paired devices (shows "Paired devices forgotten") |

## Exit

In order: stop the worker, release all keys, remove the Bluetooth status
callback, disconnect and wait 200 ms, restore the default bond storage, restore
the default Bluetooth profile, remove the HID callback, restore the previous USB
configuration. After exit, qFlipper and the Flipper mobile app work as before.

## Firmware quirks found along the way

- **The stock serial profile is not usable.** When `ble_profile_serial` is
  active, the firmware's Bluetooth service opens an RPC session on every
  connection and installs its own data callback, so writes would go to the
  Flipper's remote-control system. Hence the custom profile.
- **Advertising data is tiny.** See the name limit in
  [bluetooth-protocol.md](bluetooth-protocol.md#advertising). Too much data and
  the Flipper silently stops advertising.
- **Profiles are never freed by the firmware.** `rk_profile_stop` frees its own
  instance.
- **Missing SDK headers.** The SDK does not export the BLE stack's HCI packet
  structs (`hci_uart_pckt`, `hci_event_pckt`, `evt_blecore_aci`), so
  `rk_profile.c` mirrors them.
- **Apps must be closed by hand.** `ufbt launch` cannot close a running app like
  this one; press Back on the Flipper first.
- **Bond storage path.** `bt_forget_bonded_devices` deletes whichever key file is
  active, which is the app's own file while the app runs.

## Building

The SDK must match the Flipper's firmware **major API version**, or the Flipper
refuses to load the app.

- **Releases** are built in CI against the latest official release firmware (see
  [releasing.md](releasing.md)).
- **Local development** uses a project-local SDK in `.ufbt/` (git-ignored), so the
  global `~/.ufbt` is untouched:

  ```sh
  export UFBT_HOME="$PWD/.ufbt"
  ufbt update --hw-target f7 --channel release   # latest official firmware
  cd flipper/remote_keyboard
  ufbt          # build dist/remote_keyboard.fap
  ufbt launch   # install to /ext/apps/USB/ and start
  ```

  For a Flipper on older firmware, use that version's SDK instead, e.g.
  `ufbt update --hw-target f7 --url https://update.flipperzero.one/builds/firmware/1.4.3/flipper-z-f7-sdk-1.4.3.zip`.
  A wrong SDK shows up on the Flipper as "ApiTooOld" or "outdated app".

## Debug build

While the normal app runs, USB is a keyboard, so the Flipper's serial console and
its logs are gone. The debug build keeps them. It is selected at build time by the
`RK_DEBUG` environment variable, which
[`application.fam`](../flipper/remote_keyboard/application.fam) turns into the
`RK_DEBUG` C define:

```sh
cd flipper/remote_keyboard
RK_DEBUG=1 ufbt launch                       # build, install, start the debug build
cd ../.. && .venv/bin/python tools/flipper_log.py   # stream the logs (Ctrl+C to stop)
```

What changes in the debug build:

| | Normal build | Debug build |
|---|---|---|
| App | "Remote Keyboard", `remote_keyboard.fap` | "Remote Keyboard Debug", `remote_keyboard_debug.fap`; installs next to the normal app |
| USB | Switched to keyboard mode | Stays in serial mode: CLI and logs keep working |
| Received reports | Typed on USB | Logged with the exact key presses and releases they would cause; nothing is typed |
| Timing and order | — | Same as the normal build (diff order, 8 ms per report), so the whole receive/apply path runs |
| Screen | Static text | Bluetooth status and counters: writes received, reports applied, dropped |
| Startup | — | Waits 2 s, so `flipper_log.py` attaches in time to see all of startup |
| Paired devices | `/ext/apps_data/remote_keyboard/.bt_keys` | The same file, so devices paired with one build work with the other |

Example log, typing "Hi" and then sending an invalid write:

```
[I][RemoteKeyboard] Client connected
[D][RkWorker] Report: mods 02 keys 0B 00 00 00 00 00 (2 actions)
[D][RkWorker]   press mod 0x02
[D][RkWorker]   press key 0x0B
[D][RkWorker] Report: mods 00 keys 00 00 00 00 00 00 (2 actions)
[D][RkWorker]   release key 0x0B
[D][RkWorker]   release mod 0x02
[W][RkWorker] Dropped invalid write of 8 bytes
[I][RkWorker] Client disconnected: queue cleared, keys released
```

The firmware's own Bluetooth logs (`BleGap`, `BtSrv`, `BtKeyStorage`) show
advertising, pairing and bonding alongside.

**The debug build logs everything typed, passwords included.** Use it only for
testing. The normal build never logs report contents, and the CI release build
fails if it ever finds the debug build's marker in `remote_keyboard.fap`.

`flipper_log.py` options: `--level` (default `debug`), `--port` (default:
auto-detect by USB ID), and `--launch PATH` to start an app from the same serial
session first.
