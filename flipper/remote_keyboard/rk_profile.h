#pragma once

/*
 * Custom BLE profile with one write-only Key Report characteristic (docs/bluetooth-protocol.md).
 */

#include <furi_ble/profile_interface.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Called from the BLE thread for every write to the Key Report characteristic. */
typedef void (*RkProfileRxCallback)(const uint8_t* data, uint16_t size, void* context);

/** Profile template, to pass to bt_profile_start(). */
extern const FuriHalBleProfileTemplate* const rk_profile;

/**
 * Set the receive callback. Must be called before advertising starts.
 *
 * @param profile   instance returned by bt_profile_start()
 * @param callback  callback, or NULL to drop all writes
 * @param context   passed to callback
 */
void rk_profile_set_rx_callback(
    FuriHalBleProfileBase* profile,
    RkProfileRxCallback callback,
    void* context);

#ifdef __cplusplus
}
#endif
