# Documentation

How Flipper Remote Keyboard works, for anyone changing or maintaining it.

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | The big picture: components, data flow, design decisions, limitations, security |
| [bluetooth-protocol.md](bluetooth-protocol.md) | What goes over the air: advertising, pairing, the GATT service, the 8-byte key report |
| [flipper-app.md](flipper-app.md) | The Flipper app: source files, startup and exit, how reports become USB keystrokes, the menu and debug mode, firmware quirks, building |
| [web-client.md](web-client.md) | The web page: connecting, the send queue, live typing, on-screen keys and modifiers, compose mode, layouts, offline support |
| [testing.md](testing.md) | Unit tests, the Python protocol test client, what has been verified on hardware |
| [releasing.md](releasing.md) | CI, deploying the web page, publishing Flipper app releases, how the changelog is made |

For installing and using the app, see the [main README](../README.md).

## Repository layout

| Path | Content |
|---|---|
| [`flipper/remote_keyboard/`](../flipper/remote_keyboard) | Flipper app (`.fap`), built with `ufbt` |
| [`flipper/test/`](../flipper/test) | Host unit tests for the app's report logic |
| [`web/`](../web) | Web client: static page, Web Bluetooth, no build step |
| [`web/layouts/`](../web/layouts) | Layout tables for typing text (`us.json` is generated) |
| [`tools/`](../tools) | Python protocol test client, Flipper log streamer, layout generator |
| [`docs/`](.) | This documentation; `images/` holds the README screenshots |
| [`.github/workflows/`](../.github/workflows) | CI: web deploy, Flipper app build and release |

## Getting started

From the repository root:

```sh
# Python tools (protocol test client, log streamer)
python3 -m venv .venv
.venv/bin/pip install -r tools/requirements.txt

# Flipper app: SDK in a project-local .ufbt/, matching the Flipper's firmware
pip install ufbt
export UFBT_HOME="$PWD/.ufbt"
ufbt update --hw-target f7 --channel release
(cd flipper/remote_keyboard && ufbt launch)   # build, install, start

# Web client: serve locally, open http://localhost:8000 in Chrome or Edge
python3 -m http.server -d web 8000

# Tests
make -C flipper/test test
(cd web && npm test)
```

Details: building and debugging in [flipper-app.md](flipper-app.md#building),
local web development in [web-client.md](web-client.md#local-development),
tests in [testing.md](testing.md).
