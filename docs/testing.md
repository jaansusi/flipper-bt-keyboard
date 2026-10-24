# Testing

## Unit tests

| What | Command | Covers |
|---|---|---|
| Flipper report logic (C) | `make -C flipper/test test` | Report validation, write validation, press/release diff order. Built with the host compiler, AddressSanitizer and UBSan. |
| Web client (JavaScript) | `cd web && npm test` | Reports, send queue, live-mode state and platform quirks, phone text diffing, on-screen keys and modifier modes, compose mode, layouts, offline cache list |

Both run in CI on every push (see [releasing.md](releasing.md)).

## Protocol tests with the Python client

[`tools/rk_test.py`](../tools/rk_test.py) talks to a real Flipper over
Bluetooth LE, independently of any browser, so Flipper bugs and browser bugs
can be told apart.

```sh
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/rk_test.py scan                   # find the Flipper
.venv/bin/python tools/rk_test.py type "hello"           # type with the US layout
.venv/bin/python tools/rk_test.py send 0500 4c00 0000 0000   # raw bytes (Ctrl+Alt+Del)
.venv/bin/python tools/rk_test.py suite --host-ssh user@testhost
```

The typed keys land in whatever has focus on the server. For `suite`, a Linux
server runs `cat >> /tmp/rk_out.txt` on its console, and the script reads that
file over SSH to check what was typed. Without `--host-ssh` it asks you instead.

| # | Test | Expected |
|---|---|---|
| T1 | Writes of 0, 7, 9, 15 and 24 bytes | All dropped; nothing typed |
| T2 | Report with the reserved byte set | Dropped |
| T3 | Modifier usage in a key slot | Dropped |
| T4 | Same usage twice | Dropped |
| T5 | 16-byte write with one invalid half | Whole write dropped |
| T6 | Write from an unpaired client | Rejected; nothing typed (manual) |
| T7 | 600 reports sent as fast as possible | Typed text is an exact prefix of what was sent, at least 256 characters; no stuck key |
| T8 | Hold a key, then disconnect | Key released at the disconnect (manual check) |
| T9 | Hold a key, then press Back on the Flipper | Key released, app exits, USB back to serial (manual) |
| T10 | Unplug and replug USB, then type | Typing works; Bluetooth stayed connected |

## Verified on hardware

Flipper Zero on official firmware 1.4.3:

| Check | Result |
|---|---|
| USB: app running → the computer sees a boot protocol keyboard; Back → serial port returns | Works |
| Advertising with the custom service UUID and a 5-character name | Works (longer names stop advertising entirely) |
| PIN pairing, bond saved to the app's key file, write-only characteristic, 8- and 16-byte writes | Works |
| macOS, Python client (CoreBluetooth) | PIN prompt on connect; first write completes after the PIN |
| iPhone, Bluefy, web client from GitHub Pages | Connect, PIN pairing and typing work |

Not yet verified: macOS/Windows/Linux Chrome or Edge, Android Chrome, the
protocol test suite, and real-server scenarios (BIOS/UEFI setup, disk-encryption
unlock at boot, layout checks, typing latency).

## Browser checks without a Flipper

The page can be loaded in headless Chrome with a fake `navigator.bluetooth`
injected before the page's scripts (via the DevTools protocol's
`Page.addScriptToEvaluateOnNewDocument`). The fake records every write, so the
exact bytes produced by typing, buttons and modifiers can be checked, including
with phone emulation (`Emulation.setTouchEmulationEnabled`).
