# Bluetooth protocol

Everything that goes between the web client and the Flipper app.

## Identifiers

| Item | UUID |
|---|---|
| Service | `ff6ad5ee-6d0c-4067-9f0b-25935584962d` |
| Key Report characteristic | `82e449f4-1910-47dd-bb18-a697f0e81a9c` |

These identify protocol version 1. There is no version negotiation: an
incompatible future protocol must use new UUIDs.

In the Flipper source ([`rk_profile.c`](../flipper/remote_keyboard/rk_profile.c))
the UUIDs are stored little-endian (reversed byte order), as the BLE stack
expects. In the web client they are in [`constants.js`](../web/js/constants.js).

## Advertising

| Field | Value |
|---|---|
| Advertised service | The 128-bit service UUID, so clients can filter on it |
| Name | The Flipper's name if it is at most 5 characters, as a complete local name; otherwise its first 5 characters as a shortened local name (e.g. `Kalolot` → `Kalol`) |
| Address | The Flipper's Bluetooth address with byte 2 incremented by 2, so it differs from the stock profiles and gets its own bond |
| Appearance | `0x0000` (unknown) |
| Connection interval requested | 7.5–15 ms |

**Why only 5 name characters:** advertising data is limited to 31 bytes. The
stack adds flags (3 bytes) and the transmit power level (3), and the 128-bit
UUID takes 18, which leaves 7 bytes for the name element: 2 bytes of header and
5 characters. With a longer name, the firmware's `aci_gap_set_discoverable`
fails with `BLE_STATUS_INVALID_PARAMS` (0x92) and the Flipper does not
advertise at all. This was found on hardware.

**Connection interval:** the client (central) decides. macOS chose 30 ms in
testing, even though the Flipper asks for at most 15 ms.

## Pairing and bonding

- Pairing method: the Flipper shows a 6-digit PIN, the operator enters it on the
  client (`GapPairingPinCodeShow`). Bonding is on, so this happens once per client.
- The Flipper requests security as soon as a client connects, so the client's OS
  shows the PIN prompt on connect. If the first write arrives before pairing has
  finished, the stack rejects it with an authentication error; the web client
  retries once after 3 seconds.
- Web Bluetooth has no pairing API. The client relies on the OS handling the
  Flipper's security request (or the authentication error).
- Bonds are stored in the app's own key file,
  `/ext/apps_data/remote_keyboard/.bt_keys`, separate from the firmware's default
  bond storage.
- Holding OK for 3 seconds in the app deletes all bonds. Deleting the key file
  from the SD card does the same.

## The GATT service

The service has exactly one characteristic:

| Property | Value |
|---|---|
| UUID | Key Report characteristic |
| Properties | Write (with response) only: no read, notify, indicate or write-without-response |
| Permission | Authenticated write: requires the PIN pairing and an encrypted link |
| Maximum length | 16 bytes |

Write-without-response is not offered: writes with response are ordered and
report errors to the client. 16 bytes fits in the default ATT MTU (23), so no
MTU exchange or long writes are needed.

## Writes

Each write carries one or two key reports:

| Length | Meaning |
|---|---|
| 8 bytes | One report |
| 16 bytes | Two reports, applied in order |
| anything else | Invalid: the whole write is dropped |

If any report in a write is invalid, the whole write is dropped. The ATT write
response is sent by the stack regardless, so it does **not** mean the reports
were accepted or typed.

## Key report

The USB HID boot keyboard input report:

| Byte | Content |
|---|---|
| 0 | Modifier bitmask |
| 1 | Reserved, must be `0x00` |
| 2–7 | Usage IDs of up to 6 held non-modifier keys; `0x00` = empty slot |

Modifier bits:

| Bit | Mask | Key |
|---|---|---|
| 0 | `0x01` | Left Ctrl |
| 1 | `0x02` | Left Shift |
| 2 | `0x04` | Left Alt |
| 3 | `0x08` | Left GUI (Windows / Cmd) |
| 4 | `0x10` | Right Ctrl |
| 5 | `0x20` | Right Shift |
| 6 | `0x40` | Right Alt (AltGr) |
| 7 | `0x80` | Right GUI |

Key usages are from the USB HID Usage Tables, Keyboard/Keypad page (0x07). The
full mapping from browser key codes is in [`keymap.js`](../web/js/keymap.js).

### Validity

A report is valid if and only if:

1. Byte 1 is `0x00`.
2. Every non-zero byte in 2–7 is between `0x04` and `0xA4`.
3. No modifier usage (`0xE0`–`0xE7`) appears in bytes 2–7; modifiers go only in byte 0.
4. No usage appears twice.

The position of a key within bytes 2–7 has no meaning. The same rules are
implemented in [`rk_report.c`](../flipper/remote_keyboard/rk_report.c) and
[`report.js`](../web/js/report.js).

### Meaning

- A report is the **complete** set of keys held at that moment, not a change.
- All zeros means nothing is held.
- A key is pressed by sending a report containing it and released by sending one
  without it. Typing the same character twice needs a release in between.

### Examples

| Action | Reports (hex) |
|---|---|
| Type `a` | `00 00 04 00 00 00 00 00`, `00 00 00 00 00 00 00 00` |
| Type `A` (US layout) | `02 00 04 00 00 00 00 00`, `00 00 00 00 00 00 00 00` |
| Ctrl+Alt+Del | `05 00 4C 00 00 00 00 00`, `00 00 00 00 00 00 00 00` |
| Ctrl+Alt+F2 | `05 00 3B 00 00 00 00 00`, `00 00 00 00 00 00 00 00` |
| Alt+Tab twice, Alt held throughout | `04 00 2B …`, `04 00 00 …`, `04 00 2B …`, `04 00 00 …`, `00 00 00 …` |
