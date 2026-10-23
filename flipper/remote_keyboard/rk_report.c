#include "rk_report.h"

#include <string.h>

#define RK_USAGE_MIN          0x04
#define RK_USAGE_MAX          0xA4
#define RK_USAGE_MODIFIER_MIN 0xE0
#define RK_USAGE_MODIFIER_MAX 0xE7

bool rk_report_is_valid(const uint8_t data[RK_REPORT_SIZE]) {
    if(data[1] != 0) return false;

    const uint8_t* keys = &data[2];
    for(size_t i = 0; i < RK_REPORT_KEYS; i++) {
        uint8_t usage = keys[i];
        if(usage == 0) continue;
        // Modifier usages are outside RK_USAGE_MIN..RK_USAGE_MAX too, but
        // keep the check explicit to match SPEC §5.3 rule 3.
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
