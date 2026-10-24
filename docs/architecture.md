# Architecture

## What it is for

A workaround for servers with no keyboard attached. The operator stands at the
server, watches its screen, and needs to type: a BIOS/UEFI setting, a boot menu
choice, a disk-encryption passphrase, a console login. A Flipper Zero plugged
into the server's USB port acts as the keyboard, and the operator types on a
phone or laptop that talks to the Flipper over Bluetooth LE.

It is not a remote-access tool: there is no video, and the operator must be in
Bluetooth range.

## Components

```
┌────────────────────────┐   Bluetooth LE    ┌─────────────────────┐    USB HID    ┌────────┐
│ Web client             │ ────────────────▶ │ Flipper app         │ ────────────▶ │ Server │
│ (browser, phone/laptop)│   8-byte key      │ (remote_keyboard    │   boot        │        │
│ web/                   │   reports         │  .fap) flipper/     │   keyboard    │        │
└────────────────────────┘                   └─────────────────────┘               └────────┘
```

| Component | Where | Job |
|---|---|---|
| Web client | [`web/`](../web), hosted on GitHub Pages | Turns what the operator types into key reports and writes them to the Flipper. See [web-client.md](web-client.md). |
| Flipper app | [`flipper/remote_keyboard/`](../flipper/remote_keyboard) | Switches the Flipper's USB port to a keyboard, receives key reports over Bluetooth LE and replays them on USB. See [flipper-app.md](flipper-app.md). |
| Test tools | [`tools/`](../tools) | Python protocol test client; generator for the US layout table. See [testing.md](testing.md). |

## Data flow

Information flows **one way**: client → Flipper → server. The Flipper sends
nothing back at the application level: no acknowledgements, no status, no
errors. The only traffic from the Flipper to the client is what the Bluetooth
LE stack itself produces (advertising, pairing, link-layer acknowledgements,
ATT write responses). The operator gets feedback from the server's screen.

What travels over Bluetooth is the standard USB boot keyboard report: which
modifier keys are held plus up to six other keys. Each report describes the
*complete* keyboard state, not a change, so a lost report is corrected by the
next one and keys cannot get stuck. The Flipper does not translate anything; it
replays each state on USB. Details in [bluetooth-protocol.md](bluetooth-protocol.md).

## Design decisions

**Physical keys, not characters.** In live mode on a laptop, the client sends
which physical key was pressed (`KeyboardEvent.code`), and the server applies
its own keyboard layout, exactly as with a real USB keyboard. So the Flipper
has no keyboard layouts at all. Only text typed as characters (compose mode,
phone typing) needs a layout table, and that lives in the web client.

**Bluetooth LE, not USB.** The Flipper's single USB port is taken by the server,
so the client has to use another link. Bluetooth LE needs no extra hardware and
works from phones and laptops.

**A custom Bluetooth profile.** The firmware's built-in serial profile is wired
to the Flipper's remote-control (RPC) system, so anything written to it would
control the Flipper itself. The app defines its own GATT service with a single
write-only characteristic instead.

**A web page, not native apps.** Web Bluetooth lets one static page work on
desktop Chrome/Edge, Android Chrome and (via the Bluefy browser) iOS, with no
install. Browsers only allow Web Bluetooth on HTTPS pages, which is why the page
is hosted on GitHub Pages; after the first visit it also works offline.

**Pacing on the Flipper.** Each report is held on USB for at least 8 ms, so slow
BIOS input handlers see every key. Compose mode adds a configurable delay
between characters on top.

## Security

Anyone who can send key reports has keyboard access to the server, which is
effectively root access.

- **Pairing with a PIN.** The characteristic requires an authenticated,
  encrypted link. The Flipper shows a 6-digit PIN that the operator enters on
  the client, so pairing needs physical access to the Flipper.
- **Separate bond storage.** The app keeps its own list of paired devices, so
  phones paired with the stock firmware (e.g. the Flipper mobile app) cannot type.
- **Revocation.** **OK → Forget paired devices** in the app forgets all paired devices.
- **Encryption.** All writes go over an encrypted link; passwords are not exposed
  over the air.
- **Nothing logged.** The Flipper app never logs or stores received data. The web
  client never stores typed text or passwords, makes no network requests after
  loading, and loads no third-party code.
- **Residual risk.** A paired phone or laptop that is lost can type into whatever
  server the Flipper is plugged into while the app runs. Forget paired devices if
  that happens.

## Limitations

- No feedback: if a key is lost, the operator only sees it on the server's screen.
- Browsers: Chrome or Edge on desktop, Chrome on Android, Bluefy on iOS. Safari
  and Firefox have no Web Bluetooth. Linux Chrome may need it turned on in
  `chrome://flags`.
- Some combinations (Ctrl+Alt+Del, Win+L, Cmd+Tab, …) are taken by the client's
  operating system and never reach the browser; the page has on-screen buttons
  for them.
- Text typed as characters (compose mode, phone typing) comes out wrong if the
  selected layout differs from the server's layout setting. Laptop live mode does
  not have this problem.
- One client at a time, one server per Flipper.
