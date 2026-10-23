#pragma once

/*
 * Key report validation and diff (SPEC §5, §6.3.2).
 * No Flipper headers, so this file can be unit-tested on the host.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RK_REPORT_SIZE     8
#define RK_REPORT_KEYS     6
#define RK_WRITE_SIZE_MAX  (2 * RK_REPORT_SIZE)
#define RK_DIFF_ACTION_MAX (RK_REPORT_KEYS + 8 + 8 + RK_REPORT_KEYS)

typedef struct {
    uint8_t mods;
    uint8_t reserved;
    uint8_t keys[RK_REPORT_KEYS];
} RkReport;

typedef enum {
    RkActionReleaseKey,
    RkActionReleaseMod,
    RkActionPressMod,
    RkActionPressKey,
} RkActionType;

typedef struct {
    RkActionType type;
    uint8_t value; /* Usage for keys, single-bit modifier mask for mods */
} RkAction;

/** Check one 8-byte report against SPEC §5.3. */
bool rk_report_is_valid(const uint8_t data[RK_REPORT_SIZE]);

/** Check a whole GATT write against SPEC §4.4: 8 or 16 bytes, every report valid. */
bool rk_write_is_valid(const uint8_t* data, size_t len);

/** Copy 8 raw bytes into a report. */
void rk_report_from_bytes(RkReport* report, const uint8_t data[RK_REPORT_SIZE]);

/**
 * Compute the firmware calls needed to go from current to next (SPEC §6.3.2 step 1).
 * Order: release keys, release modifiers, press modifiers, press keys.
 * Within a group, keys follow slot order and modifiers go from bit 0 to bit 7.
 *
 * @return number of actions written to out
 */
size_t rk_report_diff(
    const RkReport* current,
    const RkReport* next,
    RkAction out[RK_DIFF_ACTION_MAX]);

#ifdef __cplusplus
}
#endif
