# Step 01 — Repository setup

**Depends on:** —
**Spec:** —

## Goal

An empty but buildable project: the Flipper app compiles to a `.fap`, the web
client opens in a browser, and test runners for C and JS work.

## Layout

```
flipper-keyboard/
├── REQUIREMENTS.md
├── SPEC.md
├── plan/
├── flipper/
│   └── remote_keyboard/          # ufbt app directory
│       ├── application.fam
│       ├── remote_keyboard.c     # entry point, UI, lifecycle (steps 02, 06)
│       ├── rk_profile.c/.h       # custom BLE profile and GATT service (step 03)
│       ├── rk_worker.c/.h        # queue and apply thread (step 06)
│       ├── rk_report.c/.h        # validation and diff, no Flipper headers (step 05)
│       └── images/icon_10px.png
├── flipper/test/
│   ├── Makefile                  # builds rk_report.c with the host compiler
│   └── test_rk_report.c
├── web/
│   ├── index.html
│   ├── css/style.css
│   ├── js/                       # ES modules (steps 08–11)
│   ├── layouts/us.json           # step 11
│   └── test/                     # node --test unit tests
└── tools/
    └── rk_test.py                # Python protocol test client (step 07)
```

## Tasks

- [ ] `git init`, add a `.gitignore` (`dist/`, `.ufbt/`, `__pycache__/`, `.venv/`,
      `node_modules/`).
- [ ] Install `ufbt` (`pip install ufbt`), run `ufbt update` to fetch the SDK for
      the official release channel, and record the SDK/API version in the README.
- [ ] Create `application.fam` with the values from SPEC §6.1
      (`appid="remote_keyboard"`, `name="Remote Keyboard"`,
      `apptype=FlipperAppType.EXTERNAL`, `fap_category="USB"`,
      `entry_point="remote_keyboard_app"`, `requires=["gui", "bt"]`,
      `fap_icon="images/icon_10px.png"`).
- [ ] Add a `remote_keyboard.c` that opens a GUI view port, draws "Remote Keyboard"
      and exits on Back.
- [ ] Add `web/index.html` with a heading and an empty `js/main.js` module.
- [ ] Add `flipper/test/Makefile` with a `test` target that compiles and runs
      `test_rk_report.c` with `cc -std=c11 -Wall -Wextra -Werror`.
- [ ] Add `web/test/` with one trivial `node --test` test.
- [ ] Add a short `README.md`: what the project is, the directory layout, and how
      to build, flash and test.

## Done when

- `cd flipper/remote_keyboard && ufbt` produces `dist/remote_keyboard.fap`.
- `ufbt launch` starts the app on a connected Flipper, it shows the title, and
  Back exits.
- `make -C flipper/test test` and `node --test web/test/` both pass.
- `python3 -m http.server -d web` serves the page at `http://localhost:8000`.
