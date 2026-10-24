# Web client

A single static page in [`web/`](../web): plain ES modules, no framework, no
build step, no runtime dependencies. Hosted on GitHub Pages at
https://jaansusi.github.io/flipper-bt-keyboard/.

## Modules

| File | Content |
|---|---|
| [`main.js`](../web/js/main.js) | Page wiring: connection UI, tabs, panels, settings, on-screen keys |
| [`ble.js`](../web/js/ble.js) | Web Bluetooth: choose device, connect, pair, reconnect |
| [`queue.js`](../web/js/queue.js) | Ordered send queue |
| [`report.js`](../web/js/report.js) | Building and validating key reports |
| [`keymap.js`](../web/js/keymap.js) | `KeyboardEvent.code` → HID usage |
| [`live.js`](../web/js/live.js) | Laptop live mode: keyboard state and platform quirks |
| [`textinput.js`](../web/js/textinput.js) | Phone live mode: typing in a text field |
| [`onscreen.js`](../web/js/onscreen.js) | On-screen key definitions and modifier modes |
| [`compose.js`](../web/js/compose.js) | Compose mode: text to key presses |
| [`layouts.js`](../web/js/layouts.js) | Loading and validating layout tables |
| [`constants.js`](../web/js/constants.js) | UUIDs, modifier bits, timing |
| [`sw.js`](../web/sw.js) | Service worker for offline use |

## Connecting

1. **Connect** (needs a user gesture) calls `navigator.bluetooth.requestDevice`
   filtered on the service UUID, then connects and gets the characteristic.
2. It writes one all-zero report. The Flipper has already asked for pairing on
   connect, so the OS shows the PIN prompt; if the write fails because pairing
   is not finished, it retries once after 3 seconds.
3. Once that write succeeds, the page shows "Connected".

On disconnect the queue is emptied, all local key state is reset, modifiers are
turned off, and the button changes to **Reconnect**, which reuses the same
device without the chooser.

If the browser has no Web Bluetooth, the page shows the supported browsers
instead of the Connect button.

**Stale pairing.** After **Forget paired devices** on the Flipper, sources
still hold their old pairing keys, and connecting fails without asking
for a PIN (on iOS with Bluefy the error has no useful message). Remove the
Flipper in the device's Bluetooth settings (iOS: Settings → Bluetooth → ⓘ next to
the Flipper → Forget This Device), then connect again and enter the new PIN. The
page's connect error says this.

## Send queue

Web Bluetooth allows one GATT operation at a time, so every report goes through
one queue ([`queue.js`](../web/js/queue.js)):

- one write with response at a time, awaited;
- when two or more reports are waiting, the first two share a 16-byte write;
- reports are never dropped, merged or reordered (merging would lose quick taps);
- a failed write is retried once; if it fails again the queue is emptied and an
  all-zero report is sent;
- a transform runs on every pushed report: it adds the held modifiers (see below).

## Input modes

### Live keyboard on a laptop

The capture area forwards physical keys ([`live.js`](../web/js/live.js)):

- On `keydown`/`keyup` the page looks up `event.code` in the key map, updates the
  held modifiers and keys (at most 6), and queues the new state.
- Auto-repeat events are ignored; the target repeats held keys itself. IME
  composition and unknown keys are ignored. Handled events have their default
  action prevented, so browser shortcuts do not fire.
- When the capture area loses focus or the tab is hidden, everything is released.
- Platform quirks:

  | Platform | Quirk | Handling |
  |---|---|---|
  | macOS | Chrome reports Caps Lock turning on/off, not press/release | Either event sends a full Caps Lock tap |
  | macOS | No `keyup` for keys released while Cmd is held | Releasing Cmd also releases keys pressed while it was held |
  | Windows | AltGr sends a fake `ControlLeft` right before `AltRight` | Left Ctrl is removed if it went down within 2 ms of AltRight |

- **Fullscreen** (desktop Chrome/Edge) uses the Keyboard Lock API, so Alt+Tab,
  the Windows key and Ctrl+W go to the target too. Hold Esc to leave.

### Live keyboard on a phone

Phone keyboards only open for real text fields and report characters, not
physical keys. On touch devices (`pointer: coarse`) the live tab shows a text
field instead ([`textinput.js`](../web/js/textinput.js)):

- After every change, the field's new value is compared with the old one,
  assuming edits at the end. Removed characters are sent as Backspace, added
  characters are typed with the selected layout. This also handles autocorrect,
  word suggestions and Android's word composition, which edit whole words.
- The field is kept filled with invisible zero-width spaces, so Backspace always
  has something to delete and fires an event. It is reset after each change
  (but not during composition, which would break the keyboard's word editing).
- Enter is caught on `keydown`.
- Characters missing from the layout are skipped. The page says how many, never
  which, as the text may be a password.

### Type text (compose mode)

Type or paste text, then Send ([`compose.js`](../web/js/compose.js)):

1. The text is normalised (Unicode NFC, `\r\n` and `\r` become `\n`).
2. Each character is looked up in the selected layout; missing ones are skipped
   and counted.
3. Each stroke is sent as a press report and a release report. The page waits for
   the queue to drain, then waits the character delay before the next character.
4. The page shows progress, then "Sent N characters, skipped M". Stop empties the
   queue and releases everything.

The character delay defaults to 20 ms (16–1000 ms) and is set in Settings. 16 ms
is the minimum that keeps up with the Flipper's 8 ms per report.

The **password field** uses the same path. Its value is cleared before sending
and never stored. "Press Enter after the password" (on by default) appends Enter.

## On-screen keys and modifiers

Key groups ([`onscreen.js`](../web/js/onscreen.js)): Modifiers, Keys, Arrows,
Navigation, Combinations, F1–F12. Each group is collapsible, closed by default,
and the page remembers which are open. A key button sends its keys, then
releases. Arrow, Backspace, Delete and Page keys repeat while held (first repeat
after 400 ms, then every 50 ms).

Modifier buttons cycle through three modes on each tap:

| Mode | Behaviour |
|---|---|
| Off | — |
| Once | Added to the next key press (on-screen key or a character typed on a phone), then off |
| Held | Pressed on the target immediately and kept pressed until tapped again. The queue adds held modifiers to every report from every mode, including releases. |

Example: tap Alt twice (held), tap Tab as often as needed, tap Alt to release:
Alt+Tab window switching. The Modifiers heading shows the active modifiers even
when the section is collapsed.

Tapping a key or a section heading while the live typing area has focus does
not move focus away (the page cancels `pointerdown`). So the phone keyboard stays
open, and on a laptop held modifiers combine with live typing.

## Layouts

Layouts are only used for text typed as characters (compose mode, phone typing).
A layout is a JSON file in [`web/layouts/`](../web/layouts):

```json
{
  "id": "us",
  "name": "English (US)",
  "map": {
    "a": [[0, 4]],
    "A": [[2, 4]],
    "\n": [[0, 40]]
  }
}
```

Each character maps to a list of strokes `[modifiers, usage]`, typed in order,
so characters that need a dead key can take two strokes. Files are validated on
load ([`layouts.js`](../web/js/layouts.js)).

`us.json` is generated by [`tools/gen_us_layout.py`](../tools/gen_us_layout.py);
after changing the script, regenerate it with `python3 tools/gen_us_layout.py`.

**To add a layout:**

1. Add `web/layouts/<id>.json`.
2. Add `{ "id": "<id>", "name": "…", "file": "<id>.json" }` to `web/layouts/index.json`.
3. Add `layouts/<id>.json` to the `PRECACHE` list in `web/sw.js` (a unit test
   fails if you forget).

## Offline support

[`sw.js`](../web/sw.js) caches every file on install and serves from the cache
first. Every deploy replaces `BUILD_ID` with the commit hash, which gives a new
cache name; on activation old caches are deleted. A browser with the old version
downloads the new one in the background and shows it on the next reload.
`web/test/precache.test.js` checks that the cache list matches the files in
`web/`. Bluefy on iOS may not support service workers; the page still works online.

## Hosting and security

- Served over HTTPS from GitHub Pages; Web Bluetooth requires a secure context
  (`localhost` also counts, for development).
- A Content Security Policy in a `<meta>` tag (GitHub Pages cannot set headers):
  `default-src 'self'; connect-src 'self'; …`. `connect-src 'self'` lets the page
  fetch its own layout files; every other origin is blocked.
- No third-party scripts, fonts or analytics.
- `localStorage` holds only settings: selected layout, character delay, last tab
  and which key groups are open. Every access is wrapped in `try/catch`, so the
  page works without storage.

## Local development

```sh
python3 -m http.server -d web 8000   # http://localhost:8000
cd web && npm test                   # unit tests
```
