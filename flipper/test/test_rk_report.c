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
    printf("rk_report: all tests passed\n");
    return 0;
}
