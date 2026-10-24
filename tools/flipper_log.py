#!/usr/bin/env python3
"""Stream a Flipper Zero's logs over its USB serial CLI.

Use with the debug build of the app (docs/flipper-app.md#debug-build):

    RK_DEBUG=1 ufbt launch && python3 tools/flipper_log.py

The debug build waits 2 seconds at startup, so this attaches in time to see
the whole startup. Press Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time

import serial
from serial.tools import list_ports

# Flipper Zero USB serial (CDC) interface
FLIPPER_VID, FLIPPER_PID = 0x0483, 0x5740
LEVELS = ["error", "warn", "info", "debug", "trace"]


def find_port() -> str:
    for port in list_ports.comports():
        if port.vid == FLIPPER_VID and port.pid == FLIPPER_PID:
            return port.device
    sys.exit(
        "No Flipper found on USB serial. Is it plugged in, and is the app either "
        "not running or a debug build? (The normal build switches USB to keyboard mode.)"
    )


def wait_for_prompt(link: serial.Serial, timeout: float = 3.0) -> None:
    buffer = b""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        buffer += link.read(256)
        if buffer.rstrip().endswith(b">:"):
            return
    raise TimeoutError("no CLI prompt from the Flipper")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", help="serial port (default: auto-detect)")
    parser.add_argument("--level", choices=LEVELS, default="debug", help="log level (default: debug)")
    parser.add_argument(
        "--launch",
        metavar="PATH",
        help="start an app first, e.g. /ext/apps/USB/remote_keyboard.fap",
    )
    args = parser.parse_args()

    # Stop cleanly on SIGTERM too (background jobs in scripts ignore Ctrl+C)
    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)

    link = serial.Serial(args.port or find_port(), 230400, timeout=0.2)
    try:
        # Leave whatever the CLI was doing and get a fresh prompt
        link.write(b"\x03\r")
        wait_for_prompt(link)
        if args.launch:
            link.write(f'loader open "{args.launch}"\r'.encode())
            wait_for_prompt(link)
        link.write(f"log {args.level}\r".encode())
        while True:
            data = link.read(4096)
            if data:
                sys.stdout.write(data.decode(errors="replace"))
                sys.stdout.flush()
    except KeyboardInterrupt:
        pass
    except serial.SerialException as error:
        # The normal build switches USB to keyboard mode, which drops the port
        print(f"\nSerial connection lost: {error}", file=sys.stderr)
        return 1
    finally:
        try:
            link.write(b"\x03")
            link.close()
        except serial.SerialException:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
