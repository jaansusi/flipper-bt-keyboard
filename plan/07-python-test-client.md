# Step 07 — Python protocol test client

**Depends on:** 06
**Spec:** §10, §4.4, §5

## Goal

A scripted client that runs the SPEC §10 protocol tests T1–T10 against a real
Flipper, so Flipper behaviour is verified independently of any browser.

## Tasks

- [ ] `tools/rk_test.py`, Python 3.10+, only dependency `bleak` (pin the version
      in `tools/requirements.txt`).
- [ ] Commands:
  - [ ] `scan`: list devices advertising the service UUID.
  - [ ] `type "text"`: type ASCII with the US table (port the table from SPEC
        Appendix B; keep it in sync with `web/layouts/us.json` from step 11).
  - [ ] `send <hex>`: write raw bytes, e.g. `send 0500 4c00 0000 0000`.
  - [ ] `suite`: run T1–T10.
- [ ] Pairing: the OS pairs on first connect (Linux: run `bluetoothctl` agent;
      macOS/Windows: OS prompt). Document how in the script's `--help`.
- [ ] Use `write_gatt_char(..., response=True)` for every write (SPEC §4.3).
- [ ] Observing the host: the tests type into a text field on the host. The
      simplest setup is a Linux host running `cat > /tmp/rk_out.txt` in a
      terminal, read back over SSH by the script (`--host-ssh user@host`). Tests
      that cannot be observed automatically (T8 timing, T9) print instructions
      and ask the tester for pass/fail.
- [ ] Each test sends `00…00` at the end, so a failed test does not leave keys
      held.

## Test design

| # | How | Pass if |
|---|---|---|
| T1 | Write 0, 7, 9, 15, 24 bytes, each containing an `a` press, then a valid `b` press/release | Host file contains only `b` |
| T2 | Report with byte 1 = `01` and key `a`, then valid `b` | Only `b` |
| T3 | Report with `E1` in byte 2, then valid `b` | Only `b` |
| T4 | Report `00 00 04 04 …`, then valid `b` | Only `b` |
| T5 | 16-byte write: valid `a` press, invalid report; then `b` | Only `b` |
| T6 | Remove the bond on the client, connect, write `a` | ATT error raised; nothing typed (re-pair afterwards) |
| T7 | 300 characters = 600 reports, queued without waiting between writes | Typed text is an exact prefix of the sent text, at least 256 characters long (see note); no stuck key (typing `z` afterwards gives a single `z`) |
| T8 | Write Down-arrow press, sleep 1 s, disconnect | Repeat stops within 100 ms of the disconnect (check visually or by counting newlines in `less`) |
| T9 | Write Down-arrow press, tester presses Back | Repeat stops; tester confirms qFlipper reconnects |
| T10 | Tester unplugs and replugs USB, script writes `a` | `a` arrives; client never disconnected |

T7 relies on 512 reports = 256 characters fitting in the queue. With
write-with-response each write takes at least one connection event, so the
Flipper may type some characters while the script is still sending and accept
more than 256. The pass condition is therefore: the typed text is an exact
prefix of the sent text of length ≥ 256, and no key is stuck.

## Done when

- `python tools/rk_test.py suite` passes T1–T10 against the step 06 build.
- Results are recorded in `tools/RESULTS.md` with firmware version and date.
