"""Compare Phase 1 telemetry and Phase 2 C++ decoder output exactly.

Example:
  python tools/verify_roundtrip.py data/sample/mixed_10s.jsonl data/decoded/mixed_10s.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check lossless telemetry round-trip through our synthetic CAN protocol")
    parser.add_argument("original", type=Path)
    parser.add_argument("decoded", type=Path)
    args = parser.parse_args()
    try:
        expected = load(args.original)
        actual = load(args.decoded)
    except (OSError, json.JSONDecodeError) as error:
        print(f"Unable to read recordings: {error}", file=sys.stderr)
        return 2
    if not expected:
        print("FAIL: original recording is empty", file=sys.stderr)
        return 1
    if len(expected) != len(actual):
        print(f"FAIL: record count differs ({len(expected)} original vs {len(actual)} decoded)", file=sys.stderr)
        return 1
    for index, (before, after) in enumerate(zip(expected, actual)):
        if before != after:
            keys = sorted(set(before) | set(after))
            differing = [key for key in keys if before.get(key) != after.get(key)]
            print(f"FAIL: sample {index} differs in: {', '.join(differing)}", file=sys.stderr)
            return 1
    print(f"PASS: all {len(expected)} telemetry samples matched exactly after Python -> CAN -> C++ decoding")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
