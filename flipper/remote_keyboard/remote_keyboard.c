#include "rk_build.h"
#include "rk_log.h"
#include "rk_profile.h"
#include "rk_worker.h"

#include <furi.h>
#include <furi_hal_usb.h>
#include <furi_hal_usb_hid.h>
#include <furi_hal_bt.h>
#include <furi_hal_version.h>
#include <bt/bt_service/bt.h>
#include <gui/gui.h>
#include <storage/storage.h>
#include <toolbox/version.h>

#define TAG "RemoteKeyboard"

#define RK_BT_KEYS_STORAGE_PATH APP_DATA_PATH(".bt_keys")

#define RK_MESSAGE_SHOW_MS    (2000)
#define RK_BT_SETTLE_MS       (200)
#define RK_INPUT_POLL_MS      (100)
#define RK_INPUT_QUEUE_LENGTH (8)

typedef enum {
    RkScreenMain,
    RkScreenMenu,
    RkScreenConfirmForget,
    RkScreenMessage,
} RkScreen;

typedef enum {
    RkMenuItemForget,
    RkMenuItemDebugLogging,
    RkMenuItemLogKeys,
    RkMenuItemCount,
} RkMenuItem;

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* input_queue;

    FuriHalUsbInterface* usb_prev;
    Bt* bt;
    FuriHalBleProfileBase* profile;
    RkWorker* worker;
    RkLog* log;
    bool bt_connected;
    BtStatus bt_status;

    // Screen state, shared with the GUI thread's draw callback
    FuriMutex* screen_mutex;
    RkScreen screen;
    RkMenuItem menu_item;
    const char* message;
    uint32_t message_until;
    bool usb_connected;
    bool debug_logging;
    bool log_keys;
    RkWorkerStats shown_stats;
} RkApp;

static const char* rk_bt_status_name(BtStatus status) {
    switch(status) {
    case BtStatusUnavailable:
        return "unavailable";
    case BtStatusOff:
        return "off";
    case BtStatusAdvertising:
        return "advertising";
    case BtStatusConnected:
        return "connected";
    }
    return "?";
}

/** Log Keystrokes is shown only with debug logging on, or in the debug build. */
static size_t rk_app_menu_count(const RkApp* app) {
    return (app->debug_logging || RK_DEBUG_BUILD) ? RkMenuItemCount : RkMenuItemLogKeys;
}

static void rk_app_draw_main(Canvas* canvas, RkApp* app) {
    if(RK_DEBUG_BUILD) {
        // The debug build shows live state
        char line[32];
        canvas_draw_str(canvas, 2, 24, "USB serial, not typing");
        snprintf(line, sizeof(line), "BT: %s", rk_bt_status_name(app->bt_status));
        canvas_draw_str(canvas, 2, 35, line);
        snprintf(
            line,
            sizeof(line),
            "Wr %lu  Rep %lu  Drop %lu",
            app->shown_stats.writes,
            app->shown_stats.reports,
            app->shown_stats.dropped);
        canvas_draw_str(canvas, 2, 46, line);
    } else {
        // Only what is connected, never what is typed. The demo build is in
        // serial mode, and shows USB as the target would see it.
        bool usb_connected = RK_DEMO_BUILD || app->usb_connected;
        canvas_set_font(canvas, FontPrimary);
        canvas_draw_str(canvas, 2, 26, usb_connected ? "USB: connected" : "USB: not connected");
        canvas_draw_str(canvas, 2, 38, app->bt_connected ? "BT: connected" : "BT: not connected");
        canvas_set_font(canvas, FontSecondary);
        if(!app->bt_connected) {
            canvas_draw_str(canvas, 2, 50, "Connect from the web client.");
        } else if(!usb_connected) {
            canvas_draw_str(canvas, 2, 50, "Plug into a computer.");
        } else {
            canvas_draw_str(canvas, 2, 50, "Type from the web client.");
        }
    }
    canvas_draw_str(canvas, 2, 62, "OK: menu   Back: exit");

    // What is being logged, so keystroke logging is never on unnoticed
    const char* logging = app->log_keys ? "KEYS" : app->debug_logging ? "LOG" : NULL;
    if(logging) canvas_draw_str_aligned(canvas, 126, 62, AlignRight, AlignBottom, logging);
}

static void rk_app_draw_menu(Canvas* canvas, RkApp* app) {
    const char* labels[RkMenuItemCount] = {
        [RkMenuItemForget] = "Forget paired devices",
        [RkMenuItemDebugLogging] = app->debug_logging ? "Debug logging: On" : "Debug logging: Off",
        [RkMenuItemLogKeys] = app->log_keys ? "Log keystrokes: On" : "Log keystrokes: Off",
    };
    for(size_t i = 0; i < rk_app_menu_count(app); i++) {
        int32_t y = 15 + 13 * i;
        if(i == app->menu_item) {
            canvas_draw_box(canvas, 0, y, 128, 13);
            canvas_set_color(canvas, ColorWhite);
        }
        canvas_draw_str(canvas, 4, y + 10, labels[i]);
        canvas_set_color(canvas, ColorBlack);
    }
    canvas_draw_str(canvas, 2, 62, "OK: select   Back: return");
}

static void rk_app_draw_callback(Canvas* canvas, void* context) {
    RkApp* app = context;
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 12, RK_DEBUG_BUILD ? "Remote Keyboard DEBUG" : "Remote Keyboard");
    canvas_set_font(canvas, FontSecondary);

    switch(app->screen) {
    case RkScreenMain:
        rk_app_draw_main(canvas, app);
        break;
    case RkScreenMenu:
        rk_app_draw_menu(canvas, app);
        break;
    case RkScreenConfirmForget:
        canvas_draw_str(canvas, 2, 26, "Forget all paired devices?");
        canvas_draw_str(canvas, 2, 37, "They must pair again");
        canvas_draw_str(canvas, 2, 48, "with a PIN.");
        canvas_draw_str(canvas, 2, 62, "OK: forget   Back: cancel");
        break;
    case RkScreenMessage:
        canvas_draw_str(canvas, 2, 32, app->message);
        break;
    }

    furi_mutex_release(app->screen_mutex);
}

static void rk_app_input_callback(InputEvent* event, void* context) {
    RkApp* app = context;
    furi_message_queue_put(app->input_queue, event, 0);
}

static void rk_app_set_screen(RkApp* app, RkScreen screen) {
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);
    app->screen = screen;
    furi_mutex_release(app->screen_mutex);
    view_port_update(app->view_port);
}

/** Set a bool of the screen state and redraw. */
static void rk_app_set_flag(RkApp* app, bool* flag, bool value) {
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);
    *flag = value;
    furi_mutex_release(app->screen_mutex);
    view_port_update(app->view_port);
}

static void rk_app_show_message(RkApp* app, const char* message) {
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);
    app->screen = RkScreenMessage;
    app->message = message;
    app->message_until = furi_get_tick() + furi_ms_to_ticks(RK_MESSAGE_SHOW_MS);
    furi_mutex_release(app->screen_mutex);
    view_port_update(app->view_port);
}

static void rk_app_update_message(RkApp* app) {
    if(app->screen != RkScreenMessage) return;
    if((int32_t)(furi_get_tick() - app->message_until) < 0) return;
    rk_app_set_screen(app, RkScreenMain);
}

static void rk_app_rx_callback(const uint8_t* data, uint16_t size, void* context) {
    RkApp* app = context;
    rk_worker_rx(app->worker, data, size);
}

static void rk_app_bt_status_callback(BtStatus status, void* context) {
    RkApp* app = context;
    bool connected = (status == BtStatusConnected);
    if(status != app->bt_status) FURI_LOG_I(TAG, "Bluetooth: %s", rk_bt_status_name(status));
    if(app->bt_connected && !connected) {
        rk_worker_client_disconnected(app->worker);
    }
    app->bt_connected = connected;
    app->bt_status = status;
    view_port_update(app->view_port);
}

/** Called from the USB interrupt: only signals the worker (the screen polls USB). */
static void rk_app_hid_state_callback(bool state, void* context) {
    RkApp* app = context;
    if(!state) rk_worker_host_disconnected(app->worker);
}

/** Show and log USB host changes. Polled, because the HID callback runs in an interrupt. */
static void rk_app_poll_usb(RkApp* app) {
    if(RK_USB_SERIAL_BUILD) return;
    bool connected = furi_hal_hid_is_connected();
    if(connected == app->usb_connected) return;
    FURI_LOG_I(TAG, "USB: host %s", connected ? "connected" : "disconnected");
    rk_app_set_flag(app, &app->usb_connected, connected);
}

static void rk_app_forget_devices(RkApp* app) {
    // Same sequence as the stock HID app's "Remove pairing"
    bt_disconnect(app->bt);
    furi_delay_ms(RK_BT_SETTLE_MS);
    furi_hal_bt_stop_advertising();
    // Deletes the app's key file, because it is the active storage path
    bt_forget_bonded_devices(app->bt);
    furi_hal_bt_start_advertising();
    FURI_LOG_I(TAG, "Forgot all paired devices");
    rk_app_show_message(app, "Paired devices forgotten");
}

/** First lines of a debug log: versions and the current state. */
static void rk_app_log_state(RkApp* app) {
    const Version* firmware = furi_hal_version_get_firmware_version();
    FURI_LOG_I(
        TAG,
        "Remote Keyboard %d.%d, %s build, firmware %s (%s), Flipper %s",
        RK_VERSION_MAJOR,
        RK_VERSION_MINOR,
        RK_BUILD_NAME,
        version_get_version(firmware),
        version_get_githash(firmware),
        furi_hal_version_get_name_ptr());

    const char* usb = RK_USB_SERIAL_BUILD ? "serial, not typing" :
                      app->usb_connected  ? "host connected" :
                                            "no host";
    FURI_LOG_I(TAG, "USB: %s, Bluetooth: %s", usb, rk_bt_status_name(app->bt_status));

    Storage* storage = furi_record_open(RECORD_STORAGE);
    bool paired = storage_file_exists(storage, RK_BT_KEYS_STORAGE_PATH);
    furi_record_close(RECORD_STORAGE);
    FURI_LOG_I(TAG, "Pairing keys file: %s", paired ? "present" : "none");

    RkWorkerStats stats = rk_worker_get_stats(app->worker);
    FURI_LOG_I(
        TAG,
        "Since start: %lu writes, %lu reports, %lu dropped",
        stats.writes,
        stats.reports,
        stats.dropped);
}

/** Keystroke logging: received reports and the key presses they cause. */
static void rk_app_set_log_keys(RkApp* app, bool log_keys) {
    if(log_keys == app->log_keys) return;
    rk_worker_set_log_keys(app->worker, log_keys);
    if(log_keys) {
        FURI_LOG_W(TAG, "Keystroke logging on: received keys are logged, passwords included");
    } else {
        FURI_LOG_I(TAG, "Keystroke logging off");
    }
    rk_app_set_flag(app, &app->log_keys, log_keys);
}

/**
 * Debug logging: everything the Flipper logs is saved to the SD card, to
 * debug a problem afterwards. Not remembered between launches.
 */
static void rk_app_set_debug_logging(RkApp* app, bool debug_logging) {
    if(debug_logging) {
        if(!rk_log_start(app->log)) {
            rk_app_show_message(app, "SD card unavailable");
            return;
        }
        rk_app_set_flag(app, &app->debug_logging, true);
        rk_app_log_state(app);
    } else {
        // The menu entry goes away with debug logging (except in the debug build)
        if(!RK_DEBUG_BUILD) rk_app_set_log_keys(app, false);
        FURI_LOG_I(TAG, "Debug logging off");
        rk_app_set_flag(app, &app->debug_logging, false);
        rk_log_stop(app->log);
    }
}

static RkApp* rk_app_alloc(void) {
    RkApp* app = malloc(sizeof(RkApp));
    memset(app, 0, sizeof(RkApp));

    app->screen_mutex = furi_mutex_alloc(FuriMutexTypeNormal);
    app->input_queue = furi_message_queue_alloc(RK_INPUT_QUEUE_LENGTH, sizeof(InputEvent));
    app->view_port = view_port_alloc();
    view_port_draw_callback_set(app->view_port, rk_app_draw_callback, app);
    view_port_input_callback_set(app->view_port, rk_app_input_callback, app);
    app->gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(app->gui, app->view_port, GuiLayerFullscreen);

    app->worker = rk_worker_alloc();
    app->log = rk_log_alloc();
    return app;
}

static void rk_app_free(RkApp* app) {
    rk_log_free(app->log);
    rk_worker_free(app->worker);

    gui_remove_view_port(app->gui, app->view_port);
    furi_record_close(RECORD_GUI);
    view_port_free(app->view_port);
    furi_message_queue_free(app->input_queue);
    furi_mutex_free(app->screen_mutex);
    free(app);
}

/** Switch USB to HID keyboard mode. */
static bool rk_app_usb_enter_hid(RkApp* app) {
    furi_hal_usb_unlock();
    if(!furi_hal_usb_set_config(&usb_hid, NULL)) {
        FURI_LOG_E(TAG, "Failed to switch USB to HID");
        return false;
    }
    furi_hal_hid_set_state_callback(rk_app_hid_state_callback, app);
    return true;
}

/** Switch USB back to the configuration it had before the app started (serial). */
static void rk_app_usb_leave_hid(RkApp* app) {
    furi_hal_hid_set_state_callback(NULL, NULL);
    furi_check(furi_hal_usb_set_config(app->usb_prev, NULL));
}

/** Startup: start the custom Bluetooth profile with its own bond storage. */
static bool rk_app_bt_start(RkApp* app) {
    app->bt = furi_record_open(RECORD_BT);
    bt_disconnect(app->bt);
    // Wait for the 2nd core to update its storage
    furi_delay_ms(RK_BT_SETTLE_MS);

    bt_keys_storage_set_storage_path(app->bt, RK_BT_KEYS_STORAGE_PATH);
    app->profile = bt_profile_start(app->bt, rk_profile, NULL);
    if(!app->profile) {
        FURI_LOG_E(TAG, "Failed to start BLE profile");
        bt_keys_storage_set_default_path(app->bt);
        furi_check(bt_profile_restore_default(app->bt));
        furi_record_close(RECORD_BT);
        app->bt = NULL;
        return false;
    }
    rk_profile_set_rx_callback(app->profile, rk_app_rx_callback, app);

    furi_hal_bt_start_advertising();
    app->bt_status = BtStatusAdvertising;
    bt_set_status_changed_callback(app->bt, rk_app_bt_status_callback, app);
    return true;
}

/** Exit: restore the default Bluetooth profile and bond storage. */
static void rk_app_bt_stop(RkApp* app) {
    bt_set_status_changed_callback(app->bt, NULL, NULL);
    bt_disconnect(app->bt);
    furi_delay_ms(RK_BT_SETTLE_MS);
    bt_keys_storage_set_default_path(app->bt);
    furi_check(bt_profile_restore_default(app->bt));
    app->profile = NULL;
    furi_record_close(RECORD_BT);
    app->bt = NULL;
}

static void rk_app_menu_move(RkApp* app, int32_t delta) {
    size_t count = rk_app_menu_count(app);
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);
    app->menu_item = (app->menu_item + count + delta) % count;
    furi_mutex_release(app->screen_mutex);
    view_port_update(app->view_port);
}

static void rk_app_menu_select(RkApp* app) {
    switch(app->menu_item) {
    case RkMenuItemForget:
        rk_app_set_screen(app, RkScreenConfirmForget);
        break;
    case RkMenuItemDebugLogging:
        rk_app_set_debug_logging(app, !app->debug_logging);
        break;
    case RkMenuItemLogKeys:
        rk_app_set_log_keys(app, !app->log_keys);
        break;
    case RkMenuItemCount:
        break;
    }
}

/** Handle one input event. @return false when the app should exit */
static bool rk_app_handle_input(RkApp* app, const InputEvent* event) {
    bool press = event->type == InputTypeShort;
    bool step = press || event->type == InputTypeRepeat;

    switch(app->screen) {
    case RkScreenMain:
        if(press && event->key == InputKeyBack) return false;
        if(press && event->key == InputKeyOk) rk_app_set_screen(app, RkScreenMenu);
        break;
    case RkScreenMenu:
        if(step && event->key == InputKeyUp) rk_app_menu_move(app, -1);
        if(step && event->key == InputKeyDown) rk_app_menu_move(app, 1);
        if(press && event->key == InputKeyBack) rk_app_set_screen(app, RkScreenMain);
        if(press && event->key == InputKeyOk) rk_app_menu_select(app);
        break;
    case RkScreenConfirmForget:
        if(press && event->key == InputKeyOk) rk_app_forget_devices(app);
        if(press && event->key == InputKeyBack) rk_app_set_screen(app, RkScreenMenu);
        break;
    case RkScreenMessage:
        if(press && (event->key == InputKeyOk || event->key == InputKeyBack)) {
            rk_app_set_screen(app, RkScreenMain);
        }
        break;
    }
    return true;
}

static void rk_app_run(RkApp* app) {
    InputEvent event;
    while(true) {
        if(furi_message_queue_get(app->input_queue, &event, furi_ms_to_ticks(RK_INPUT_POLL_MS)) ==
           FuriStatusOk) {
            if(!rk_app_handle_input(app, &event)) break;
        }

        rk_app_update_message(app);
        rk_app_poll_usb(app);

        if(RK_DEBUG_BUILD) {
            RkWorkerStats stats = rk_worker_get_stats(app->worker);
            if(memcmp(&stats, &app->shown_stats, sizeof(stats)) != 0) {
                app->shown_stats = stats;
                view_port_update(app->view_port);
            }
        }
    }
}

int32_t remote_keyboard_app(void* p) {
    UNUSED(p);

    RkApp* app = rk_app_alloc();
    // Start the worker before any callback can signal it
    rk_worker_start(app->worker);
    FURI_LOG_I(TAG, "Start: %s build", RK_BUILD_NAME);

    // The debug and demo builds leave USB in serial mode (docs/flipper-app.md#build-variants)
    app->usb_prev = furi_hal_usb_get_config();
    bool usb_started = RK_USB_SERIAL_BUILD || rk_app_usb_enter_hid(app);
    bool bt_started = usb_started && rk_app_bt_start(app);

    if(bt_started) {
        rk_app_run(app);
    } else {
        rk_app_show_message(app, usb_started ? "Bluetooth unavailable" : "USB unavailable");
        furi_delay_ms(RK_MESSAGE_SHOW_MS);
    }

    // Exit order matters (docs/flipper-app.md). Stopping the worker releases all keys.
    rk_worker_stop(app->worker);
    if(bt_started) rk_app_bt_stop(app);
    if(usb_started && !RK_USB_SERIAL_BUILD) rk_app_usb_leave_hid(app);
    if(app->debug_logging) {
        FURI_LOG_I(TAG, "Exit");
        rk_log_stop(app->log);
    }

    rk_app_free(app);
    return 0;
}
