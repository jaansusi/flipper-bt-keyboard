# CI and releases

Two GitHub Actions workflows in [`.github/workflows/`](../.github/workflows).

## Web page: `pages.yml`

Runs on every push to `main` that touches `web/` (or the workflow itself):

1. Run the web unit tests.
2. Copy `web/` to a site folder, minus `test/` and `package.json`.
3. Replace `BUILD_ID` in `sw.js` with the commit hash, so phones get the new
   version (see [web-client.md](web-client.md#offline-support)).
4. Publish to GitHub Pages: https://jaansusi.github.io/flipper-bt-keyboard/

Only `main` may deploy to the `github-pages` environment.

## Flipper app: `flipper-app.yml`

Runs on every push to `main` and every pull request that touches `flipper/`,
and on every `v*` tag:

1. Run the C unit tests.
2. Build `remote_keyboard.fap` against the **latest official release firmware**
   SDK (`ufbt update --channel release`). The `.fap` is attached to the run as an
   artifact.
3. On a tag only: publish a GitHub release with `remote_keyboard.fap`.

A `.fap` only loads on firmware with the same major API version, so releases
need the latest official firmware on the Flipper.

## Making a release

1. Set `fap_version` in [`application.fam`](../flipper/remote_keyboard/application.fam),
   e.g. `"0.2"`, and commit.
2. `git tag v0.2 && git push origin v0.2`

The tag must match `fap_version`, or the release job fails. Versions starting
with `v0.` are marked as pre-releases.

## How the changelog works

The changelog is **not stored in the repository**. When a tag is pushed, the
release job:

1. finds the previous `v*` tag (`git describe --tags --abbrev=0 --match 'v*' <tag>^`);
2. lists the commit subjects between the two tags (`git log --no-merges --reverse`),
   or the whole history for the first release;
3. adds a compare link and the firmware/API version the build is for;
4. uses that as the release notes.

The result lives only in the GitHub release. So the commit subjects *are* the
changelog: write them so they read well as changelog entries, and keep
housekeeping commits to a minimum (or squash them) before tagging. To fix a
release's notes afterwards, edit the release on GitHub.
