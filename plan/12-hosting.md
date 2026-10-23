# Step 12 — Hosting

**Depends on:** 08 (can be done any time after; redeploy after 09–11)
**Spec:** §7.1, SEC-5

## Goal

The web client is served over HTTPS from a stable URL, makes no network requests
after loading, and optionally works offline.

## Tasks

- [ ] Deploy `web/` to GitHub Pages with a GitHub Actions workflow on pushes to
      `main` (upload `web/` as the Pages artifact; exclude `web/test/` and
      `spike.html`).
- [ ] Content Security Policy: GitHub Pages cannot set headers, so add
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'">`.
      Note: `connect-src 'none'` blocks `fetch` for layout files, so either
      inline the layout files into a JS module at deploy time, or use
      `connect-src 'self'`. Pick one and update SPEC §7.1 to match.
- [ ] Remove the `window.rk` debug hook from step 08.
- [ ] Check in devtools (Network tab) that after loading, using every mode makes
      no requests.
- [ ] *(Optional, WEB-15)* Offline: add `manifest.webmanifest` and a service
      worker that caches all files on install. Note that a service worker
      `fetch` from cache is not a network request and is allowed by the CSP.
- [ ] *(Optional, WEB-14)* Saved snippets in `localStorage` (not for the password
      field).
- [ ] Add the URL to the README.

## Done when

- The page loads from the Pages URL on all five platforms from step 04.
- The Network tab shows no requests after the initial load.
- *(If offline was done)* With the phone in airplane mode except Bluetooth, the
  page still opens from the home screen and types.
