# Implementation Plan — Overview

This plan splits [SPEC.md](../SPEC.md) into steps. Each step is a separate file
with its goal, the spec sections it implements, tasks, and a "done when" check.
A step is finished only when its check passes.

## Steps

| # | Step | Depends on | Spec |
|---|---|---|---|
| 01 | [Repository setup](01-repo-setup.md) | — | — |
| 02 | [Flipper app skeleton and USB HID](02-flipper-usb-hid.md) | 01 | §6.1, §6.2 (USB), §6.6, §6.7 (USB) |
| 03 | [Flipper Bluetooth LE profile](03-flipper-ble-profile.md) | 02 | §3, §4 |
| 04 | [Pairing spike in the browser](04-pairing-spike.md) | 03 | §7.2 |
| 05 | [Report validation and diff (host-testable C)](05-report-core.md) | 01 | §5, §6.3.2 step 1 |
| 06 | [Flipper receive and apply pipeline](06-flipper-pipeline.md) | 03, 05 | §6.3–§6.6 |
| 07 | [Python protocol test client](07-python-test-client.md) | 06 | §10 |
| 08 | [Web client core](08-web-core.md) | 04 | §7.1–§7.3, §7.7 |
| 09 | [Web live mode](09-web-live-mode.md) | 08 | §7.4, Appendix A |
| 10 | [Web on-screen keys](10-web-onscreen-keys.md) | 08 | §7.5 |
| 11 | [Web compose mode](11-web-compose-mode.md) | 08 | §7.6, Appendix B |
| 12 | [Hosting](12-hosting.md) | 08 | §7.1 |
| 13 | [Acceptance testing](13-acceptance-testing.md) | 07, 09, 10, 11, 12 | REQUIREMENTS §10 |
| 14 | [User guide](14-user-guide.md) | 13 | REQUIREMENTS §9 |

```
01 ─┬─ 02 ── 03 ─┬─ 04 ── 08 ─┬─ 09 ─┐
    │            │            ├─ 10 ─┤
    │            │            ├─ 11 ─┼─ 13 ── 14
    │            │            └─ 12 ─┤
    └─ 05 ───────┴─ 06 ── 07 ────────┘
```

Steps 05 and 02–04 can run in parallel. Steps 09–12 can run in parallel once 08
is done.

## Why this order

- **Risk first.** The biggest unverified assumption is that a failed first write
  makes the client OS show the PIN prompt, especially in Bluefy on iOS (SPEC
  §7.2). Step 04 tests this with a throwaway page before any real client work.
  If it fails, the pairing design changes before anything depends on it.
- **Pure logic is unit-tested on the host.** Report validation and the
  press/release diff (step 05) are plain C with no Flipper dependencies, so they
  can be tested on a laptop with fast feedback.
- **The Flipper is tested without the web client.** Step 07's Python client runs
  the protocol tests (SPEC §10), so Flipper bugs and browser bugs are found
  separately.

## Hardware and software needed

- Flipper Zero on official firmware with API 88.x, and an SD card.
- A test host: any Linux PC is enough for most steps. A machine where you can
  reach UEFI setup is needed for step 13.
- Client devices for step 04 and 13: a Mac with Chrome, a Windows laptop with Edge,
  an Android phone with Chrome, an iPhone with Bluefy.
- `ufbt` (Python), Python 3.10+ with `bleak`, Node.js 20+ (only for running JS
  unit tests; the web client itself has no build step).

## Conventions

- C code follows the Flipper firmware style (`clang-format` config from the
  firmware repo).
- Web client: plain ES modules, no framework, no bundler, no runtime
  dependencies (SPEC §7.1 forbids third-party scripts).
- Each step ends with a commit.
