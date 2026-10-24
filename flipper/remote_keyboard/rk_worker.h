#pragma once

/*
 * Report queue and USB apply thread (docs/flipper-app.md).
 */

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RkWorker RkWorker;

typedef struct {
    uint32_t writes; /* Valid GATT writes received */
    uint32_t reports; /* Reports applied to USB (not typed in debug and demo builds) */
    uint32_t dropped; /* Invalid writes, plus writes cut short by a full queue */
} RkWorkerStats;

RkWorker* rk_worker_alloc(void);

void rk_worker_free(RkWorker* worker);

void rk_worker_start(RkWorker* worker);

/** Stop the thread, wait for it to exit, and release all keys. */
void rk_worker_stop(RkWorker* worker);

/** Switch keystroke logging: log each report and the key presses it causes. */
void rk_worker_set_log_keys(RkWorker* worker, bool log_keys);

/** Counters, for the debug build's screen. */
RkWorkerStats rk_worker_get_stats(RkWorker* worker);

/**
 * Validate a GATT write and queue its reports.
 * Safe to call from the BLE thread; never blocks.
 */
void rk_worker_rx(RkWorker* worker, const uint8_t* data, uint16_t size);

/** Client disconnected: drop queued reports and release all keys. */
void rk_worker_client_disconnected(RkWorker* worker);

/** USB host disconnected: drop queued reports and reset state. ISR-safe. */
void rk_worker_host_disconnected(RkWorker* worker);

#ifdef __cplusplus
}
#endif
