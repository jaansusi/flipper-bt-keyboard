#pragma once

/*
 * Key and mouse report validation and diff (docs/bluetooth-protocol.md, docs/flipper-app.md).
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

#define RK_MOUSE_REPORT_SIZE  4
#define RK_MOUSE_BUTTONS_MASK 0x07 /* Left, right, middle */
/* Each button is either pressed or released, then one move and one scroll */
#define RK_MOUSE_ACTION_MAX   (3 + 2)

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

typedef struct {
    uint8_t buttons;
    int8_t dx;
    int8_t dy;
    int8_t wheel;
} RkMouseReport;

typedef enum {
    RkMouseActionRelease,
    RkMouseActionPress,
    RkMouseActionMove,
    RkMouseActionScroll,
} RkMouseActionType;

typedef struct {
    RkMouseActionType type;
    uint8_t button; /* Single-bit button mask, for press and release */
    int8_t dx; /* Move */
    int8_t dy; /* Move */
    int8_t wheel; /* Scroll */
} RkMouseAction;

/** Check one 8-byte report against the protocol's validity rules. */
bool rk_report_is_valid(const uint8_t data[RK_REPORT_SIZE]);

/** Check a whole GATT write: 8 or 16 bytes, every report valid. */
bool rk_write_is_valid(const uint8_t* data, size_t len);

/** Copy 8 raw bytes into a report. */
void rk_report_from_bytes(RkReport* report, const uint8_t data[RK_REPORT_SIZE]);

/**
 * Compute the firmware calls needed to go from current to next.
 * Order: release keys, release modifiers, press modifiers, press keys.
 * Within a group, keys follow slot order and modifiers go from bit 0 to bit 7.
 *
 * @return number of actions written to out
 */
size_t
    rk_report_diff(const RkReport* current, const RkReport* next, RkAction out[RK_DIFF_ACTION_MAX]);

/** Check a whole write to the Mouse Report characteristic: exactly one valid 4-byte report. */
bool rk_mouse_write_is_valid(const uint8_t* data, size_t len);

/** Copy 4 raw bytes into a mouse report. */
void rk_mouse_report_from_bytes(RkMouseReport* report, const uint8_t data[RK_MOUSE_REPORT_SIZE]);

/**
 * Compute the firmware calls for a mouse report, given the buttons held now.
 * Order: release buttons, press buttons (each from bit 0 to bit 2), move, scroll.
 * Move is left out when dx and dy are 0, scroll when wheel is 0.
 *
 * @return number of actions written to out
 */
size_t rk_mouse_report_diff(
    uint8_t current_buttons,
    const RkMouseReport* next,
    RkMouseAction out[RK_MOUSE_ACTION_MAX]);

#ifdef __cplusplus
}
#endif
