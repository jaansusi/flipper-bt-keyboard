#include "rk_report.h"

#include <string.h>

#define RK_USAGE_MIN          0x04
#define RK_USAGE_MAX          0xA4
#define RK_USAGE_MODIFIER_MIN 0xE0
#define RK_USAGE_MODIFIER_MAX 0xE7

/* -128 is outside the USB mouse's logical range of -127..127 */
#define RK_MOUSE_DELTA_INVALID 0x80

bool rk_report_is_valid(const uint8_t data[RK_REPORT_SIZE]) {
    if(data[1] != 0) return false;

    const uint8_t* keys = &data[2];
    for(size_t i = 0; i < RK_REPORT_KEYS; i++) {
        uint8_t usage = keys[i];
        if(usage == 0) continue;
        // Modifier usages are outside RK_USAGE_MIN..RK_USAGE_MAX too, but
        // keep the check explicit to match the protocol's validity rules.
        if(usage >= RK_USAGE_MODIFIER_MIN && usage <= RK_USAGE_MODIFIER_MAX) return false;
        if(usage < RK_USAGE_MIN || usage > RK_USAGE_MAX) return false;
        for(size_t j = i + 1; j < RK_REPORT_KEYS; j++) {
            if(keys[j] == usage) return false;
        }
    }
    return true;
}

bool rk_write_is_valid(const uint8_t* data, size_t len) {
    if(data == NULL) return false;
    if(len != RK_REPORT_SIZE && len != RK_WRITE_SIZE_MAX) return false;
    for(size_t offset = 0; offset < len; offset += RK_REPORT_SIZE) {
        if(!rk_report_is_valid(&data[offset])) return false;
    }
    return true;
}

void rk_report_from_bytes(RkReport* report, const uint8_t data[RK_REPORT_SIZE]) {
    report->mods = data[0];
    report->reserved = data[1];
    memcpy(report->keys, &data[2], RK_REPORT_KEYS);
}

static bool rk_report_has_key(const RkReport* report, uint8_t usage) {
    for(size_t i = 0; i < RK_REPORT_KEYS; i++) {
        if(report->keys[i] == usage) return true;
    }
    return false;
}

size_t rk_report_diff(
    const RkReport* current,
    const RkReport* next,
    RkAction out[RK_DIFF_ACTION_MAX]) {
    size_t count = 0;

    for(size_t i = 0; i < RK_REPORT_KEYS; i++) {
        uint8_t usage = current->keys[i];
        if(usage != 0 && !rk_report_has_key(next, usage)) {
            out[count++] = (RkAction){RkActionReleaseKey, usage};
        }
    }

    uint8_t released_mods = current->mods & (uint8_t)~next->mods;
    for(uint8_t bit = 0; bit < 8; bit++) {
        uint8_t mask = (uint8_t)(1u << bit);
        if(released_mods & mask) out[count++] = (RkAction){RkActionReleaseMod, mask};
    }

    uint8_t pressed_mods = next->mods & (uint8_t)~current->mods;
    for(uint8_t bit = 0; bit < 8; bit++) {
        uint8_t mask = (uint8_t)(1u << bit);
        if(pressed_mods & mask) out[count++] = (RkAction){RkActionPressMod, mask};
    }

    for(size_t i = 0; i < RK_REPORT_KEYS; i++) {
        uint8_t usage = next->keys[i];
        if(usage != 0 && !rk_report_has_key(current, usage)) {
            out[count++] = (RkAction){RkActionPressKey, usage};
        }
    }

    return count;
}

bool rk_mouse_write_is_valid(const uint8_t* data, size_t len) {
    if(data == NULL || len != RK_MOUSE_REPORT_SIZE) return false;
    if(data[0] & (uint8_t)~RK_MOUSE_BUTTONS_MASK) return false;
    for(size_t i = 1; i < RK_MOUSE_REPORT_SIZE; i++) {
        if(data[i] == RK_MOUSE_DELTA_INVALID) return false;
    }
    return true;
}

void rk_mouse_report_from_bytes(RkMouseReport* report, const uint8_t data[RK_MOUSE_REPORT_SIZE]) {
    report->buttons = data[0];
    report->dx = (int8_t)data[1];
    report->dy = (int8_t)data[2];
    report->wheel = (int8_t)data[3];
}

size_t rk_mouse_report_diff(
    uint8_t current_buttons,
    const RkMouseReport* next,
    RkMouseAction out[RK_MOUSE_ACTION_MAX]) {
    size_t count = 0;

    uint8_t released = current_buttons & (uint8_t)~next->buttons & RK_MOUSE_BUTTONS_MASK;
    uint8_t pressed = next->buttons & (uint8_t)~current_buttons & RK_MOUSE_BUTTONS_MASK;
    for(uint8_t bit = 0; bit < 3; bit++) {
        uint8_t mask = (uint8_t)(1u << bit);
        if(released & mask) {
            out[count++] = (RkMouseAction){.type = RkMouseActionRelease, .button = mask};
        }
    }
    for(uint8_t bit = 0; bit < 3; bit++) {
        uint8_t mask = (uint8_t)(1u << bit);
        if(pressed & mask) {
            out[count++] = (RkMouseAction){.type = RkMouseActionPress, .button = mask};
        }
    }

    if(next->dx != 0 || next->dy != 0) {
        out[count++] = (RkMouseAction){.type = RkMouseActionMove, .dx = next->dx, .dy = next->dy};
    }
    if(next->wheel != 0) {
        out[count++] = (RkMouseAction){.type = RkMouseActionScroll, .wheel = next->wheel};
    }

    return count;
}
