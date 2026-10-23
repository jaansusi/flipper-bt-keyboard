# Step 11 — Web compose mode

**Depends on:** 08
**Spec:** §7.6, Appendix B

## Goal

Type or paste text, press Send, and the page types it on the host with the
selected layout. This is the main mode on phones.

## Modules

| File | Content |
|---|---|
| `web/layouts/us.json` | US table, SPEC Appendix B, in the format of SPEC §7.6 |
| `web/js/layouts.js` | Load and validate a layout file; list of available layouts |
| `web/js/compose.js` | `textToStrokes(text, layout)` (pure) and the send loop |

## Tasks

- [ ] `us.json`: every printable ASCII character plus `\n` and `\t`. Generate it
      with a small script from the Appendix B rules and commit the output, so it
      is easy to check.
- [ ] `layouts.js`: fetch `layouts/index.json` (list of `{id, name, file}`);
      validate each stroke against SPEC §5.3; reject the file if any stroke is
      invalid.
- [ ] `textToStrokes`: NFC-normalize; turn `\r\n` and `\r` into `\n`; map each
      character; return `{ strokes, skipped }`.
- [ ] Send loop: for each character, push `[mods, 0, usage, 0…]` then
      `ZERO_REPORT` for each stroke; wait for the queue to drain, then wait *D* ms.
- [ ] Character interval *D*: input from 16 to 1000 ms, default 20 ms.
- [ ] Progress "Sent N of T" while sending; "Sent N characters, skipped M" when
      done. Local only (SPEC §7.7).
- [ ] Stop button: clear the queue, push `ZERO_REPORT`, end the loop.
- [ ] Password field: `type="password"`, `autocomplete="off"`, own Send button;
      cleared immediately after its strokes are queued; never stored or logged.
- [ ] Layout and *D* remembered in `localStorage`, wrapped in `try/catch`; default
      `us` / 20 ms if storage fails.
- [ ] Disable Send while disconnected or already sending.
- [ ] Unit tests: every Appendix B row; unmapped characters counted and skipped;
      `\r\n` handling; NFC (e.g. `e` + combining acute becomes `é`, which is
      skipped in US); invalid layout file rejected.

## Done when

- Unit tests pass.
- From an Android phone and an iPhone (Bluefy): a 1,000-character string with
  every printable ASCII character arrives exactly on a US-layout Linux TTY.
- Pressing Stop mid-way stops typing within one character and leaves no key held.
- Unlocking a LUKS disk at boot with the password field works, and the field is
  empty afterwards.
