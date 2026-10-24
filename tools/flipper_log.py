#!/usr/bin/env python3
"""Stream a Flipper Zero's logs over its USB serial CLI.

Use with the app's debug mode (docs/flipper-app.md#debug-mode): on the
Flipper, press OK and turn on Debug mode, then run

    python3 tools/flipper_log.py

Needs pyserial: from the repository root, run once
    python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
then use .venv/bin/python instead of python3. Close qFlipper first: it holds
the serial port. Press Ctrl+C to stop.
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
        "not running or in debug mode? (Otherwise the app switches USB to keyboard mode.)"
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

    port = args.port or find_port()
    try:
        link = serial.Serial(port, 230400, timeout=0.2)
    except serial.SerialException as error:
        sys.exit(f"Cannot open {port}: {error}\nIs another program using it, e.g. qFlipper or `ufbt cli`?")
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
        # The app switches USB to keyboard mode (debug mode off), which drops the port
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
