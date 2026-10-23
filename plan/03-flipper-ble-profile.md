# Step 03 — Flipper Bluetooth LE profile

**Depends on:** 02
**Spec:** §3, §4.1–§4.5, §6.2 steps 4–8, §6.6 (forget devices), §6.7 steps 3–6

## Goal

The app advertises its own Bluetooth LE service with one write-only
characteristic. Clients must pair with a PIN shown on the Flipper before their
writes are accepted. Received writes are counted but not yet typed.

## Tasks

### Profile and service (`rk_profile.c/.h`)

- [ ] Define the service and characteristic UUIDs from SPEC §4.1 as byte arrays.
      The firmware stores 128-bit UUIDs **little-endian** (reversed byte order),
      as in `serial_service_uuid.inc`.
- [ ] Define a `BleGattCharacteristicParams` for the Key Report characteristic
      with the values in SPEC §4.3 (`CHAR_PROP_WRITE`,
      `ATTR_PERMISSION_AUTHEN_WRITE`, `GATT_NOTIFY_ATTRIBUTE_WRITE`,
      `CHAR_VALUE_LEN_VARIABLE`, max length 16).
- [ ] Service start: `ble_event_dispatcher_register_svc_handler`,
      `ble_gatt_service_add` (128-bit UUID, primary), `ble_gatt_characteristic_init`.
      Service stop: the reverse, as in `serial_service.c`.
- [ ] Event handler: on `ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE` for the
      characteristic's value handle (`handle + 1`), call a callback set by the app
      with `(const uint8_t* data, uint16_t len)` and return
      `BleEventAckFlowEnable`. Return `BleEventNotAck` for all other events.
- [ ] `FuriHalBleProfileTemplate` with `start`, `stop` and `get_gap_config`.
      `get_gap_config` fills `GapConfig` exactly as in SPEC §4.2 (128-bit
      advertised UUID, appearance 0, bonding, `GapPairingPinCodeShow`, MAC with
      byte 2 + 2, the Flipper's own name as the device name (shortened to 5 characters if longer, see SPEC §4.2), connection interval 0x0006–0x000C).
- [ ] Public functions: `rk_profile_set_rx_callback(profile, cb, ctx)`.

### App lifecycle (`remote_keyboard.c`)

- [ ] Startup, after USB (SPEC §6.2 steps 4–8): open `RECORD_BT`, `bt_disconnect`,
      wait 200 ms, `bt_keys_storage_set_storage_path(bt, APP_DATA_PATH(".bt_keys"))`,
      `bt_profile_start(bt, rk_profile, NULL)`, `furi_hal_bt_start_advertising()`,
      `bt_set_status_changed_callback(...)`. On profile start failure, restore the
      key path and USB config and exit with an error screen.
- [ ] Exit, before USB restore (SPEC §6.7 steps 3–6): clear status callback,
      `bt_disconnect`, wait 200 ms, `bt_keys_storage_set_default_path`,
      `bt_profile_restore_default`.
- [ ] Replace the OK-hold placeholder from step 02 with
      `bt_forget_bonded_devices(bt)`.
- [ ] Temporary: the RX callback increments a counter and the length of the last
      write, readable only in the debug build (`FURI_LOG_D` of the length, never
      the content — SPEC §6.8).

## Done when

Test with nRF Connect (Android or iOS) or `bluetoothctl`:

- The Flipper advertises under its own name with the custom service UUID.
- Connecting and writing 8 bytes to the characteristic without pairing fails
  with an authentication error, and the debug counter does not change.
- After pairing (the Flipper shows a 6-digit PIN, entered on the phone), writes
  of 8 and 16 bytes succeed and the counter goes up.
- The characteristic cannot be read and has no notify/indicate property.
- The Flipper mobile app, paired before this step, cannot write to the
  characteristic.
- Holding OK for 3 s, then reconnecting from the paired phone, requires pairing
  again.
- Exiting the app: the Flipper mobile app can connect to the Flipper again as
  before.
- `/ext/apps_data/remote_keyboard/.bt_keys` exists after pairing.
