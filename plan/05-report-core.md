# Step 05 — Report validation and diff (host-testable C)

**Depends on:** 01
**Spec:** §4.4, §5.1–§5.4, §6.3.2 step 1

## Goal

The pure logic of the Flipper app, in a file with no Flipper headers, fully
unit-tested on the laptop.

## API (`rk_report.h`)

```c
#define RK_REPORT_SIZE 8

typedef struct {
    uint8_t mods;
    uint8_t reserved;
    uint8_t keys[6];
} RkReport;

/* SPEC §5.3. */
bool rk_report_is_valid(const uint8_t data[RK_REPORT_SIZE]);

/* SPEC §4.4: length is 8 or 16 and every report is valid. */
bool rk_write_is_valid(const uint8_t* data, uint16_t len);

typedef enum {
    RkActionReleaseKey,
    RkActionReleaseMod,
    RkActionPressMod,
    RkActionPressKey,
} RkActionType;

typedef struct {
    RkActionType type;
    uint8_t value; /* usage for keys, modifier mask (one bit) for mods */
} RkAction;

/* SPEC §6.3.2 step 1. Writes at most 28 actions in the required order and
 * returns the count. */
size_t rk_report_diff(const RkReport* current, const RkReport* next, RkAction out[28]);
```

28 = 6 key releases + 8 modifier releases + 8 modifier presses + 6 key presses.

The Flipper side (step 06) turns actions into calls:
`RkActionReleaseKey` → `furi_hal_hid_kb_release(value)`,
`RkActionReleaseMod` → `furi_hal_hid_kb_release(value << 8)`, and so on.

## Tasks

- [ ] Implement `rk_report_is_valid`: byte 1 is 0; non-zero keys in
      `0x04`–`0xA4`; no `0xE0`–`0xE7` in keys; no duplicate non-zero keys.
- [ ] Implement `rk_write_is_valid`.
- [ ] Implement `rk_report_diff` in the order of SPEC §6.3.2 step 1. Within each
      group, process keys in slot order and modifier bits from bit 0 to bit 7, so
      the output is deterministic.
- [ ] Unit tests in `flipper/test/test_rk_report.c` (plain `assert`, no framework):
  - [ ] Valid: all-zero report; one key; 6 keys; all modifiers; keys in any slot.
  - [ ] Invalid: byte 1 ≠ 0; usage `0x01`, `0x03`, `0xA5`, `0xE0`, `0xE7`;
        duplicate usage.
  - [ ] Write lengths 0, 7, 8, 9, 15, 16, 17, 24: only 8 and 16 valid.
  - [ ] 16-byte write with one invalid half is invalid.
  - [ ] Diff: zero → `a`; `a` → zero; zero → Ctrl+Alt+Del (mods pressed before
        key); Ctrl+Alt+Del → zero (key released before mods); `a` → `b` (release
        `a` before press `b`); equal reports → 0 actions; Shift held while `x`
        goes down and up (SPEC §5.5 last example).
  - [ ] Diff ignores slot position: `[a, b]` → `[b, a]` gives 0 actions.

## Done when

- `make -C flipper/test test` passes with `-Wall -Wextra -Werror`.
- `rk_report.c` includes only `<stdint.h>`, `<stdbool.h>`, `<stddef.h>` and
  `<string.h>`, and it also builds as part of the `.fap`.
