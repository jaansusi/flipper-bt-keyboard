#include "rk_log.h"

#include <furi.h>
#include <furi_hal_rtc.h>
#include <storage/storage.h>

#define TAG "RkLog"

#define RK_LOG_PATH     APP_DATA_PATH("debug.log")
#define RK_LOG_OLD_PATH APP_DATA_PATH("debug.old.log")

/* At start, a bigger log file becomes the old one, replacing it */
#define RK_LOG_SIZE_MAX    (256 * 1024)
#define RK_LOG_BUFFER_SIZE (4096)
#define RK_LOG_CHUNK_SIZE  (256)
#define RK_LOG_STACK_SIZE  (2048)
#define RK_LOG_POLL_MS     (100)

struct RkLog {
    Storage* storage;
    File* file;
    FuriStreamBuffer* buffer;
    FuriThread* thread;
    FuriThreadId thread_id;
    FuriLogLevel level_before;
    volatile bool stop;
    // Bytes the buffer had no room for
    volatile uint32_t lost;
    // Inside a color escape sequence of the serial log format
    bool escape;
    bool unsynced;
};

/*
 * Log handler: called by whichever thread logs, with the log mutex held, or
 * from an interrupt. It only copies into the buffer; the writer thread does
 * the file I/O.
 */
static void rk_log_handler(const uint8_t* data, size_t size, void* context) {
    RkLog* log = context;
    // The writer's own storage calls must not feed back into the log
    if(furi_thread_get_current_id() == log->thread_id) return;
    size_t sent = furi_stream_buffer_send(log->buffer, data, size, 0);
    log->lost += size - sent;
}

static FuriLogHandler rk_log_handler_of(RkLog* log) {
    return (FuriLogHandler){.callback = rk_log_handler, .context = log};
}

/** Write a chunk without color codes and carriage returns. */
static void rk_log_write(RkLog* log, const uint8_t* data, size_t size) {
    uint8_t out[RK_LOG_CHUNK_SIZE];
    size_t length = 0;
    for(size_t i = 0; i < size; i++) {
        uint8_t c = data[i];
        if(log->escape) {
            if(c == 'm') log->escape = false;
        } else if(c == '\033') {
            log->escape = true;
        } else if(c != '\r') {
            out[length++] = c;
        }
    }
    if(length == 0) return;
    storage_file_write(log->file, out, length);
    log->unsynced = true;
}

static void rk_log_write_str(RkLog* log, const char* str) {
    rk_log_write(log, (const uint8_t*)str, strlen(str));
}

static int32_t rk_log_thread(void* context) {
    RkLog* log = context;
    uint8_t chunk[RK_LOG_CHUNK_SIZE];

    while(true) {
        size_t size = furi_stream_buffer_receive(
            log->buffer, chunk, sizeof(chunk), furi_ms_to_ticks(RK_LOG_POLL_MS));
        if(size > 0) {
            rk_log_write(log, chunk, size);
            continue;
        }
        // Buffer empty: sync, so the file survives a crash or a pulled SD card
        if(log->unsynced) {
            storage_file_sync(log->file);
            log->unsynced = false;
        }
        if(log->stop) break;
    }
    return 0;
}

RkLog* rk_log_alloc(void) {
    RkLog* log = malloc(sizeof(RkLog));
    memset(log, 0, sizeof(RkLog));
    log->storage = furi_record_open(RECORD_STORAGE);
    log->file = storage_file_alloc(log->storage);
    log->buffer = furi_stream_buffer_alloc(RK_LOG_BUFFER_SIZE, 1);
    log->thread = furi_thread_alloc_ex(TAG, RK_LOG_STACK_SIZE, rk_log_thread, log);
    return log;
}

void rk_log_free(RkLog* log) {
    furi_check(log);
    furi_thread_free(log->thread);
    furi_stream_buffer_free(log->buffer);
    storage_file_free(log->file);
    furi_record_close(RECORD_STORAGE);
    free(log);
}

bool rk_log_start(RkLog* log) {
    furi_check(log);

    FileInfo info;
    if(storage_common_stat(log->storage, RK_LOG_PATH, &info) == FSE_OK &&
       info.size > RK_LOG_SIZE_MAX) {
        storage_common_remove(log->storage, RK_LOG_OLD_PATH);
        storage_common_rename(log->storage, RK_LOG_PATH, RK_LOG_OLD_PATH);
    }
    if(!storage_file_open(log->file, RK_LOG_PATH, FSAM_WRITE, FSOM_OPEN_APPEND)) {
        FURI_LOG_E(TAG, "Cannot open %s", RK_LOG_PATH);
        storage_file_close(log->file);
        return false;
    }

    DateTime now;
    furi_hal_rtc_get_datetime(&now);
    char header[80];
    snprintf(
        header,
        sizeof(header),
        "\n=== Debug logging started %04u-%02u-%02u %02u:%02u:%02u, tick %lu ===\n",
        now.year,
        now.month,
        now.day,
        now.hour,
        now.minute,
        now.second,
        furi_get_tick());
    log->escape = false;
    rk_log_write_str(log, header);

    log->stop = false;
    log->lost = 0;
    furi_stream_buffer_reset(log->buffer);
    furi_thread_start(log->thread);
    log->thread_id = furi_thread_get_id(log->thread);

    // The app's own messages are Info; make sure they are not filtered out
    log->level_before = furi_log_get_level();
    if(log->level_before < FuriLogLevelInfo) furi_log_set_level(FuriLogLevelInfo);
    furi_check(furi_log_add_handler(rk_log_handler_of(log)));
    return true;
}

void rk_log_stop(RkLog* log) {
    furi_check(log);
    furi_check(furi_log_remove_handler(rk_log_handler_of(log)));
    furi_log_set_level(log->level_before);

    log->stop = true;
    furi_thread_join(log->thread);

    char footer[64];
    snprintf(footer, sizeof(footer), "=== Debug logging stopped, %lu bytes lost ===\n", log->lost);
    rk_log_write_str(log, footer);
    storage_file_close(log->file);
}
