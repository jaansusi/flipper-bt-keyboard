# CI and releases

Two GitHub Actions workflows in [`.github/workflows/`](../.github/workflows).

## Web page: `pages.yml`

Runs on every push to `main` that touches `web/` (or the workflow itself):

1. Run the web unit tests.
2. Copy `web/` to a site folder, minus `test/` and `package.json`.
3. Replace `BUILD_ID` in `sw.js` with the commit hash, so browsers get the new
   version (see [web-client.md](web-client.md#offline-support)).
4. Publish to GitHub Pages: https://jaansusi.github.io/flipper-bt-keyboard/

Only `main` may deploy to the `github-pages` environment.

## Flipper app: `flipper-app.yml`

Runs on every push to `main` and every pull request that touches `flipper/`,
and on every `v*` tag:

1. Run the C unit tests.
2. Check formatting with `ufbt lint` (clang-format); the Apps Catalog rejects
   unformatted code. `ufbt format` fixes it.
3. Build `remote_keyboard.fap` against the **latest official release firmware**
   SDK (`ufbt update --channel release`). The `.fap` is attached to the run as an
   artifact.
4. On a tag only: publish a GitHub release with `remote_keyboard.fap`.

A `.fap` only loads on firmware with the same major API version, so releases
need the latest official firmware on the Flipper.

## Making a release

1. Set `fap_version` in [`application.fam`](../flipper/remote_keyboard/application.fam),
   e.g. `"0.2"`, add the version to
   [`changelog.md`](../flipper/remote_keyboard/changelog.md), and commit.
2. `git tag v0.2 && git push origin v0.2`
3. Update the app in the [Apps Catalog](#apps-catalog).

The tag must match `fap_version`, or the release job fails. Versions starting
with `v0.` are marked as pre-releases.

## How the changelog works

There are two changelogs:

- **GitHub release notes**, generated from commits, described below.
- **[`changelog.md`](../flipper/remote_keyboard/changelog.md)**, written by
  hand, shown in the Apps Catalog. One short entry per version, about what
  changed for Flipper users, in the catalog's format:

  ```
  v0.2:
  What changed

  v0.1:
  First release
  ```

When a tag is pushed, the release job:

1. finds the previous `v*` tag (`git describe --tags --abbrev=0 --match 'v*' <tag>^`);
2. lists the commit subjects between the two tags (`git log --no-merges --reverse`),
   or the whole history for the first release;
3. adds a compare link and the firmware/API version the build is for;
4. uses that as the release notes.

The result lives only in the GitHub release. So the commit subjects *are* the
changelog: write them so they read well as changelog entries, and keep
housekeeping commits to a minimum (or squash them) before tagging. To fix a
release's notes afterwards, edit the release on GitHub.

## Apps Catalog

The [Flipper Apps Catalog](https://github.com/flipperdevices/flipper-application-catalog)
builds the app from source on Flipper's servers, for each firmware, and serves it
in the Flipper mobile app and [Flipper Lab](https://lab.flipper.net/apps). The
catalog only holds a `manifest.yml` pointing at a commit here:

```yaml
sourcecode:
  type: git
  location:
    origin: https://github.com/jaansusi/flipper-bt-keyboard.git
    commit_sha: <full 40-character commit hash>
    subdir: flipper/remote_keyboard
short_description: Type on a server over USB from a phone or laptop via Bluetooth LE
description: "@description.md"
changelog: "@changelog.md"
screenshots:
  - screenshots/main.png
```

in `applications/USB/remote_keyboard/manifest.yml`. Name, id, version, category,
author and icon come from `application.fam`. Paths are relative to `subdir`.

What the catalog checks:

- `ufbt lint` and `ufbt build` pass.
- [`description.md`](../flipper/remote_keyboard/description.md) and
  [`changelog.md`](../flipper/remote_keyboard/changelog.md) use only headings
  (levels 1-2), bold, italic, lists and links: no code, backticks, images or
  tables.
- Screenshots are 512x256 qFlipper exports, unedited. Take them with the
  [demo build](flipper-app.md#demo-build) and save them in
  `flipper/remote_keyboard/screenshots/`.
- Every update has a higher `fap_version` than the last one in the catalog.

Validate before opening the pull request, from a checkout of the catalog repo:
`python3 tools/bundle.py --nolint applications/USB/remote_keyboard/manifest.yml bundle.zip`.
