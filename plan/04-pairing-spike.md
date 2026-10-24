# Step 04 — Pairing spike in the browser

**Depends on:** 03
**Spec:** §7.2

## Goal

Prove, on every target platform, that a Web Bluetooth page can connect to the
Flipper and that the first rejected write makes the OS show the PIN prompt. This
is the riskiest assumption in the design. The page from this step is throwaway.

## Tasks

- [ ] `web/spike.html`: one button. On click:
  1. `requestDevice({ filters: [{ services: [SERVICE_UUID] }] })`
  2. connect, get the service and characteristic
  3. `writeValueWithResponse(new Uint8Array(8))`, log the result or error
  4. on error, wait 3 s and retry once (SPEC §7.2 step 3)
  5. log "ready" on success
- [ ] Log every step and error to the page (not only the console), so results
      can be read on phones.
- [ ] Serve it over HTTPS reachable from phones. Options: a temporary GitHub Pages
      branch, or a tunnel such as `cloudflared tunnel --url http://localhost:8000`.
- [ ] Run the test on each platform with the Flipper unpaired, then again when
      already paired. Record the results in the table below.

## Results

| Platform | Prompt appeared on first write? | Retry succeeded? | Reconnect when paired works? | Notes |
|---|---|---|---|---|
| macOS (CoreBluetooth via Python `bleak`, not a browser) | Yes, on connect | Not needed: the first write completed once the PIN was entered | Not tested | 2026-10-23. Flipper log: "Pass key request", "Pairing complete", bond saved to the app's key file. |
| macOS + Chrome | | | | |
| Windows + Edge | | | | |
| Linux + Chrome | | | | |
| Android + Chrome | | | | |
| iOS + Bluefy | Yes | Not needed | Not tested | 2026-10-24, with the real web client from GitHub Pages instead of `spike.html`: connect, PIN pairing and typing all worked. |

The Flipper requests pairing as soon as a client connects (SPEC §7.2), so on
both platforms tested so far the PIN prompt appears on connect, before the first
write fails.

## If a platform does not show the prompt

Try in this order, and update SPEC §7.2 with what works:

1. Pair through the OS Bluetooth settings first, then connect from the page.
   Document this as a one-time setup step for that platform.
2. Add a readable characteristic with `ATTR_PERMISSION_AUTHEN_READ` and read it
   once on connect. Some stacks start pairing on a protected read but not a write.
   This adds a readable value, so update SPEC §4.3 and §6.8 to allow it (its
   content is constant, so no information flows back).
3. Change the characteristic permission to `ATTR_PERMISSION_ENCRY_WRITE` and
   check whether the platform then starts pairing. Only acceptable if the
   pairing still uses the PIN (`GapPairingPinCodeShow`).

## Done when

- The results table is filled in for all five platforms.
- Every platform has a working way to pair, and SPEC §7.2 describes it.
- The decision is committed: either "no change" or the spec update.
