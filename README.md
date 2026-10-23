# Flipper Remote Keyboard

Type on a server that has no keyboard. A Flipper Zero plugged into the server's
USB port acts as a keyboard; a phone or laptop sends key presses to it over
Bluetooth LE from a web page.

## Install and use

1. Download the `.fap` matching your Flipper's firmware from
   [Releases](https://github.com/jaansusi/flipper-bt-keyboard/releases) and copy it to
   the SD card at `apps/USB/` with qFlipper.
2. Plug the Flipper into the server and open **Apps → USB → Remote Keyboard**.
3. On your phone or laptop, open **https://jaansusi.github.io/flipper-bt-keyboard/**
   (Chrome or Edge on desktop, Chrome on Android, Bluefy on iPhone), press
   **Connect** and choose your Flipper. The first time, enter the PIN shown on the
   Flipper.

Add the page to your home screen: after the first visit it also works offline.

## Documents

- [REQUIREMENTS.md](REQUIREMENTS.md): what the system must do
- [SPEC.md](SPEC.md): how it works, precisely
- [plan/](plan/): implementation steps

## Layout

| Path | Content |
|---|---|
| `flipper/remote_keyboard/` | Flipper app (`.fap`), built with `ufbt` |
| `flipper/test/` | Host unit tests for the app's report logic |
| `web/` | Web client (static page, Web Bluetooth) |
| `web/layouts/` | Layout tables for compose mode (`us.json` is generated) |
| `tools/` | Python protocol test client and generators |

## Flipper app

The SDK must match the Flipper's firmware major API version. The test Flipper
runs official firmware 1.4.3 (API 87.1), so the SDK lives in a project-local
`.ufbt/` (git-ignored) instead of the global `~/.ufbt`:

```sh
pip install ufbt
export UFBT_HOME="$PWD/.ufbt"
ufbt update --hw-target f7 --url https://update.flipperzero.one/builds/firmware/1.4.3/flipper-z-f7-sdk-1.4.3.zip
cd flipper/remote_keyboard
ufbt                # build dist/remote_keyboard.fap
ufbt launch         # build, install and start on a connected Flipper
```

The code also builds against SDK 1.5.1 (API 88.2). For Flipper logs while the
app runs, add `cdefines=["RK_DEBUG_KEEP_USB_CDC"]` to `application.fam`: USB
then stays in serial mode (nothing is typed) and `log debug` works in the CLI.

Unit tests for the report validation and diff logic:

```sh
make -C flipper/test test
```

## Web client

No build step: plain ES modules, no dependencies. Serve `web/` locally (Web
Bluetooth works on `localhost` without HTTPS) and open http://localhost:8000
in Chrome or Edge:

```sh
python3 -m http.server -d web 8000
```

| File | Content |
|---|---|
| `js/ble.js` | Connect, pair, reconnect (SPEC §7.2) |
| `js/queue.js` | Ordered write queue (SPEC §7.3) |
| `js/live.js`, `js/keymap.js` | Live mode and `KeyboardEvent.code` → HID usage (SPEC §7.4) |
| `js/onscreen.js` | On-screen keys and sticky modifiers (SPEC §7.5) |
| `js/compose.js`, `js/layouts.js` | Compose mode and layout tables (SPEC §7.6) |
| `js/main.js` | Page wiring |
| `spike.html` | Throwaway pairing test page (plan step 04) |

Unit tests (Node.js 20+):

```sh
cd web && npm test
```

## Test tools

```sh
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
.venv/bin/python tools/rk_test.py scan
.venv/bin/python tools/rk_test.py type "hello"
.venv/bin/python tools/rk_test.py suite --host-ssh user@testhost
```

## CI and releases

| Workflow | Runs on | Does |
|---|---|---|
| [pages.yml](.github/workflows/pages.yml) | push to `main` touching `web/` | Web tests, deploy `web/` to GitHub Pages |
| [flipper-app.yml](.github/workflows/flipper-app.yml) | push/PR touching `flipper/`, tags `v*` | C tests, build `.fap` for firmware 1.4.3 and 1.5.1; on a tag, publish a release |

To release: set `fap_version` in `application.fam` (e.g. `"0.2"`), commit, then
`git tag v0.2 && git push origin v0.2`. The tag must match `fap_version`.

Regenerate the US layout table after changing `tools/gen_us_layout.py`:

```sh
python3 tools/gen_us_layout.py
```
