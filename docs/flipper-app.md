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
| [`application.fam`](../flipper/remote_keyboard/application.fam) | App manifest (`appid`, version, icon, category USB) |

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

## Screen, buttons and menu

In normal mode the main screen is static: a title, "Pair or connect from the web
client", and the button hints. It never shows connection state or received data.
The PIN during pairing is drawn by the firmware.

| Screen | Buttons |
|---|---|
| Main | OK: open the menu. Back: release all keys and exit. |
| Menu | Up/Down: choose. OK: select. Back: return to the main screen. |

Menu entries:

| Entry | Action |
|---|---|
| Forget paired devices | Asks for confirmation (OK: forget, Back: cancel), then deletes all bonds. Every client has to pair again with a PIN, and must first remove its old pairing in its own Bluetooth settings. |
| Debug mode: Off / On | Switches [debug mode](#debug-mode) on or off while the app runs. |

Forgetting a single device is not possible: the SDK exports no Bluetooth stack
commands for listing or removing individual bonds, only "forget all".

## Exit

In order: stop the worker, release all keys, remove the Bluetooth status
callback, disconnect and wait 200 ms, restore the default bond storage, restore
the default Bluetooth profile, remove the HID callback, restore the previous USB
configuration (already done if debug mode is on). After exit, qFlipper and the Flipper mobile app work as before.

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

## Debug mode

While the app types, USB is a keyboard, so the Flipper's serial console and its
logs are gone. Debug mode keeps them. Turn it on from the menu (**OK → Debug
mode**); it is off every time the app starts, so the app always starts as a
working keyboard.

Turning debug mode **on**: held keys are released, the queue is cleared, USB
switches back to serial mode, and from then on received reports are logged
instead of typed. Turning it **off**: USB switches back to keyboard mode and
typing resumes. The worker holds a lock while it touches USB, so switching is
safe while reports are arriving.

| | Normal mode | Debug mode |
|---|---|---|
| USB | Keyboard | Serial: CLI and logs keep working |
| Received reports | Typed on USB | Logged with the exact key presses and releases they would cause; nothing is typed |
| Timing and order | — | Same as normal mode (diff order, 8 ms per report), so the whole receive/apply path runs |
| Main screen | Static text, title "Remote Keyboard" | Title "Remote Keyboard DEBUG", Bluetooth status, counters: writes received, reports applied, dropped |

To watch the logs, turn debug mode on, then on the computer, from the repository
root:

```sh
# One-time setup: a Python virtual environment with the tools' dependencies
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt

.venv/bin/python tools/flipper_log.py     # stream the logs (Ctrl+C to stop)
```

Close qFlipper first: it holds the serial port while it runs.

The serial port appears a moment after switching, as the computer re-detects the
Flipper. Startup happens before debug mode can be switched on; to see startup
logs, use the firmware's own Bluetooth logs or start the app from the same serial
session with `flipper_log.py --launch /ext/apps/USB/remote_keyboard.fap` (it then
switches USB to keyboard mode and the port goes away until debug mode is on).

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

**Debug mode logs everything typed, passwords included.** Use it only for
testing. In normal mode the app never logs report contents.

`flipper_log.py` options: `--level` (default `debug`), `--port` (default:
auto-detect by USB ID), and `--launch PATH` to start an app from the same serial
session first.
