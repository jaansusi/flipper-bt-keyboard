# Flipper Remote Keyboard

Type on a server that has no keyboard. A Flipper Zero plugged into the server's
USB port acts as a keyboard; a phone or laptop sends key presses to it over
Bluetooth LE from a web page.

## Install and use

1. Update your Flipper to the latest official firmware (qFlipper or the Flipper
   mobile app): releases are built for it. Download `remote_keyboard.fap` from
   [Releases](https://github.com/jaansusi/flipper-bt-keyboard/releases) and copy it to
   the SD card at `apps/USB/` with qFlipper.
2. Plug the Flipper into the server and open **Apps → USB → Remote Keyboard**.
3. On your phone or laptop, open **https://jaansusi.github.io/flipper-bt-keyboard/**
   (Chrome or Edge on desktop, Chrome on Android, Bluefy on iPhone), press
   **Connect** and choose your Flipper. The first time, enter the PIN shown on the
   Flipper.

Add the page to your home screen: after the first visit it also works offline.

## Documents

How it works, for anyone changing or maintaining it: [docs/](docs/README.md).

- [Architecture](docs/architecture.md): components, data flow, design decisions, security
- [Bluetooth protocol](docs/bluetooth-protocol.md): advertising, pairing, the key report
- [Flipper app](docs/flipper-app.md): how reports become keystrokes, building, debugging
- [Web client](docs/web-client.md): input modes, modifiers, layouts, offline support
- [Testing](docs/testing.md) and [CI and releases](docs/releasing.md)

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
| `js/ble.js` | Connect, pair, reconnect |
| `js/queue.js` | Ordered write queue |
| `js/live.js`, `js/keymap.js` | Laptop live mode and `KeyboardEvent.code` → HID usage |
| `js/textinput.js` | Phone live mode |
| `js/onscreen.js` | On-screen keys and modifier modes |
| `js/compose.js`, `js/layouts.js` | Compose mode and layout tables |
| `js/main.js` | Page wiring |

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
| [flipper-app.yml](.github/workflows/flipper-app.yml) | push/PR touching `flipper/`, tags `v*` | C tests, build `remote_keyboard.fap` against the latest official release SDK; on a tag, publish a release |

To release: set `fap_version` in `application.fam` (e.g. `"0.2"`), commit, then
`git tag v0.2 && git push origin v0.2`. The tag must match `fap_version`. The
release notes list the commit subjects since the previous tag, so write commit
subjects that read well as changelog entries.

Regenerate the US layout table after changing `tools/gen_us_layout.py`:

```sh
python3 tools/gen_us_layout.py
```
