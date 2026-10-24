# Flipper app

The app in [`flipper/remote_keyboard/`](../flipper/remote_keyboard) turns the
Flipper into a USB keyboard that types whatever arrives over Bluetooth LE.

## Source files

| File | Content |
|---|---|
| [`remote_keyboard.c`](../flipper/remote_keyboard/remote_keyboard.c) | Entry point, startup and exit, screen and buttons, Bluetooth and USB callbacks |
| [`rk_profile.c/.h`](../flipper/remote_keyboard/rk_profile.c) | Custom Bluetooth profile: advertising config, the GATT service with the Key Report characteristic, and logging of connection events |
| [`rk_worker.c/.h`](../flipper/remote_keyboard/rk_worker.c) | Report queue and the thread that applies reports to USB |
| [`rk_log.c/.h`](../flipper/remote_keyboard/rk_log.c) | [Debug logging](#debug-logging): saves the Flipper's log to the SD card |
| [`rk_build.h`](../flipper/remote_keyboard/rk_build.h) | Which [build variant](#build-variants) is being built |
| [`rk_report.c/.h`](../flipper/remote_keyboard/rk_report.c) | Report validation and the press/release diff; no Flipper headers, unit-tested on the host |
| [`application.fam`](../flipper/remote_keyboard/application.fam) | App manifest (`appid`, version, icon, category USB, f7 only); `RK_DEBUG=1` or `RK_DEMO=1` selects a [build variant](#build-variants) |
| [`description.md`](../flipper/remote_keyboard/description.md), [`changelog.md`](../flipper/remote_keyboard/changelog.md), `screenshots/` | Apps Catalog page: description, changelog and screenshots (see [releasing.md](releasing.md#apps-catalog)) |

## Startup

In order:

1. Show the main screen and start the worker thread (first, so no callback can
   signal it before it exists).
2. Save the current USB configuration and switch USB to HID keyboard mode
   (`furi_hal_usb_set_config(&usb_hid, NULL)`). The device enumerates as a boot
   protocol keyboard, so BIOS/UEFI and bootloaders recognise it.
3. Register a USB HID state callback. (The debug and demo builds skip steps 2
   and 3.)
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
Each call sends one USB report, so the target sees every change in order.

- If a USB send fails while the target is connected, the worker re-sends the
  current state (pressing `HID_KEYBOARD_NONE` changes nothing and re-sends) for
  up to 50 ms.
- Each report lasts at least 8 ms before the next one is applied, so slow BIOS
  input handlers see every key.
- Reports arriving while the target's USB is disconnected are dropped.

## Disconnects

- **Client disconnects:** the queue is emptied and all keys are released, so
  nothing stays held. Advertising restarts by itself; the client can reconnect
  without touching the Flipper.
- **Target USB disconnects** (reboot, power off): the queue is emptied and the
  state reset. The app keeps running and keeps its Bluetooth connection, so
  typing works again as soon as the target enumerates the keyboard, e.g. during
  POST to reach BIOS setup.

## Screen, buttons and menu

In normal mode the main screen shows a title, what is connected, a hint and the
button hints:

- **USB: connected / not connected:** whether a computer has set up the Flipper
  as a keyboard (`furi_hal_hid_is_connected`).
- **BT: connected / not connected:** whether a web client is connected.
- **Hint:** "Connect from the web client.", "Plug into a computer." or "Type
  from the web client.", for the first thing missing.

It never shows received data or which device is connected: Bluetooth LE gives
the Flipper no name for the client, only a changing random address.
The PIN during pairing is drawn by the firmware.

| Screen | Buttons |
|---|---|
| Main | OK: open the menu. Back: release all keys and exit. |
| Menu | Up/Down: choose. OK: select. Back: return to the main screen. |

Menu entries:

| Entry | Action |
|---|---|
| Forget paired devices | Asks for confirmation (OK: forget, Back: cancel), then deletes all bonds. Every client has to pair again with a PIN, and must first remove its old pairing in its own Bluetooth settings. |
| Debug logging: Off / On | Switches [debug logging](#debug-logging) to the SD card. Off every time the app starts. |
| Log keystrokes: Off / On | Shown only while debug logging is on (always in the debug build). Adds received reports and their key presses to the log. Off every time the app starts, and turned off with debug logging. |

While debug logging is on, the main screen shows **LOG** in the bottom right
corner; while keystrokes are logged, **KEYS**.

Forgetting a single device is not possible: the SDK exports no Bluetooth stack
commands for listing or removing individual bonds, only "forget all".

## Exit

In order: stop the worker, release all keys, remove the Bluetooth status
callback, disconnect and wait 200 ms, restore the default bond storage, restore
the default Bluetooth profile, remove the HID callback, restore the previous USB
configuration (not changed in the debug and demo builds), stop debug logging.
After exit, qFlipper and the Flipper mobile app work as before.

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
  structs (`hci_uart_pckt`, `hci_event_pckt`, `evt_blecore_aci`) or the vendor
  event codes (`ble_vs_codes.h`), so `rk_profile.c` mirrors them.
- **The USB HID state callback runs in the USB interrupt.** It must not touch
  mutexes, the GUI or the log, so it only signals the worker; the main loop
  polls `furi_hal_hid_is_connected` for the screen and the log.
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

## Debug logging

To debug a problem afterwards, in the release build, while the Flipper really
types: turn on **OK → Debug logging**. Until it is turned off or the app exits,
everything the Flipper logs is appended to
`/ext/apps_data/remote_keyboard/debug.log` on the SD card. Read it after
exiting the app, with qFlipper's file manager or by taking out the SD card.

What is in the log:

| Source | Lines |
|---|---|
| The app, when logging starts | App version and build, firmware version, Flipper name, USB and Bluetooth state, whether a pairing key file exists, counters |
| The app | Bluetooth status changes, USB host connect and disconnect, failed USB sends, dropped writes, queue overflows, client disconnects with counters, menu actions, startup errors, exit |
| `RkProfile`: Bluetooth events | Connection (status, client address and its type, interval, latency, timeout), connection parameter updates, encryption on/off, PIN requests, pairing result with status and reason codes, bond lost, unresolved client address, MTU, BLE stack errors, disconnects with the reason code |
| The firmware and other apps | Everything they log at the current log level, e.g. `BleGap`, `BtSrv`, `BtKeyStorage` for advertising, pairing and bonding |
| With **Log keystrokes** on | Each received report and the key presses and releases it causes |

Received data is never logged without Log keystrokes. **With Log keystrokes on,
the log contains everything typed, passwords included**, in plain text on the
SD card. Delete the file after use.

How it works ([`rk_log.c`](../flipper/remote_keyboard/rk_log.c)):

- A log handler (`furi_log_add_handler`) receives every log line. It can be
  called from any thread or an interrupt, so it only copies into a 4 KB stream
  buffer; if the buffer is full, bytes are lost and counted.
- A writer thread empties the buffer into the file, drops the color codes of
  the serial log format, and syncs the file whenever the buffer is empty, so
  the file survives a crash. Its own log lines (from storage calls) are skipped
  to avoid feedback.
- If the log level (**Settings → System → Log Level**) is below Info, it is
  raised to Info while logging, then restored.
- Each session starts with `=== Debug logging started <date time>, tick <ms> ===`
  and ends with `=== Debug logging stopped, <n> bytes lost ===`. Log lines are
  prefixed with the Flipper's uptime in milliseconds.
- When logging starts and the file is over 256 KB, it becomes `debug.old.log`,
  replacing the previous old file.

## Build variants

Two variants keep USB in serial mode, so nothing is typed and the computer can
talk to the Flipper's serial port while the app runs. Each has its own `appid`,
so it installs next to the release build, with its own paired devices and log
file. CI only builds the release build.

| | Release build | Debug build | Demo build |
|---|---|---|---|
| Build | `ufbt` | `RK_DEBUG=1 ufbt` | `RK_DEMO=1 ufbt` |
| On the Flipper | Apps → USB → Remote Keyboard | Remote Keyboard Debug | Remote Keyboard Demo |
| USB | Keyboard | Serial | Serial |
| Received reports | Typed | Not typed; the whole receive/apply path runs (diff order, 8 ms per report) | Not typed |
| Main screen | USB and Bluetooth connected or not | Title "Remote Keyboard DEBUG", Bluetooth status, counters: writes received, reports applied, dropped | As the release build; USB always "connected" |
| Log keystrokes in the menu | With debug logging on | Always | With debug logging on |
| For | Use; debugging afterwards with debug logging | Watching the logs live | Screenshots |

### Debug build

For debugging live: the Flipper's log streams over USB while the web client
connects and sends. From `flipper/remote_keyboard/`:

```sh
RK_DEBUG=1 ufbt launch   # installs Apps -> USB -> Remote Keyboard Debug
```

To see received keys, turn on **OK → Log keystrokes**. To watch the logs, on the
computer, from the repository root:

```sh
# One-time setup: a Python virtual environment with the tools' dependencies
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt

.venv/bin/python tools/flipper_log.py     # stream the logs (Ctrl+C to stop)
```

Close qFlipper first: it holds the serial port. To see startup logs too, start
the app from the same serial session with
`flipper_log.py --launch /ext/apps/USB/remote_keyboard_debug.fap`.

Example log, typing "Hi" with Log keystrokes on, then sending an invalid write:

```
[I][RemoteKeyboard] Bluetooth: connected
[I][RkWorker] Report: mods 02 keys 0B 00 00 00 00 00 (2 actions)
[I][RkWorker]   press mod 0x02
[I][RkWorker]   press key 0x0B
[I][RkWorker] Report: mods 00 keys 00 00 00 00 00 00 (2 actions)
[I][RkWorker]   release key 0x0B
[I][RkWorker]   release mod 0x02
[W][RkWorker] Dropped invalid write of 8 bytes
[I][RkProfile] Disconnected: status 0x00, reason 0x13 (client closed the connection)
[I][RkWorker] Client disconnected: queue cleared, keys released
```

`flipper_log.py` options: `--level` (default `debug`), `--port` (default:
auto-detect by USB ID), and `--launch PATH` to start an app from the same serial
session first.

### Demo build

For screenshots. qFlipper takes screenshots over USB, which the release build
takes over as a keyboard. The demo build shows the release build's screens
while USB stays in serial mode, so qFlipper stays connected:

```sh
RK_DEMO=1 ufbt launch   # installs Apps -> USB -> Remote Keyboard Demo
```

Bluetooth works as usual, so the pairing PIN screen can be taken too.
