"""CLI: Phase 1 JSONL telemetry -> Phase 2 synthetic CAN frame log."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from canbus.codec import encode_sample
from simulator.model import TelemetrySample


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Encode synthetic telemetry into a made-up CAN protocol (not actual Q50 CAN IDs).")
    parser.add_argument("--input", type=Path, required=True, help="Phase 1 JSONL input")
    parser.add_argument("--output", type=Path, required=True, help="Synthetic CAN log output")
    parser.add_argument("--sequence-start", type=int, default=0, help="Initial 16-bit sequence counter (0..65535)")
    return parser


def convert(input_path: Path, output_path: Path, sequence_start: int = 0) -> int:
    """Convert file without loading the whole session into memory.

    Failures leave no completed output file: data is first written to a .tmp
    file and then atomically moved into place where supported.
    """
    if not 0 <= sequence_start <= 65535:
        raise ValueError("sequence-start must be between 0 and 65535")
    if input_path.resolve() == output_path.resolve():
        raise ValueError("input and output must be different files")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging_path = output_path.with_name(output_path.name + ".tmp")
    count = 0
    try:
        with input_path.open("r", encoding="utf-8") as source, staging_path.open("w", encoding="utf-8", newline="\n") as dest:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                try:
                    sample = TelemetrySample(**json.loads(line))
                    frames = encode_sample(sample, (sequence_start + count) % 65536)
                except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
                    raise ValueError(f"input line {line_number}: {exc}") from exc
                for frame in frames:
                    dest.write(frame.to_log_line() + "\n")
                count += 1
        if count == 0:
            raise ValueError("input does not contain telemetry records")
        staging_path.replace(output_path)
    finally:
        staging_path.unlink(missing_ok=True)
    return count


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        count = convert(args.input, args.output, args.sequence_start)
    except (ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    print(f"Encoded {count} synthetic samples into {count * 2} CAN frames")
    print(f"CAN log: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
