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
    uint32_t reports; /* Reports applied to USB (logged instead, in debug mode) */
    uint32_t dropped; /* Invalid writes, plus writes cut short by a full queue */
} RkWorkerStats;

RkWorker* rk_worker_alloc(void);

void rk_worker_free(RkWorker* worker);

void rk_worker_start(RkWorker* worker);

/** Stop the thread, wait for it to exit, and release all keys. */
void rk_worker_stop(RkWorker* worker);

/**
 * Switch debug mode: log reports and the key presses they would cause instead of
 * calling USB HID. Releases held keys and clears the queue first. Call before
 * leaving HID mode, and after entering it.
 */
void rk_worker_set_debug(RkWorker* worker, bool debug);

/** Counters, for the debug screen. */
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
