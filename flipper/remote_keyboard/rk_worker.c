#include "rk_worker.h"
#include "rk_build.h"
#include "rk_report.h"

#include <furi.h>
#include <furi_hal_usb_hid.h>

#define TAG "RkWorker"

#define RK_QUEUE_CAPACITY        (512)
#define RK_WORKER_STACK_SIZE     (1024)
#define RK_REPORT_MIN_TIME_MS    (8)
#define RK_RESEND_WINDOW_MS      (50)
#define RK_QUEUE_POLL_TIMEOUT_MS (20)

typedef enum {
    RkWorkerFlagStop = (1 << 0),
    RkWorkerFlagClientDisconnected = (1 << 1),
    RkWorkerFlagHostDisconnected = (1 << 2),
} RkWorkerFlag;

#define RK_WORKER_FLAGS_ALL \
    (RkWorkerFlagStop | RkWorkerFlagClientDisconnected | RkWorkerFlagHostDisconnected)

struct RkWorker {
    FuriThread* thread;
    FuriMessageQueue* queue;
    // Held while touching USB HID, `current` or `log_keys`, so keystroke logging
    // can be switched safely while reports are being applied
    FuriMutex* lock;
    RkReport current;
    RkWorkerStats stats;
    bool log_keys;
};

/*
 * Debug and demo builds: USB stays in serial mode, so HID calls are skipped.
 * The host counts as always connected, so the whole receive/apply path (diff
 * order, pacing) runs as in the release build. Report contents are only ever
 * logged with keystroke logging on.
 */
static const char* const rk_action_names[] = {
    [RkActionReleaseKey] = "release key",
    [RkActionReleaseMod] = "release mod",
    [RkActionPressMod] = "press mod",
    [RkActionPressKey] = "press key",
};

static bool rk_worker_call(RkWorker* worker, const RkAction* action) {
    if(worker->log_keys) {
        FURI_LOG_I(TAG, "  %s 0x%02X", rk_action_names[action->type], action->value);
    }
    if(RK_USB_SERIAL_BUILD) return true;
    switch(action->type) {
    case RkActionReleaseKey:
        return furi_hal_hid_kb_release(action->value);
    case RkActionReleaseMod:
        return furi_hal_hid_kb_release((uint16_t)action->value << 8);
    case RkActionPressMod:
        return furi_hal_hid_kb_press((uint16_t)action->value << 8);
    case RkActionPressKey:
        return furi_hal_hid_kb_press(action->value);
    }
    return false;
}

static bool rk_worker_host_connected(void) {
    return RK_USB_SERIAL_BUILD || furi_hal_hid_is_connected();
}

static void rk_worker_release_all(void) {
    if(!RK_USB_SERIAL_BUILD) furi_hal_hid_kb_release_all();
}

static void rk_worker_log_stats(RkWorker* worker) {
    FURI_LOG_I(
        TAG,
        "Since start: %lu writes, %lu reports, %lu dropped",
        worker->stats.writes,
        worker->stats.reports,
        worker->stats.dropped);
}

static void rk_worker_log_report(RkWorker* worker, const RkReport* report, size_t action_count) {
    if(!worker->log_keys) return;
    const uint8_t* k = report->keys;
    FURI_LOG_I(
        TAG,
        "Report: mods %02X keys %02X %02X %02X %02X %02X %02X (%u actions)",
        report->mods,
        k[0],
        k[1],
        k[2],
        k[3],
        k[4],
        k[5],
        (unsigned)action_count);
}

static void rk_worker_apply(RkWorker* worker, const RkReport* next) {
    uint32_t started = furi_get_tick();

    furi_check(furi_mutex_acquire(worker->lock, FuriWaitForever) == FuriStatusOk);
    RkAction actions[RK_DIFF_ACTION_MAX];
    size_t count = rk_report_diff(&worker->current, next, actions);
    rk_worker_log_report(worker, next, count);
    bool delivered = true;
    for(size_t i = 0; i < count; i++) {
        if(!rk_worker_call(worker, &actions[i])) delivered = false;
    }
    worker->current = *next;
    worker->stats.reports++;

    // A failed call still updated the firmware's report state; send it again.
    // Pressing HID_KEYBOARD_NONE changes nothing and re-sends the current report.
    if(!delivered) {
        bool resent = false;
        while(!resent && furi_hal_hid_is_connected() &&
              (furi_get_tick() - started) < furi_ms_to_ticks(RK_RESEND_WINDOW_MS)) {
            resent = furi_hal_hid_kb_press(HID_KEYBOARD_NONE);
            if(!resent) furi_delay_ms(1);
        }
        FURI_LOG_W(TAG, "USB send failed; report %s", resent ? "resent" : "lost");
    }
    furi_mutex_release(worker->lock);

    uint32_t elapsed = furi_get_tick() - started;
    uint32_t min_time = furi_ms_to_ticks(RK_REPORT_MIN_TIME_MS);
    if(elapsed < min_time) furi_delay_tick(min_time - elapsed);
}

static void rk_worker_reset(RkWorker* worker, bool release_keys) {
    furi_check(furi_mutex_acquire(worker->lock, FuriWaitForever) == FuriStatusOk);
    furi_message_queue_reset(worker->queue);
    if(release_keys) rk_worker_release_all();
    memset(&worker->current, 0, sizeof(worker->current));
    furi_mutex_release(worker->lock);
}

static int32_t rk_worker_thread(void* context) {
    RkWorker* worker = context;

    while(true) {
        uint32_t flags = furi_thread_flags_get();
        if(flags & RK_WORKER_FLAGS_ALL) {
            furi_thread_flags_clear(flags & RK_WORKER_FLAGS_ALL);
            if(flags & RkWorkerFlagStop) break;
            if(flags & RkWorkerFlagClientDisconnected) {
                FURI_LOG_I(TAG, "Client disconnected: queue cleared, keys released");
                rk_worker_reset(worker, true);
                rk_worker_log_stats(worker);
            } else if(flags & RkWorkerFlagHostDisconnected) {
                FURI_LOG_I(TAG, "USB host disconnected: queue cleared");
                rk_worker_reset(worker, false);
            }
            continue;
        }

        RkReport next;
        if(furi_message_queue_get(
               worker->queue, &next, furi_ms_to_ticks(RK_QUEUE_POLL_TIMEOUT_MS)) != FuriStatusOk) {
            continue;
        }

        // A disconnect may have arrived while waiting; handle it first.
        if(furi_thread_flags_get() & RK_WORKER_FLAGS_ALL) continue;

        // Nothing can be typed without a host; drop the report.
        if(!rk_worker_host_connected()) continue;

        rk_worker_apply(worker, &next);
    }

    return 0;
}

RkWorker* rk_worker_alloc(void) {
    RkWorker* worker = malloc(sizeof(RkWorker));
    memset(worker, 0, sizeof(RkWorker));
    worker->queue = furi_message_queue_alloc(RK_QUEUE_CAPACITY, sizeof(RkReport));
    worker->lock = furi_mutex_alloc(FuriMutexTypeNormal);
    worker->thread = furi_thread_alloc_ex(TAG, RK_WORKER_STACK_SIZE, rk_worker_thread, worker);
    return worker;
}

void rk_worker_free(RkWorker* worker) {
    furi_check(worker);
    furi_thread_free(worker->thread);
    furi_mutex_free(worker->lock);
    furi_message_queue_free(worker->queue);
    free(worker);
}

void rk_worker_start(RkWorker* worker) {
    furi_check(worker);
    furi_thread_start(worker->thread);
}

void rk_worker_stop(RkWorker* worker) {
    furi_check(worker);
    furi_thread_flags_set(furi_thread_get_id(worker->thread), RkWorkerFlagStop);
    furi_thread_join(worker->thread);
    rk_worker_reset(worker, true);
    rk_worker_log_stats(worker);
}

void rk_worker_set_log_keys(RkWorker* worker, bool log_keys) {
    furi_check(worker);
    furi_check(furi_mutex_acquire(worker->lock, FuriWaitForever) == FuriStatusOk);
    worker->log_keys = log_keys;
    furi_mutex_release(worker->lock);
}

RkWorkerStats rk_worker_get_stats(RkWorker* worker) {
    furi_check(worker);
    return worker->stats;
}

void rk_worker_rx(RkWorker* worker, const uint8_t* data, uint16_t size) {
    // Invalid writes are dropped whole
    if(!rk_write_is_valid(data, size)) {
        worker->stats.dropped++;
        FURI_LOG_W(TAG, "Dropped invalid write of %u bytes", size);
        return;
    }
    worker->stats.writes++;

    for(uint16_t offset = 0; offset < size; offset += RK_REPORT_SIZE) {
        RkReport report;
        rk_report_from_bytes(&report, &data[offset]);
        // Queue full: drop this report and the rest of the write
        if(furi_message_queue_put(worker->queue, &report, 0) != FuriStatusOk) {
            worker->stats.dropped++;
            FURI_LOG_W(TAG, "Queue full: dropped the rest of a write");
            break;
        }
    }
}

void rk_worker_client_disconnected(RkWorker* worker) {
    furi_check(worker);
    furi_thread_flags_set(furi_thread_get_id(worker->thread), RkWorkerFlagClientDisconnected);
}

void rk_worker_host_disconnected(RkWorker* worker) {
    furi_check(worker);
    furi_thread_flags_set(furi_thread_get_id(worker->thread), RkWorkerFlagHostDisconnected);
}
