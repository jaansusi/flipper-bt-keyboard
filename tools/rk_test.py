#!/usr/bin/env python3
"""Remote Keyboard protocol test client (see docs/testing.md).

Pairing: the OS pairs on the first write to the Key Report characteristic.
  - Linux: run `bluetoothctl`, then `agent KeyboardOnly` and `default-agent`,
    and type the PIN shown on the Flipper when bluetoothctl asks for it.
    Alternatively pass --pair.
  - macOS / Windows: the OS shows a PIN prompt.

Observing the host: with --host-ssh, the suite reads what was typed from a file
on a Linux host. Before running, on the host's local console (the keyboard
the Flipper emulates must type into it), run:

    cat >> /tmp/rk_out.txt

Append mode (>>) lets the script truncate the file between tests. Without
--host-ssh, the suite asks you to confirm what appeared on the host.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice
from bleak.exc import BleakError

SERVICE_UUID = "ff6ad5ee-6d0c-4067-9f0b-25935584962d"
KEY_REPORT_UUID = "82e449f4-1910-47dd-bb18-a697f0e81a9c"

ZERO = bytes(8)
USAGE_A, USAGE_B, USAGE_Z = 0x04, 0x05, 0x1D
USAGE_ENTER, USAGE_DOWN = 0x28, 0x51

LAYOUT_PATH = Path(__file__).resolve().parent.parent / "web" / "layouts" / "us.json"


def report(mods: int = 0, *keys: int) -> bytes:
    padded = list(keys) + [0] * (6 - len(keys))
    return bytes([mods, 0, *padded])


def load_layout() -> dict[str, list[list[int]]]:
    return json.loads(LAYOUT_PATH.read_text())["map"]


def text_to_reports(text: str, layout: dict[str, list[list[int]]]) -> list[bytes]:
    out: list[bytes] = []
    for char in text:
        for mods, usage in layout.get(char, []):
            out += [report(mods, usage), ZERO]
    return out


async def find_device(timeout: float) -> BLEDevice:
    device = await BleakScanner.find_device_by_filter(
        lambda _d, adv: SERVICE_UUID in [u.lower() for u in adv.service_uuids],
        timeout=timeout,
    )
    if device is None:
        sys.exit("No Remote Keyboard found. Is the app running on the Flipper?")
    return device


class Keyboard:
    def __init__(self, client: BleakClient) -> None:
        self.client = client

    async def write(self, data: bytes) -> None:
        await self.client.write_gatt_char(KEY_REPORT_UUID, data, response=True)

    async def send_reports(self, reports: list[bytes], pair_writes: bool = False) -> None:
        if pair_writes:
            for i in range(0, len(reports), 2):
                await self.write(b"".join(reports[i : i + 2]))
        else:
            for r in reports:
                await self.write(r)

    async def type_text(self, text: str, layout: dict, interval_ms: int = 20) -> None:
        for char in text:
            await self.send_reports(text_to_reports(char, layout), pair_writes=True)
            await asyncio.sleep(interval_ms / 1000)

    async def tap(self, usage: int, mods: int = 0) -> None:
        await self.write(report(mods, usage) + ZERO)


class Host:
    """Reads what the Flipper typed, over SSH or by asking the tester."""

    def __init__(self, ssh: str | None, path: str) -> None:
        self.ssh = ssh
        self.path = path

    def _ssh(self, command: str) -> str:
        result = subprocess.run(
            ["ssh", self.ssh, command], capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            raise RuntimeError(f"ssh failed: {result.stderr.strip()}")
        return result.stdout

    def reset(self) -> None:
        if self.ssh:
            self._ssh(f": > {self.path}")

    def check(self, expected: str, description: str) -> bool:
        if not self.ssh:
            return ask(f"Host should show exactly: {description!r}. Correct?")
        actual = self._ssh(f"cat {self.path}").rstrip("\n")
        if actual != expected:
            print(f"    expected {expected!r}, got {actual!r}")
        return actual == expected

    def read(self) -> str | None:
        return self._ssh(f"cat {self.path}").rstrip("\n") if self.ssh else None


def ask(question: str) -> bool:
    return input(f"    {question} [y/n] ").strip().lower().startswith("y")


async def settle(seconds: float = 0.5) -> None:
    await asyncio.sleep(seconds)


# --- Tests (docs/testing.md) ------------------------------------------------
#
# Each test types a line ending in Enter, so `cat` on the host receives it.
# T1–T5 send something invalid containing an "a", then a valid "b".


async def end_line(kb: Keyboard) -> None:
    await kb.tap(USAGE_ENTER)
    await settle()


async def t_invalid_then_b(kb: Keyboard, host: Host, invalid_writes: list[bytes]) -> bool:
    host.reset()
    for data in invalid_writes:
        try:
            await kb.write(data)
        except BleakError as e:
            # Some stacks reject oversized writes locally; that is still "not typed".
            print(f"    write of {len(data)} bytes rejected by client stack: {e}")
    await kb.tap(USAGE_B)
    await end_line(kb)
    await kb.write(ZERO)
    return host.check("b", "b")


async def t1(kb, host):
    a = report(0, USAGE_A)
    writes = [b"", a[:7], a + b"\x00", (a + ZERO)[:15], a + ZERO + ZERO]
    return await t_invalid_then_b(kb, host, writes)


async def t2(kb, host):
    return await t_invalid_then_b(kb, host, [bytes([0, 1, USAGE_A, 0, 0, 0, 0, 0])])


async def t3(kb, host):
    return await t_invalid_then_b(kb, host, [bytes([0, 0, 0xE1, USAGE_A, 0, 0, 0, 0])])


async def t4(kb, host):
    return await t_invalid_then_b(kb, host, [bytes([0, 0, USAGE_A, USAGE_A, 0, 0, 0, 0])])


async def t5(kb, host):
    return await t_invalid_then_b(kb, host, [report(0, USAGE_A) + bytes([0, 1, 0, 0, 0, 0, 0, 0])])


async def t6(kb, host):
    print("    Manual: remove the bond for the Flipper in this computer's Bluetooth")
    print("    settings, reconnect with `rk_test.py send 0000040000000000` and decline")
    print("    the PIN prompt. The write must fail and nothing must be typed.")
    return ask("Did the unbonded write fail with nothing typed?")


async def t7(kb, host, layout):
    sent = ("abcdefghijklmnopqrstuvwxyz0123456789" * 9)[:300]
    host.reset()
    reports = text_to_reports(sent, layout)
    await kb.send_reports(reports, pair_writes=True)
    # Let the Flipper drain its queue: 600 reports at >= 8 ms each.
    await settle(600 * 0.008 + 1.0)
    await end_line(kb)
    await kb.tap(USAGE_Z)
    await end_line(kb)
    typed = host.read()
    if typed is None:
        return ask("Host shows an unbroken prefix of the alphabet/digit sequence "
                   "(>= 256 chars), then a line with a single 'z'?")
    lines = typed.split("\n")
    ok = (
        len(lines) == 2
        and sent.startswith(lines[0])
        and len(lines[0]) >= 256
        and lines[1] == "z"
    )
    if not ok:
        print(f"    typed {len(lines[0])} chars, prefix ok: {sent.startswith(lines[0])}, "
              f"last line: {lines[-1]!r}")
    return ok


async def t8(kb, host):
    print("    Watch the host: Down arrow will be held for 1 s, then the client")
    print("    disconnects. Auto-repeat must stop right at the disconnect.")
    input("    Press Enter to start…")
    await kb.write(report(0, USAGE_DOWN))
    await settle(1.0)
    await kb.client.disconnect()
    ok = ask("Did the repeat stop immediately when the client disconnected?")
    await kb.client.connect()
    return ok


async def t9(kb, host):
    print("    Down arrow will be held. Then press Back on the Flipper.")
    input("    Press Enter to start…")
    await kb.write(report(0, USAGE_DOWN))
    return ask("Did the repeat stop, the app exit, and qFlipper reconnect over USB?")


async def t10(kb, host):
    input("    Unplug the Flipper's USB cable, plug it back in, then press Enter…")
    await settle(3.0)
    host.reset()
    await kb.tap(USAGE_A)
    await end_line(kb)
    return host.check("a", "a") and kb.client.is_connected


async def run_suite(kb: Keyboard, host: Host, layout: dict, only: list[str]) -> int:
    tests = [
        ("T1", "invalid write lengths discarded", lambda: t1(kb, host)),
        ("T2", "reserved byte set → discarded", lambda: t2(kb, host)),
        ("T3", "modifier usage in key slot → discarded", lambda: t3(kb, host)),
        ("T4", "duplicate usage → discarded", lambda: t4(kb, host)),
        ("T5", "16-byte write with invalid half → discarded", lambda: t5(kb, host)),
        ("T6", "unbonded client cannot write", lambda: t6(kb, host)),
        ("T7", "queue overflow: exact prefix, no stuck key", lambda: t7(kb, host, layout)),
        ("T8", "disconnect releases held key", lambda: t8(kb, host)),
        ("T10", "USB replug keeps working", lambda: t10(kb, host)),
        # T9 last: it exits the app.
        ("T9", "Back releases held key and exits", lambda: t9(kb, host)),
    ]
    failures = 0
    for test_id, name, fn in tests:
        if only and test_id not in only:
            continue
        print(f"{test_id}: {name}")
        try:
            ok = await fn()
        except Exception as e:  # noqa: BLE001 - report and continue
            print(f"    error: {e!r}")
            ok = False
        finally:
            if kb.client.is_connected:
                await kb.write(ZERO)
        print(f"    {'PASS' if ok else 'FAIL'}")
        failures += not ok
    print(f"\n{failures} failure(s)")
    return failures


# --- CLI ------------------------------------------------------------------


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--timeout", type=float, default=10.0, help="scan timeout in seconds")
    parser.add_argument("--pair", action="store_true", help="call client.pair() after connecting (Linux/Windows)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("scan", help="list Remote Keyboard devices")
    p_type = sub.add_parser("type", help="type text with the US layout")
    p_type.add_argument("text")
    p_type.add_argument("--interval", type=int, default=20, help="ms between characters")
    p_send = sub.add_parser("send", help="write raw hex bytes, e.g. 0500 4c00 0000 0000")
    p_send.add_argument("hex", nargs="+")
    p_suite = sub.add_parser("suite", help="run protocol tests T1–T10")
    p_suite.add_argument("--host-ssh", help="user@host of a Linux host running `cat >> FILE`")
    p_suite.add_argument("--host-file", default="/tmp/rk_out.txt")
    p_suite.add_argument("--only", nargs="*", default=[], help="test ids, e.g. T1 T7")
    args = parser.parse_args()

    if args.command == "scan":
        devices = await BleakScanner.discover(timeout=args.timeout, return_adv=True)
        found = [(d, a) for d, a in devices.values() if SERVICE_UUID in [u.lower() for u in a.service_uuids]]
        for d, a in found:
            print(f"{d.address}  {d.name or a.local_name or '(no name)'}  RSSI {a.rssi}")
        if not found:
            print("No Remote Keyboard found.")
        return 0

    device = await find_device(args.timeout)
    async with BleakClient(device) as client:
        if args.pair:
            await client.pair()
        kb = Keyboard(client)
        # First write triggers pairing if not bonded (docs/bluetooth-protocol.md)
        try:
            await kb.write(ZERO)
        except BleakError as e:
            print(f"First write failed ({e}); complete pairing, retrying in 3 s…")
            await asyncio.sleep(3)
            await kb.write(ZERO)

        if args.command == "type":
            await kb.type_text(args.text, load_layout(), args.interval)
        elif args.command == "send":
            data = bytes.fromhex("".join(args.hex))
            await kb.write(data)
        elif args.command == "suite":
            host = Host(args.host_ssh, args.host_file)
            return 1 if await run_suite(kb, host, load_layout(), args.only) else 0
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
