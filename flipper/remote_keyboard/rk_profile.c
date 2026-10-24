#include "rk_profile.h"
#include "rk_report.h"

#include <furi.h>
#include <furi_ble/event_dispatcher.h>
#include <furi_ble/gatt.h>
#include <furi_hal_version.h>
#include <ble/core/ble_defs.h>
#include <ble/core/ble_std.h>

#define TAG "RkProfile"

/* UUIDs (docs/bluetooth-protocol.md), stored little-endian as the BLE stack expects. */

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

/* 7.5 ms and 15 ms in 1.25 ms units */
#define RK_CONNECTION_INTERVAL_MIN (0x0006)
#define RK_CONNECTION_INTERVAL_MAX (0x000C)

/*
 * HCI event layouts. The SDK does not export the BLE stack's packet headers
 * (hci_uart_pckt, hci_event_pckt, evt_blecore_aci) or vendor event codes, so
 * mirror them here. The event payloads (aci_gatt_attribute_modified_event_rp0
 * and others) come from ble_types.h.
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

#define RK_ACI_HAL_FW_ERROR_VSEVT_CODE            (0x0006U)
#define RK_ACI_GAP_PAIRING_COMPLETE_VSEVT_CODE    (0x0401U)
#define RK_ACI_GAP_PASS_KEY_REQ_VSEVT_CODE        (0x0402U)
#define RK_ACI_GAP_BOND_LOST_VSEVT_CODE           (0x0405U)
#define RK_ACI_GAP_ADDR_NOT_RESOLVED_VSEVT_CODE   (0x0408U)
#define RK_ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE (0x0C01U)
#define RK_ACI_ATT_EXCHANGE_MTU_RESP_VSEVT_CODE   (0x0C03U)

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

/*
 * Connection-level events, logged for debug logging (docs/flipper-app.md#debug-logging).
 * The handler sees every BLE event before the firmware handles it; logging
 * changes nothing about how the event is handled.
 */

static const char* rk_profile_address_type_name(uint8_t type) {
    switch(type) {
    case 0x00:
        return "public";
    case 0x01:
        return "random";
    case 0x02:
        return "public identity";
    case 0x03:
        return "random identity";
    }
    return "unknown type";
}

static const char* rk_profile_disconnect_reason_name(uint8_t reason) {
    switch(reason) {
    case 0x05:
        return "authentication failure";
    case 0x08:
        return "connection timeout";
    case 0x13:
        return "client closed the connection";
    case 0x16:
        return "Flipper closed the connection";
    case 0x22:
        return "link layer timeout";
    case 0x3B:
        return "unacceptable connection parameters";
    case 0x3D:
        return "encryption failure (MIC)";
    case 0x3E:
        return "connection failed to be established";
    }
    return "other";
}

static void rk_profile_log_connection(
    uint8_t status,
    uint8_t address_type,
    const uint8_t address[6],
    uint16_t interval,
    uint16_t latency,
    uint16_t timeout) {
    // Address bytes are little-endian; interval in 1.25 ms units, timeout in 10 ms
    FURI_LOG_I(
        TAG,
        "Connection: status 0x%02X, client %s address %02X:%02X:%02X:%02X:%02X:%02X, "
        "interval %lu us, latency %u, timeout %lu ms",
        status,
        rk_profile_address_type_name(address_type),
        address[5],
        address[4],
        address[3],
        address[2],
        address[1],
        address[0],
        (uint32_t)interval * 1250,
        latency,
        (uint32_t)timeout * 10);
}

static void rk_profile_log_le_meta_event(const uint8_t* data) {
    switch(data[0]) {
    case HCI_LE_CONNECTION_COMPLETE_SUBEVT_CODE: {
        const hci_le_connection_complete_event_rp0* event = (const void*)&data[1];
        rk_profile_log_connection(
            event->Status,
            event->Peer_Address_Type,
            event->Peer_Address,
            event->Conn_Interval,
            event->Conn_Latency,
            event->Supervision_Timeout);
    } break;
    case HCI_LE_ENHANCED_CONNECTION_COMPLETE_SUBEVT_CODE: {
        const hci_le_enhanced_connection_complete_event_rp0* event = (const void*)&data[1];
        rk_profile_log_connection(
            event->Status,
            event->Peer_Address_Type,
            event->Peer_Address,
            event->Conn_Interval,
            event->Conn_Latency,
            event->Supervision_Timeout);
    } break;
    case HCI_LE_CONNECTION_UPDATE_COMPLETE_SUBEVT_CODE: {
        const hci_le_connection_update_complete_event_rp0* event = (const void*)&data[1];
        FURI_LOG_I(
            TAG,
            "Connection parameters: status 0x%02X, interval %lu us, latency %u, timeout %lu ms",
            event->Status,
            (uint32_t)event->Conn_Interval * 1250,
            event->Conn_Latency,
            (uint32_t)event->Supervision_Timeout * 10);
    } break;
    }
}

static void rk_profile_log_vendor_event(const RkBlecoreAciEvent* blecore_evt) {
    switch(blecore_evt->ecode) {
    case RK_ACI_GAP_PASS_KEY_REQ_VSEVT_CODE:
        FURI_LOG_I(TAG, "Pairing: PIN requested");
        break;
    case RK_ACI_GAP_PAIRING_COMPLETE_VSEVT_CODE: {
        const aci_gap_pairing_complete_event_rp0* event = (const void*)blecore_evt->data;
        // Status: 0 success, 1 timeout, 2 failed; reason: SMP error code
        FURI_LOG_I(
            TAG,
            "Pairing %s: status 0x%02X, reason 0x%02X",
            event->Status ? "failed" : "complete",
            event->Status,
            event->Reason);
    } break;
    case RK_ACI_GAP_BOND_LOST_VSEVT_CODE:
        FURI_LOG_I(
            TAG, "Bond lost: the client asks to pair again although the Flipper has a bond");
        break;
    case RK_ACI_GAP_ADDR_NOT_RESOLVED_VSEVT_CODE:
        FURI_LOG_I(TAG, "Client address not resolved: no bond for this client");
        break;
    case RK_ACI_ATT_EXCHANGE_MTU_RESP_VSEVT_CODE: {
        const aci_att_exchange_mtu_resp_event_rp0* event = (const void*)blecore_evt->data;
        FURI_LOG_I(TAG, "MTU: %u", event->Server_RX_MTU);
    } break;
    case RK_ACI_HAL_FW_ERROR_VSEVT_CODE: {
        const aci_hal_fw_error_event_rp0* event = (const void*)blecore_evt->data;
        FURI_LOG_E(TAG, "BLE stack error: type 0x%02X", event->FW_Error_Type);
    } break;
    }
}

static void rk_profile_log_event(const RkHciEventPacket* event_pckt) {
    switch(event_pckt->evt) {
    case HCI_DISCONNECTION_COMPLETE_EVT_CODE: {
        const hci_disconnection_complete_event_rp0* event = (const void*)event_pckt->data;
        FURI_LOG_I(
            TAG,
            "Disconnected: status 0x%02X, reason 0x%02X (%s)",
            event->Status,
            event->Reason,
            rk_profile_disconnect_reason_name(event->Reason));
    } break;
    case HCI_ENCRYPTION_CHANGE_EVT_CODE: {
        const hci_encryption_change_event_rp0* event = (const void*)event_pckt->data;
        FURI_LOG_I(
            TAG,
            "Encryption %s: status 0x%02X",
            event->Encryption_Enabled ? "on" : "off",
            event->Status);
    } break;
    case HCI_LE_META_EVT_CODE:
        rk_profile_log_le_meta_event(event_pckt->data);
        break;
    case HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE:
        rk_profile_log_vendor_event((const RkBlecoreAciEvent*)event_pckt->data);
        break;
    }
}

static BleEventAckStatus rk_profile_event_handler(void* event, void* context) {
    RkProfile* profile = context;

    RkHciEventPacket* event_pckt = (RkHciEventPacket*)((RkHciUartPacket*)event)->data;
    rk_profile_log_event(event_pckt);
    if(event_pckt->evt != HCI_VENDOR_SPECIFIC_DEBUG_EVT_CODE) return BleEventNotAck;

    RkBlecoreAciEvent* blecore_evt = (RkBlecoreAciEvent*)event_pckt->data;
    if(blecore_evt->ecode != RK_ACI_GATT_ATTRIBUTE_MODIFIED_VSEVT_CODE) return BleEventNotAck;

    aci_gatt_attribute_modified_event_rp0* attribute_modified =
        (aci_gatt_attribute_modified_event_rp0*)blecore_evt->data;
    if(attribute_modified->Attr_Handle != profile->key_report_char.handle + 1) {
        return BleEventNotAck;
    }

    // Never log the data itself
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
    // element: 5 characters. Longer names are sent as a shortened local name.
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
