#include "rk_profile.h"
#include "rk_report.h"

#include <furi.h>
#include <furi_ble/event_dispatcher.h>
#include <furi_ble/gatt.h>
#include <furi_hal_version.h>
#include <ble/core/ble_defs.h>
#include <ble/core/ble_std.h>

#define TAG "RkProfile"

/* UUIDs from SPEC §4.1, stored little-endian as the BLE stack expects. */

/* ff6ad5ee-6d0c-4067-9f0b-25935584962d */
#define RK_SERVICE_UUID \
    {0x2d, 0x96, 0x84, 0x55, 0x93, 0x25, 0x0b, 0x9f, 0x67, 0x40, 0x0c, 0x6d, 0xee, 0xd5, 0x6a, 0xff}

/* 82e449f4-1910-47dd-bb18-a697f0e81a9c */
#define RK_KEY_REPORT_CHAR_UUID \
    {0x9c, 0x1a, 0xe8, 0xf0, 0x97, 0xa6, 0x18, 0xbb, 0xdd, 0x47, 0x10, 0x19, 0xf4, 0x49, 0xe4, 0x82}

/* Name characters that fit in advertising data next to the 128-bit UUID */
#define RK_ADV_NAME_CHARS_MAX (5)
/* AD type byte + name characters + terminating NUL */
#define RK_ADV_NAME_SIZE_MAX  (1 + RK_ADV_NAME_CHARS_MAX + 1)

/* Service declaration + characteristic declaration + characteristic value */
#define RK_SERVICE_MAX_ATTRIBUTES (4)

/* 7.5 ms and 15 ms in 1.25 ms units (SPEC §4.2) */
#define RK_CONNECTION_INTERVAL_MIN (0x0006)
#define RK_CONNECTION_INTERVAL_MAX (0x000C)

/*
 * HCI event layouts. The SDK does not export the BLE stack's packet headers
 * (hci_uart_pckt, hci_event_pckt, evt_blecore_aci), so mirror them here.
 * The event payload itself (aci_gatt_attribute_modified_event_rp0) comes
 * from ble_types.h.
 */
typedef struct __attribute__((packed)) {
    uint8_t type;
    uint8_t data[];
} RkHciUartPacket;

typedef struct __attribute__((packed)) {
    uint8_t evt;
    uint8_t plen;
    uint8_t data[];
} RkHciEventPacket;

typedef struct __attribute__((packed)) {
    uint16_t ecode;
    uint8_t data[];
} RkBlecoreAciEvent;

#define RK_ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE (0x0C01U)

typedef struct {
    FuriHalBleProfileBase base;

    uint16_t svc_handle;
    BleGattCharacteristicInstance key_report_char;
    GapSvcEventHandler* event_handler;

    RkProfileRxCallback rx_callback;
    void* rx_context;
} RkProfile;
_Static_assert(offsetof(RkProfile, base) == 0, "Wrong layout");

static const Service_UUID_t rk_service_uuid = {.Service_UUID_128 = RK_SERVICE_UUID};

static const BleGattCharacteristicParams rk_key_report_char_params = {
    .name = "Key Report",
    .data_prop_type = FlipperGattCharacteristicDataFixed,
    .data.fixed.length = RK_WRITE_SIZE_MAX,
    .uuid.Char_UUID_128 = RK_KEY_REPORT_CHAR_UUID,
    .uuid_type = UUID_TYPE_128,
    .char_properties = CHAR_PROP_WRITE,
    .security_permissions = ATTR_PERMISSION_AUTHEN_WRITE,
    .gatt_evt_mask = GATT_NOTIFY_ATTRIBUTE_WRITE,
    .is_variable = CHAR_VALUE_LEN_VARIABLE,
};

static BleEventAckStatus rk_profile_event_handler(void* event, void* context) {
    RkProfile* profile = context;

    RkHciEventPacket* event_pckt = (RkHciEventPacket*)((RkHciUartPacket*)event)->data;
    if(event_pckt->evt != HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE) return BleEventNotAck;

    RkBlecoreAciEvent* blecore_evt = (RkBlecoreAciEvent*)event_pckt->data;
    if(blecore_evt->ecode != RK_ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE) return BleEventNotAck;

    aci_gatt_attribute_modified_event_rp0* attribute_modified =
        (aci_gatt_attribute_modified_event_rp0*)blecore_evt->data;
    if(attribute_modified->Attr_Handle != profile->key_report_char.handle + 1) {
        return BleEventNotAck;
    }

    // Never log the data itself (SPEC §6.8)
    FURI_LOG_T(TAG, "Write of %u bytes", attribute_modified->Attr_Data_Length);
    if(profile->rx_callback) {
        profile->rx_callback(
            attribute_modified->Attr_Data,
            attribute_modified->Attr_Data_Length,
            profile->rx_context);
    }
    return BleEventAckFlowEnable;
}

static FuriHalBleProfileBase* rk_profile_start(FuriHalBleProfileParams profile_params) {
    UNUSED(profile_params);

    RkProfile* profile = malloc(sizeof(RkProfile));
    profile->base.config = rk_profile;

    if(!ble_gatt_service_add(
           UUID_TYPE_128,
           &rk_service_uuid,
           PRIMARY_SERVICE,
           RK_SERVICE_MAX_ATTRIBUTES,
           &profile->svc_handle)) {
        free(profile);
        return NULL;
    }
    ble_gatt_characteristic_init(
        profile->svc_handle, &rk_key_report_char_params, &profile->key_report_char);
    profile->event_handler =
        ble_event_dispatcher_register_svc_handler(rk_profile_event_handler, profile);

    return &profile->base;
}

static void rk_profile_stop(FuriHalBleProfileBase* profile_base) {
    furi_check(profile_base);
    furi_check(profile_base->config == rk_profile);

    RkProfile* profile = (RkProfile*)profile_base;
    ble_event_dispatcher_unregister_svc_handler(profile->event_handler);
    ble_gatt_characteristic_delete(profile->svc_handle, &profile->key_report_char);
    ble_gatt_service_delete(profile->svc_handle);
    // The firmware does not free profile instances, so do it here.
    free(profile);
}

static void rk_profile_get_gap_config(GapConfig* config, FuriHalBleProfileParams profile_params) {
    UNUSED(profile_params);
    furi_check(config);

    memset(config, 0, sizeof(GapConfig));

    config->adv_service.UUID_Type = UUID_TYPE_128;
    memcpy(
        config->adv_service.Service_UUID_128,
        rk_service_uuid.Service_UUID_128,
        sizeof(config->adv_service.Service_UUID_128));
    config->appearance_char = 0x0000;
    config->bonding_mode = true;
    config->pairing_method = GapPairingPinCodeShow;

    // Differ from the stock serial (unchanged) and HID (byte 2 + 1) profiles
    memcpy(config->mac_address, furi_hal_version_get_ble_mac(), sizeof(config->mac_address));
    config->mac_address[2] += 2;

    // Advertising data is limited to 31 bytes. The stack adds flags (3) and TX power
    // level (3), and the 128-bit service UUID takes 18, which leaves 7 for the name
    // element: 5 characters. Longer names are sent as a shortened local name (SPEC §4.2).
    const char* name = furi_hal_version_get_name_ptr();
    if(!name) name = "Flipper";
    bool fits = strlen(name) <= RK_ADV_NAME_CHARS_MAX;
    snprintf(
        config->adv_name,
        RK_ADV_NAME_SIZE_MAX,
        "%c%.*s",
        fits ? AD_TYPE_COMPLETE_LOCAL_NAME : AD_TYPE_SHORTENED_LOCAL_NAME,
        RK_ADV_NAME_CHARS_MAX,
        name);

    config->conn_param.conn_int_min = RK_CONNECTION_INTERVAL_MIN;
    config->conn_param.conn_int_max = RK_CONNECTION_INTERVAL_MAX;
    config->conn_param.slave_latency = 0;
    config->conn_param.supervisor_timeout = 0;
}

static const FuriHalBleProfileTemplate rk_profile_callbacks = {
    .start = rk_profile_start,
    .stop = rk_profile_stop,
    .get_gap_config = rk_profile_get_gap_config,
};

const FuriHalBleProfileTemplate* const rk_profile = &rk_profile_callbacks;

void rk_profile_set_rx_callback(
    FuriHalBleProfileBase* profile_base,
    RkProfileRxCallback callback,
    void* context) {
    furi_check(profile_base && (profile_base->config == rk_profile));

    RkProfile* profile = (RkProfile*)profile_base;
    profile->rx_context = context;
    profile->rx_callback = callback;
}
