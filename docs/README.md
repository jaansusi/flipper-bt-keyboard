# Documentation

How Flipper Remote Keyboard works, for anyone changing or maintaining it.

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | The big picture: components, data flow, design decisions, limitations, security |
| [bluetooth-protocol.md](bluetooth-protocol.md) | What goes over the air: advertising, pairing, the GATT service, the 8-byte key report |
| [flipper-app.md](flipper-app.md) | The Flipper app: source files, startup and exit, how reports become USB keystrokes, firmware quirks, building and debugging |
| [web-client.md](web-client.md) | The web page: connecting, the send queue, live typing, on-screen keys and modifiers, compose mode, layouts, offline support |
| [testing.md](testing.md) | Unit tests, the Python protocol test client, what has been verified on hardware |
| [releasing.md](releasing.md) | CI, deploying the web page, publishing Flipper app releases, how the changelog is made |

For installing and using the app, see the [main README](../README.md).
