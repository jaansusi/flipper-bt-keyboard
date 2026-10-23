#!/usr/bin/env python3
"""Generate web/layouts/us.json from the rules in SPEC Appendix B."""

import json
from pathlib import Path

SHIFT = 0x02

OUT = Path(__file__).resolve().parent.parent / "web" / "layouts" / "us.json"


def build_map() -> dict[str, list[list[int]]]:
    m: dict[str, list[list[int]]] = {}

    def add(char: str, usage: int, mods: int = 0) -> None:
        m[char] = [[mods, usage]]

    for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
        add(c, 0x04 + i)
        add(c.upper(), 0x04 + i, SHIFT)

    for i, (plain, shifted) in enumerate(zip("1234567890", "!@#$%^&*()")):
        add(plain, 0x1E + i)
        add(shifted, 0x1E + i, SHIFT)

    add("\n", 0x28)
    add("\t", 0x2B)
    add(" ", 0x2C)

    for usage, plain, shifted in [
        (0x2D, "-", "_"),
        (0x2E, "=", "+"),
        (0x2F, "[", "{"),
        (0x30, "]", "}"),
        (0x31, "\\", "|"),
        (0x33, ";", ":"),
        (0x34, "'", '"'),
        (0x35, "`", "~"),
        (0x36, ",", "<"),
        (0x37, ".", ">"),
        (0x38, "/", "?"),
    ]:
        add(plain, usage)
        add(shifted, usage, SHIFT)

    return m


def main() -> None:
    layout = {"id": "us", "name": "English (US)", "map": build_map()}
    printable = {chr(c) for c in range(0x20, 0x7F)}
    missing = printable - layout["map"].keys()
    assert not missing, f"unmapped printable ASCII: {sorted(missing)}"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(layout, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} ({len(layout['map'])} characters)")


if __name__ == "__main__":
    main()
