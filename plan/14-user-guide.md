# Step 14 — User guide

**Depends on:** 13
**Spec:** REQUIREMENTS §9 deliverable 5

## Goal

A short guide that gets a new user from nothing to typing on a server, written
for someone standing at a server with a Flipper and a phone or laptop.

## Contents (`GUIDE.md`)

- [ ] **Install the app:** copy `remote_keyboard.fap` to `/ext/apps/USB/` with
      qFlipper, or install from the release page.
- [ ] **First-time pairing:** start the app, open the web client URL, press
      Connect, choose the Flipper's name, enter the PIN shown on the Flipper. Include
      platform-specific steps found in step 04 (e.g. pairing in OS settings
      first, if any platform needed it).
- [ ] **Supported browsers:** Chrome/Edge on desktop, Chrome on Android, Bluefy
      on iOS. Linux: how to enable Web Bluetooth if needed.
- [ ] **Using it:**
  - [ ] Live mode on a laptop, and why the server's layout setting decides the
        characters.
  - [ ] Fullscreen mode for Alt+Tab, Windows key, Ctrl+W.
  - [ ] Compose mode and choosing the layout; the character interval for slow
        BIOS screens.
  - [ ] On-screen keys and sticky modifiers.
  - [ ] Password field.
- [ ] **Recipes:** enter BIOS/UEFI setup; pick a boot entry in GRUB; unlock a
      LUKS disk; log in on a TTY and fix a network config.
- [ ] **Security:** only paired devices can type; how to forget paired devices
      (hold OK for 3 s); what to do if a paired phone is lost.
- [ ] **Troubleshooting:** device not found (is the app running?); pairing prompt
      does not appear; characters wrong (layout mismatch in compose mode); stuck
      key (switch tab or press Back on the Flipper); keys dropped in BIOS (raise
      the character interval).

## Done when

- Someone who has not used the project follows the guide on a fresh Flipper and
  phone and reaches UEFI setup on a test server without help.
- The guide is linked from the README.
