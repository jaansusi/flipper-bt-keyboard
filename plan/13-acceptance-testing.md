# Step 13 — Acceptance testing

**Depends on:** 07, 09, 10, 11, 12
**Spec:** REQUIREMENTS §8 (NFRs), §10 (acceptance criteria)

## Goal

Verify the finished system against every acceptance criterion and the
non-functional requirements, on real hardware and all target platforms.

## Tasks

- [ ] Re-run the protocol suite (`python tools/rk_test.py suite`) on the release
      build of the app.
- [ ] Go through every checkbox in REQUIREMENTS §10. For each one, record
      platform, host, result, and notes in `TEST-REPORT.md`.
- [ ] Non-functional checks:
  - [ ] **NFR-1 latency ≤ 50 ms:** film the laptop keyboard and the host screen
        with a phone at 240 fps; measure frames from key press to character for
        20 key presses. Report median and max.
  - [ ] **NFR-2 reliability:** 10,000 characters in compose mode to a Linux TTY
        (`cat > file`, then `diff` against the sent text) and 1,000 characters
        into a UEFI text field (e.g. a setup password or description field).
  - [ ] **NFR-3 host compatibility:** type into Linux TTY, Linux desktop, Windows,
        macOS, one UEFI setup screen, GRUB edit mode, systemd-boot menu.
  - [ ] **NFR-5 quick start:** time from plugging in to first character typed,
        with an already paired phone. Target < 30 s.
  - [ ] **NFR-6 reboots:** reboot the host from live mode and press F2/Del
        through POST to reach UEFI setup, without touching the Flipper.
  - [ ] **NFR-7 power:** leave the app running with the backlight off and the
        Flipper auto-locked for 30 minutes, then type.
- [ ] File each failure as an issue, fix, and re-run the affected tests.

## Platform matrix

| Client | Live | Compose | On-screen | Pair |
|---|---|---|---|---|
| macOS + Chrome | | | | |
| Windows + Edge | | | | |
| Linux + Chrome | | | | |
| Android + Chrome | — | | | |
| iOS + Bluefy | — | | | |

## Done when

- Every REQUIREMENTS §10 criterion passes and is recorded in `TEST-REPORT.md`.
- All NFR measurements meet their targets, or a deviation is documented and
  accepted.
- The platform matrix is complete.
