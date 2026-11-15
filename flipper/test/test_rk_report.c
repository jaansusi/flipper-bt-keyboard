#include "../remote_keyboard/rk_report.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

#define REPORT(...) ((const uint8_t[RK_REPORT_SIZE]){__VA_ARGS__})

static RkReport make(uint8_t mods, uint8_t k0, uint8_t k1) {
    RkReport report = {.mods = mods, .keys = {k0, k1}};
    return report;
}

static void expect_actions(
    const RkReport* current,
    const RkReport* next,
    const RkAction* expected,
    size_t expected_count) {
    RkAction actions[RK_DIFF_ACTION_MAX];
    size_t count = rk_report_diff(current, next, actions);
    assert(count == expected_count);
    for(size_t i = 0; i < count; i++) {
        assert(actions[i].type == expected[i].type);
        assert(actions[i].value == expected[i].value);
    }
}

static void test_valid_reports(void) {
    assert(rk_report_is_valid(REPORT(0, 0, 0, 0, 0, 0, 0, 0)));
    assert(rk_report_is_valid(REPORT(0, 0, 0x04, 0, 0, 0, 0, 0)));
    assert(rk_report_is_valid(REPORT(0, 0, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09)));
    assert(rk_report_is_valid(REPORT(0xFF, 0, 0, 0, 0, 0, 0, 0)));
    assert(rk_report_is_valid(REPORT(0, 0, 0, 0, 0, 0, 0, 0x04)));
    assert(rk_report_is_valid(REPORT(0, 0, 0xA4, 0, 0, 0, 0, 0)));
}

static void test_invalid_reports(void) {
    assert(!rk_report_is_valid(REPORT(0, 1, 0, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0x01, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0x03, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0xA5, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0xE0, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0xE7, 0, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0x04, 0x04, 0, 0, 0, 0)));
    assert(!rk_report_is_valid(REPORT(0, 0, 0x04, 0, 0, 0, 0, 0x04)));
}

static void test_write_lengths(void) {
    uint8_t zeros[24] = {0};
    const size_t lengths[] = {0, 7, 9, 15, 17, 24};
    for(size_t i = 0; i < sizeof(lengths) / sizeof(lengths[0]); i++) {
        assert(!rk_write_is_valid(zeros, lengths[i]));
    }
    assert(rk_write_is_valid(zeros, 8));
    assert(rk_write_is_valid(zeros, 16));
    assert(!rk_write_is_valid(NULL, 8));
}

static void test_write_with_invalid_half(void) {
    uint8_t write[16] = {0, 0, 0x04, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0};
    assert(!rk_write_is_valid(write, sizeof(write)));
    write[9] = 0;
    write[8 + 2] = 0xE1;
    assert(!rk_write_is_valid(write, sizeof(write)));
}

static void test_from_bytes(void) {
    RkReport report;
    rk_report_from_bytes(&report, REPORT(0x05, 0, 0x4C, 0, 0, 0, 0, 0x07));
    assert(report.mods == 0x05);
    assert(report.keys[0] == 0x4C);
    assert(report.keys[5] == 0x07);
}

static void test_diff_press_and_release(void) {
    RkReport zero = make(0, 0, 0);
    RkReport a = make(0, 0x04, 0);
    expect_actions(&zero, &a, (RkAction[]){{RkActionPressKey, 0x04}}, 1);
    expect_actions(&a, &zero, (RkAction[]){{RkActionReleaseKey, 0x04}}, 1);
}

static void test_diff_modifier_order(void) {
    RkReport zero = make(0, 0, 0);
    RkReport ctrl_alt_del = make(0x05, 0x4C, 0);
    expect_actions(
        &zero,
        &ctrl_alt_del,
        (RkAction[]){
            {RkActionPressMod, 0x01},
            {RkActionPressMod, 0x04},
            {RkActionPressKey, 0x4C},
        },
        3);
    expect_actions(
        &ctrl_alt_del,
        &zero,
        (RkAction[]){
            {RkActionReleaseKey, 0x4C},
            {RkActionReleaseMod, 0x01},
            {RkActionReleaseMod, 0x04},
        },
        3);
}

static void test_diff_key_change(void) {
    RkReport a = make(0, 0x04, 0);
    RkReport b = make(0, 0x05, 0);
    expect_actions(
        &a, &b, (RkAction[]){{RkActionReleaseKey, 0x04}, {RkActionPressKey, 0x05}}, 2);
}

static void test_diff_equal_and_reordered(void) {
    RkReport ab = make(0x02, 0x04, 0x05);
    RkReport ba = make(0x02, 0x05, 0x04);
    expect_actions(&ab, &ab, NULL, 0);
    expect_actions(&ab, &ba, NULL, 0);
}

static void test_diff_shift_held(void) {
    // Hold Shift, press and release x, release Shift.
    RkReport zero = make(0, 0, 0);
    RkReport shift = make(0x02, 0, 0);
    RkReport shift_x = make(0x02, 0x1B, 0);
    expect_actions(&zero, &shift, (RkAction[]){{RkActionPressMod, 0x02}}, 1);
    expect_actions(&shift, &shift_x, (RkAction[]){{RkActionPressKey, 0x1B}}, 1);
    expect_actions(&shift_x, &shift, (RkAction[]){{RkActionReleaseKey, 0x1B}}, 1);
    expect_actions(&shift, &zero, (RkAction[]){{RkActionReleaseMod, 0x02}}, 1);
}

static void test_diff_maximum(void) {
    RkReport from = {.mods = 0xFF, .keys = {0x04, 0x05, 0x06, 0x07, 0x08, 0x09}};
    RkReport to = {.mods = 0x00, .keys = {0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F}};
    RkAction actions[RK_DIFF_ACTION_MAX];
    assert(rk_report_diff(&from, &to, actions) == 6 + 8 + 6);
    // Swap modifiers so both release and press groups are full.
    RkReport to_mods = {.mods = 0xFF, .keys = {0}};
    RkReport from_mods = {.mods = 0x00, .keys = {0x04, 0x05, 0x06, 0x07, 0x08, 0x09}};
    assert(rk_report_diff(&from_mods, &to_mods, actions) == 6 + 8);
}

#define MOUSE(...) ((const uint8_t[RK_MOUSE_REPORT_SIZE]){__VA_ARGS__})

static void test_mouse_write_validity(void) {
    assert(rk_mouse_write_is_valid(MOUSE(0, 0, 0, 0), 4));
    assert(rk_mouse_write_is_valid(MOUSE(0x07, 0x7F, 0x81, 0xFF), 4));
    // Unknown button bits
    assert(!rk_mouse_write_is_valid(MOUSE(0x08, 0, 0, 0), 4));
    assert(!rk_mouse_write_is_valid(MOUSE(0x80, 0, 0, 0), 4));
    // -128 in any delta
    assert(!rk_mouse_write_is_valid(MOUSE(0, 0x80, 0, 0), 4));
    assert(!rk_mouse_write_is_valid(MOUSE(0, 0, 0x80, 0), 4));
    assert(!rk_mouse_write_is_valid(MOUSE(0, 0, 0, 0x80), 4));
    // Lengths: exactly one report
    uint8_t zeros[16] = {0};
    const size_t lengths[] = {0, 3, 5, 8, 16};
    for(size_t i = 0; i < sizeof(lengths) / sizeof(lengths[0]); i++) {
        assert(!rk_mouse_write_is_valid(zeros, lengths[i]));
    }
    assert(!rk_mouse_write_is_valid(NULL, 4));
}

static void test_mouse_from_bytes(void) {
    RkMouseReport report;
    rk_mouse_report_from_bytes(&report, MOUSE(0x01, 0x05, 0xFB, 0x81));
    assert(report.buttons == 0x01);
    assert(report.dx == 5);
    assert(report.dy == -5);
    assert(report.wheel == -127);
}

static void expect_mouse_actions(
    uint8_t current_buttons,
    const RkMouseReport* next,
    const RkMouseAction* expected,
    size_t expected_count) {
    RkMouseAction actions[RK_MOUSE_ACTION_MAX];
    size_t count = rk_mouse_report_diff(current_buttons, next, actions);
    assert(count == expected_count);
    for(size_t i = 0; i < count; i++) {
        assert(actions[i].type == expected[i].type);
        assert(actions[i].button == expected[i].button);
        assert(actions[i].dx == expected[i].dx);
        assert(actions[i].dy == expected[i].dy);
        assert(actions[i].wheel == expected[i].wheel);
    }
}

static void test_mouse_diff(void) {
    // Nothing held, nothing moved: no calls
    expect_mouse_actions(0, &(RkMouseReport){0}, NULL, 0);
    // Move only
    expect_mouse_actions(
        0,
        &(RkMouseReport){.dx = 3, .dy = -2},
        (RkMouseAction[]){{.type = RkMouseActionMove, .dx = 3, .dy = -2}},
        1);
    // Press left, then the movement of the same report (a drag starts)
    expect_mouse_actions(
        0,
        &(RkMouseReport){.buttons = 0x01, .dx = 10},
        (RkMouseAction[]){
            {.type = RkMouseActionPress, .button = 0x01},
            {.type = RkMouseActionMove, .dx = 10},
        },
        2);
    // Left held: same buttons, nothing to press again
    expect_mouse_actions(
        0x01,
        &(RkMouseReport){.buttons = 0x01, .dy = 1},
        (RkMouseAction[]){{.type = RkMouseActionMove, .dy = 1}},
        1);
    // Switch from left to right and middle, with scroll
    expect_mouse_actions(
        0x01,
        &(RkMouseReport){.buttons = 0x06, .wheel = -1},
        (RkMouseAction[]){
            {.type = RkMouseActionRelease, .button = 0x01},
            {.type = RkMouseActionPress, .button = 0x02},
            {.type = RkMouseActionPress, .button = 0x04},
            {.type = RkMouseActionScroll, .wheel = -1},
        },
        4);
    // Everything at once fits in RK_MOUSE_ACTION_MAX
    RkMouseAction actions[RK_MOUSE_ACTION_MAX];
    RkMouseReport all = {.buttons = 0x05, .dx = 1, .dy = 1, .wheel = 1};
    assert(rk_mouse_report_diff(0x02, &all, actions) == RK_MOUSE_ACTION_MAX);
    // Unknown current bits are ignored
    expect_mouse_actions(0xF8, &(RkMouseReport){0}, NULL, 0);
}

int main(void) {
    test_valid_reports();
    test_invalid_reports();
    test_write_lengths();
    test_write_with_invalid_half();
    test_from_bytes();
    test_diff_press_and_release();
    test_diff_modifier_order();
    test_diff_key_change();
    test_diff_equal_and_reordered();
    test_diff_shift_held();
    test_diff_maximum();
    test_mouse_write_validity();
    test_mouse_from_bytes();
    test_mouse_diff();
    printf("rk_report: all tests passed\n");
    return 0;
}
