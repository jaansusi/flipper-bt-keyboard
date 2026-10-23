# Flipper Remote Keyboard — Requirements

## 1. Problem

Servers usually have no keyboard attached. Some tasks still need local keystrokes:
BIOS/UEFI setup, boot menus, GRUB, disk-encryption passphrases, a broken network
config, or a login on the local console. When you are standing at the server with
a screen but there is no keyboard nearby, you are stuck.

This is a **workaround for when no keyboard is at hand**, not a remote-access tool.
The operator stands next to the server and watches its screen.

## 2. Solution

The operator plugs a Flipper Zero into the server's USB port, and it shows up as a
standard USB keyboard. A laptop or phone opens a web page and connects to the
Flipper over Bluetooth LE.

On a laptop, the operator types on the **laptop's own keyboard**. The web page
captures each physical key press and release and sends it to the Flipper, which
passes it to the server unchanged. The Flipper acts as a wireless extension
cord for the laptop's keyboard.

Because physical keys are forwarded, not characters, **the Flipper has no
keyboard layout**. The server applies its own layout setting, exactly as it
would for a real USB keyboard.

Information flows **one way only**: client → Flipper → server. The Flipper sends
nothing back to the client. Apart from the firmware's PIN screen during the
one-time pairing, it shows nothing on its own screen.

```
┌──────────────┐    Bluetooth LE     ┌─────────────┐    USB HID    ┌────────┐
│ Laptop/phone │ ──────────────────▶ │ Flipper Zero│ ────────────▶ │ Server │
│ (web page)   │     key reports     └─────────────┘  same reports └────────┘
└──────────────┘
```

The system has three parts:

| Component | Description |
|---|---|
| **Flipper app** | A Flipper Application Package (`.fap`) that switches the USB port to HID keyboard mode, receives key reports over Bluetooth LE, and passes them to the USB port. It does no translation. |
| **Key report format** | Standard USB HID keyboard reports (modifier keys + pressed keys), sent over Bluetooth LE. |
| **Web client** | A web page that uses the Web Bluetooth API. It turns the laptop's key presses (or text typed on a phone) into key reports and sends them. |

## 3. How keyboard layouts work

- **Live mode (laptop keyboard).** The web page reads the *physical* key
  (`KeyboardEvent.code`, e.g. `KeyQ`), not the character it produces. The server
  turns that key into a character using *its own* layout. If the laptop and server
  use the same layout, you get exactly what is printed on the laptop's keys. If
  they differ, you get what the server's layout says, just as if you had plugged a
  real keyboard of the laptop's layout into the server.
- **Compose mode (phone, pasted text).** Phone on-screen keyboards produce
  characters, not physical keys. To type text, the web page has to turn each
  character into a key press, and for that it needs to know the server's layout.
  This mapping lives **in the web page only**. The Flipper still just forwards
  reports.

## 4. Constraints

- **The link from the client cannot be USB.** The Flipper has one USB-C port, and
  it is taken by the server. The app defines its own Bluetooth LE profile with a
  single custom service (`bt_profile_start` with a custom profile template). It
  must not use the stock `ble_profile_serial`, because the firmware connects that
  profile to the Flipper's RPC system (see [SPEC.md](SPEC.md) §3).
- **"One way" applies to the application, not the radio.** Bluetooth LE itself is
  two-way: connecting, pairing and link-layer delivery confirmation all send
  packets back to the client. The app adds nothing on top of that: no acks, no
  status, no errors.
- **Feedback comes from the server's screen.** The client cannot know whether a key
  reached the server. That is fine, because the operator watches the server's
  screen and corrects mistakes.
- **Range is not a concern.** The operator is next to the server, well within
  Bluetooth LE range.
- **Web Bluetooth needs a secure context.** The web client must be served over
  HTTPS (or from `localhost` during development), and connecting must be started
  by a user action such as a button press.
- **The client's operating system keeps some key combinations.** Combinations
  such as Ctrl+Alt+Del and Win+L (Windows) or Cmd+Tab and Cmd+Space (macOS) are
  handled by the client's OS and never reach the browser. The web client provides
  on-screen buttons for these.

## 5. Goals and non-goals

### Goals
- Use a laptop's own keyboard as the server's keyboard, regardless of layout.
- Type text from a phone when no laptop is around.
- Work in pre-OS environments (BIOS/UEFI, bootloaders), not only in a running OS.
- Need no app install on the client: open a web page and connect.
- Stop unauthorized devices from typing into servers.
- Keep the Flipper app as simple as possible: receive a report, send it to USB.

### Non-goals
- Any feedback to the client (acks, status, errors, host LED state).
- Keyboard layout handling on the Flipper.
- A user interface on the Flipper beyond starting and exiting the app.
- Native phone or desktop apps.
- Remote access from another room or over the network.
- Leaving the Flipper permanently attached to a server.
- Screen capture or video feedback (the operator looks at the server's screen).
- Mouse emulation and media keys.
- Links other than Bluetooth LE (UART, Wi-Fi bridge).
- Controlling more than one server from one Flipper.
- Custom Flipper firmware. The app must run on stock firmware.

## 6. Functional requirements

Priority: **M** = must, **S** = should, **C** = could.

### 6.1 USB HID keyboard (Flipper → server)

| ID | Requirement | Pri |
|---|---|---|
| HID-1 | The app switches the USB port to HID keyboard mode on start and restores the previous USB config on exit. | M |
| HID-2 | The device enumerates as a standard keyboard that supports the **boot protocol**, so BIOS/UEFI and bootloaders recognise it. | M |
| HID-3 | Every received report is sent to the server in order. Reports are never merged, reordered or skipped. | M |
| HID-4 | Supports all keys of a standard 104/105-key keyboard, including F1–F12, Print Screen, Pause, the numeric keypad and the ISO key next to left Shift. | M |
| HID-5 | Supports up to 6 keys held at once plus any combination of the 8 modifier keys (left/right Ctrl, Shift, Alt, GUI). | M |
| HID-6 | Releases all keys when the client disconnects or the app exits, so no key stays stuck on the server. | M |

### 6.2 Bluetooth LE link (client → Flipper)

| ID | Requirement | Pri |
|---|---|---|
| BLE-1 | The app advertises its custom service and accepts one connected client at a time. | M |
| BLE-2 | The client writes key reports to the service's single write-only characteristic. The app sends no notifications back. | M |
| BLE-3 | If the client disconnects, the app stays in HID mode and accepts a new connection without a restart. | M |
| BLE-4 | When the client disconnects, the app discards any reports not yet sent to USB. | M |
| BLE-5 | Received reports are queued (room for at least 512 reports). If the queue is full, new reports are dropped. | M |

### 6.3 Key report format

| ID | Requirement | Pri |
|---|---|---|
| FMT-1 | Each key report is **8 bytes**, the standard USB HID boot keyboard report: byte 0 = modifier bitmask, byte 1 = reserved (0), bytes 2–7 = usage codes of up to 6 pressed keys (0 = none). | M |
| FMT-2 | Each report describes the **complete** keyboard state (everything currently held), not a change. A lost report is corrected by the next one, so keys cannot get stuck. | M |
| FMT-3 | A Bluetooth LE write contains one or more whole reports. If the length is not a multiple of 8, the whole write is discarded. | M |
| FMT-4 | An all-zero report means "all keys released". | M |
| FMT-5 | Usage codes follow the USB HID Usage Tables, Keyboard/Keypad page (0x07). | M |

### 6.4 Flipper app

| ID | Requirement | Pri |
|---|---|---|
| APP-1 | The app has no runtime UI. It may show a single static screen while running. | M |
| APP-2 | The Back button releases all keys and exits the app (physical kill switch). | M |
| APP-3 | The app has no settings and no config file. | M |
| APP-4 | The app writes nothing it receives to the SD card or to logs. | M |

### 6.5 Web client

| ID | Requirement | Pri |
|---|---|---|
| WEB-1 | A single static web page (HTML/JS, no backend) that connects to the Flipper with the Web Bluetooth API. | M |
| WEB-2 | Supported platforms: **laptops** with Chrome or Edge on macOS, Windows and Linux; **Android** phones with Chrome; **iOS** phones with the Bluefy browser (see §7). | M |
| WEB-3 | Layout works on both phone and laptop screens. | M |
| WEB-4 | **Live mode**: while a capture area has focus, every physical key press and release is sent as a key report, based on `KeyboardEvent.code`. Browser shortcuts are blocked so they do not fire on the client. | M |
| WEB-5 | In live mode, Mac keys map to PC keys: Cmd → GUI, Option → Alt, Control → Ctrl. | M |
| WEB-6 | When the capture area loses focus or the page is hidden, the client sends an all-zero report, so no key stays held on the server. | M |
| WEB-7 | On-screen buttons for combinations the client OS keeps for itself: Ctrl+Alt+Del, Alt+Tab, GUI, Alt+F4, Ctrl+Alt+F1…F7, plus a way to send any combination. | M |
| WEB-8 | **Compose mode**: type or paste text in a field, press Send, and the page types it as key presses using the selected server layout. Needed on phones, whose on-screen keyboards do not produce physical keys. | M |
| WEB-9 | Compose mode supports the US layout. Other layouts can be added as mapping tables in the web page. | M |
| WEB-10 | **Password field** in compose mode: input is masked and cleared after sending. | M |
| WEB-11 | Compose mode spaces out key presses (default ~10 ms, adjustable), because some BIOS and bootloader inputs drop fast input. Characters with no key in the selected layout are skipped. | M |
| WEB-12 | Shows whether the Bluetooth connection to the Flipper is up, and offers to reconnect if it drops. (This is local browser state, not feedback from the Flipper.) | M |
| WEB-13 | If the browser has no Web Bluetooth, the page says so and lists the supported browsers. | M |
| WEB-14 | Saved snippets for repeated input (e.g. a boot sequence), stored in the browser. | C |
| WEB-15 | Works offline once loaded (installable as a PWA). | C |

### 6.6 Security

Anyone who can send key reports has keyboard access to the server, which is
effectively root access.

| ID | Requirement | Pri |
|---|---|---|
| SEC-1 | The client device must be **paired and bonded with a PIN** before it can send. The Flipper firmware shows the PIN on the Flipper's screen during the one-time pairing, and the operator enters it on the client. | M |
| SEC-2 | Unbonded devices cannot write to the key report characteristic. The app keeps its own bond storage, so devices paired with the stock firmware (e.g. the Flipper mobile app) cannot type. | M |
| SEC-3 | Bonded devices can be removed by holding OK for 3 seconds in the app. | M |
| SEC-4 | The Bluetooth LE link is encrypted, so key presses (including passwords) cannot be sniffed. | M |
| SEC-5 | The web client sends key presses only to the Flipper, never to a server or analytics service. | M |

## 7. Known limitations

- **iOS needs the Bluefy browser.** Safari and every other iOS browser lack Web
  Bluetooth. iOS users install Bluefy (free, App Store) and open the web client in it.
- **Safari and Firefox are not supported** on any platform, for the same reason.
- **Linux Chrome** may need Web Bluetooth turned on in `chrome://flags`, depending
  on the Chrome version and the BlueZ setup.
- **Some combinations need on-screen buttons**, because the client OS keeps them
  for itself (see §4).
- **Compose mode depends on the server's layout.** If the selected layout does not
  match the server's, some characters come out wrong. Live mode does not have this
  problem.
- **No delivery feedback.** If a key is lost, the operator only sees it on the
  server's screen.

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Latency**: in live mode, a key reaches the server ≤ 50 ms after it is pressed on the laptop, so typing feels like a normal keyboard. |
| NFR-2 | **Reliability**: 10,000 characters typed in compose mode with 0 lost or wrong characters at the default spacing, on a Linux TTY and in a UEFI setup screen. |
| NFR-3 | **Host compatibility**: Linux (TTY and desktop), Windows, macOS, at least one UEFI firmware, GRUB, systemd-boot. No host drivers. |
| NFR-4 | **Firmware compatibility**: builds against the current official Flipper firmware SDK (API version pinned in the build). |
| NFR-5 | **Quick start**: from plugging in the Flipper to typing on the server takes under 30 seconds for a client that is already paired. |
| NFR-6 | **Server reboots**: the app keeps running through a server reboot and is a working keyboard again as soon as the server re-enumerates USB (needed to reach BIOS/UEFI). |
| NFR-7 | **Power**: works with the display backlight off. Auto-lock does not break the app or the HID connection. |

## 9. Deliverables

1. `flipper_remote_keyboard.fap`: Flipper app (C, built with `ufbt`).
2. Key report format specification (Markdown, in this repo).
3. Web client: static page, hosted over HTTPS (e.g. GitHub Pages).
4. *(Optional)* Python test script using `bleak`, for testing the Flipper app without the web client.
5. User guide: install, pairing, supported browsers, examples (unlock LUKS, enter BIOS, recover network).

## 10. Acceptance criteria

- [ ] Plug the Flipper into a server and start the app: the server sees a keyboard. Exit the app: qFlipper reconnects over USB.
- [ ] Pairing a new client shows a PIN on the Flipper. After entering it, the client can type. An unbonded device cannot.
- [ ] The web client connects and types from: a Mac with Chrome, a Windows laptop with Edge, an Android phone with Chrome, an iPhone with Bluefy.
- [ ] Opening the web client in Safari shows the "browser not supported" message.
- [ ] Live mode: with laptop and server both on the same layout (e.g. Estonian), every key on the laptop, including letters like ä, ö, ü, õ, produces the character printed on it.
- [ ] Live mode: holding Shift and pressing keys gives capitals. Holding an arrow key auto-repeats on the server. Releasing it stops the repeat.
- [ ] Live mode: switching to another browser tab while holding a key releases the key on the server.
- [ ] Compose mode: a 1,000-character string containing every printable US-ASCII character arrives on a US-layout Linux TTY exactly as sent.
- [ ] The on-screen Ctrl+Alt+F2 button switches the Linux virtual terminal.
- [ ] Reboot the server, press F2 repeatedly in live mode during POST, and reach and navigate the UEFI setup screen.
- [ ] Unlock a LUKS-encrypted disk at boot, from a laptop in live mode and from a phone with the password field.
- [ ] Pressing Back on the Flipper while a key is held releases it and exits.
- [ ] Disconnect the client while a key is held: the key is released, and the client can reconnect without touching the Flipper.
