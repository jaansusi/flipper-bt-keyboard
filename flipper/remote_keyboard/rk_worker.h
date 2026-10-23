#pragma once

/*
 * Report queue and USB apply thread (SPEC §6.3–§6.5).
 */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RkWorker RkWorker;

RkWorker* rk_worker_alloc(void);

void rk_worker_free(RkWorker* worker);

void rk_worker_start(RkWorker* worker);

/** Stop the thread and wait for it to exit. */
void rk_worker_stop(RkWorker* worker);

/**
 * Validate a GATT write and queue its reports (SPEC §6.3.1).
 * Safe to call from the BLE thread; never blocks.
 */
void rk_worker_rx(RkWorker* worker, const uint8_t* data, uint16_t size);

/** Client disconnected: drop queued reports and release all keys (SPEC §6.4). */
void rk_worker_client_disconnected(RkWorker* worker);

/** USB host disconnected: drop queued reports and reset state (SPEC §6.5). ISR-safe. */
void rk_worker_host_disconnected(RkWorker* worker);

#ifdef __cplusplus
}
#endif
