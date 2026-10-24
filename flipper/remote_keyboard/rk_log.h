#pragma once

/*
 * Debug logging: saves the Flipper's log to the SD card (docs/flipper-app.md#debug-logging).
 */

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RkLog RkLog;

RkLog* rk_log_alloc(void);

/** The log must be stopped. */
void rk_log_free(RkLog* log);

/**
 * Start saving everything the Flipper logs, from all apps and services, to the
 * log file. Raises the log level to Info if it is lower.
 *
 * @return false if the log file could not be opened
 */
bool rk_log_start(RkLog* log);

/** Write what is buffered, close the file and restore the log level. */
void rk_log_stop(RkLog* log);

#ifdef __cplusplus
}
#endif
