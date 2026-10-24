#include "rk_profile.h"
#include "rk_worker.h"

#include <furi.h>
#include <furi_hal_usb.h>
#include <furi_hal_usb_hid.h>
#include <furi_hal_bt.h>
#include <bt/bt_service/bt.h>
#include <gui/gui.h>
#include <storage/storage.h>

#define TAG "RemoteKeyboard"

#define RK_BT_KEYS_STORAGE_PATH APP_DATA_PATH(".bt_keys")

#define RK_FORGET_HOLD_MS     (3000)
#define RK_MESSAGE_SHOW_MS    (2000)
#define RK_BT_SETTLE_MS       (200)
#define RK_INPUT_POLL_MS      (100)
#define RK_INPUT_QUEUE_LENGTH (8)

typedef enum {
    RkScreenMain,
    RkScreenMessage,
} RkScreen;

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* input_queue;

    FuriHalUsbInterface* usb_prev;
    Bt* bt;
    FuriHalBleProfileBase* profile;
    RkWorker* worker;
    bool bt_connected;

    FuriMutex* screen_mutex;
    RkScreen screen;
    const char* message;
    uint32_t message_until;

    bool ok_held;
    uint32_t ok_pressed_at;
} RkApp;

static void rk_app_draw_callback(Canvas* canvas, void* context) {
    RkApp* app = context;
    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);

    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str(canvas, 2, 12, "Remote Keyboard");
    canvas_set_font(canvas, FontSecondary);

    // Static text only: no connection state or received data
    if(app->screen == RkScreenMessage) {
        canvas_draw_str(canvas, 2, 32, app->message);
    } else {
        canvas_draw_str(canvas, 2, 26, "Pair or connect from");
        canvas_draw_str(canvas, 2, 37, "the web client.");
        canvas_draw_str(canvas, 2, 51, "Hold OK: forget devices");
        canvas_draw_str(canvas, 2, 62, "Back: exit");
    }

    furi_mutex_release(app->screen_mutex);
}

static void rk_app_input_callback(InputEvent* event, void* context) {
    RkApp* app = context;
    furi_message_queue_put(app->input_queue, event, 0);
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

    furi_check(furi_mutex_acquire(app->screen_mutex, FuriWaitForever) == FuriStatusOk);
    app->screen = RkScreenMain;
    furi_mutex_release(app->screen_mutex);
    view_port_update(app->view_port);
}

static void rk_app_rx_callback(const uint8_t* data, uint16_t size, void* context) {
    RkApp* app = context;
    rk_worker_rx(app->worker, data, size);
}

static void rk_app_bt_status_callback(BtStatus status, void* context) {
    RkApp* app = context;
    bool connected = (status == BtStatusConnected);
    if(app->bt_connected && !connected) {
        rk_worker_client_disconnected(app->worker);
    }
    app->bt_connected = connected;
}

static void rk_app_hid_state_callback(bool state, void* context) {
    RkApp* app = context;
    if(!state) rk_worker_host_disconnected(app->worker);
}

static void rk_app_forget_devices(RkApp* app) {
    // Same sequence as the stock HID app's "Remove pairing"
    bt_disconnect(app->bt);
    furi_delay_ms(RK_BT_SETTLE_MS);
    furi_hal_bt_stop_advertising();
    // Deletes the app's key file, because it is the active storage path
    bt_forget_bonded_devices(app->bt);
    furi_hal_bt_start_advertising();
    rk_app_show_message(app, "Paired devices forgotten");
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
    return app;
}

static void rk_app_free(RkApp* app) {
    rk_worker_free(app->worker);

    gui_remove_view_port(app->gui, app->view_port);
    furi_record_close(RECORD_GUI);
    view_port_free(app->view_port);
    furi_message_queue_free(app->input_queue);
    furi_mutex_free(app->screen_mutex);
    free(app);
}

/** Startup: switch USB to HID keyboard mode. */
static bool rk_app_usb_start(RkApp* app) {
#ifdef RK_DEBUG_KEEP_USB_CDC
    // Debug builds only: keep the USB serial CLI so `log debug` works while
    // the app runs. Nothing is typed in this mode.
    UNUSED(app);
    FURI_LOG_W(TAG, "Debug build: USB stays in CDC mode");
    return true;
#endif
    app->usb_prev = furi_hal_usb_get_config();
    furi_hal_usb_unlock();
    if(!furi_hal_usb_set_config(&usb_hid, NULL)) {
        FURI_LOG_E(TAG, "Failed to switch USB to HID");
        return false;
    }
    furi_hal_hid_set_state_callback(rk_app_hid_state_callback, app);
    return true;
}

/** Exit: restore the previous USB configuration. */
static void rk_app_usb_stop(RkApp* app) {
#ifdef RK_DEBUG_KEEP_USB_CDC
    UNUSED(app);
    return;
#endif
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

static void rk_app_run(RkApp* app) {
    InputEvent event;
    while(true) {
        if(furi_message_queue_get(
               app->input_queue, &event, furi_ms_to_ticks(RK_INPUT_POLL_MS)) == FuriStatusOk) {
            if(event.key == InputKeyBack && event.type == InputTypeShort) break;

            if(event.key == InputKeyOk) {
                if(event.type == InputTypePress) {
                    app->ok_held = true;
                    app->ok_pressed_at = furi_get_tick();
                } else if(event.type == InputTypeRelease) {
                    app->ok_held = false;
                }
            }
        }

        if(app->ok_held &&
           (furi_get_tick() - app->ok_pressed_at) >= furi_ms_to_ticks(RK_FORGET_HOLD_MS)) {
            // Fire once per hold
            app->ok_held = false;
            rk_app_forget_devices(app);
        }

        rk_app_update_message(app);
    }
}

int32_t remote_keyboard_app(void* p) {
    UNUSED(p);

    RkApp* app = rk_app_alloc();
    // Start the worker before any callback can signal it
    rk_worker_start(app->worker);

#ifdef RK_DEBUG_KEEP_USB_CDC
    // Time to attach `log debug` after `ufbt launch` returns
    furi_delay_ms(5000);
#endif
    bool usb_started = rk_app_usb_start(app);
    bool bt_started = usb_started && rk_app_bt_start(app);

    if(bt_started) {
        rk_app_run(app);
    } else {
        rk_app_show_message(app, usb_started ? "Bluetooth unavailable" : "USB unavailable");
        furi_delay_ms(RK_MESSAGE_SHOW_MS);
    }

    // Exit order matters (docs/flipper-app.md)
    rk_worker_stop(app->worker);
    if(usb_started) furi_hal_hid_kb_release_all();
    if(bt_started) rk_app_bt_stop(app);
    if(usb_started) rk_app_usb_stop(app);

    rk_app_free(app);
    return 0;
}
