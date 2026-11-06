"""Command-line entry point for synthetic telemetry recording."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from uuid import uuid4

from simulator.model import TelemetrySample, generate_samples


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate synthetic Q50-inspired telemetry (never connects to a real car).")
    parser.add_argument("--scenario", choices=["idle", "cruise", "acceleration", "mixed"], default="mixed")
    parser.add_argument("--duration", type=float, default=10, help="Simulated seconds, must be a whole number of samples")
    parser.add_argument("--hz", type=int, default=10, help="Samples per second (1-100)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for repeatability")
    parser.add_argument("--output", type=Path, default=Path("data/sample/mixed_10s.jsonl"))
    parser.add_argument("--format", choices=["jsonl", "csv"], default="jsonl")
    parser.add_argument("--start", default="2026-01-01T00:00:00Z", help="Fixed UTC starting timestamp (ISO8601)")
    parser.add_argument("--session", default="demo-session-001", help="Session identifier")
    return parser


def write_samples(samples: list[TelemetrySample], path: Path, file_format: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" prevents extra blank lines on Windows for CSV files.
    with path.open("w", newline="", encoding="utf-8") as handle:
        if file_format == "jsonl":
            for sample in samples:
                handle.write(json.dumps(sample.to_dict(), allow_nan=False) + "\n")
        else:
            fieldnames = list(TelemetrySample.__dataclass_fields__)
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(sample.to_dict() for sample in samples)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        samples = list(generate_samples(
            scenario=args.scenario, duration_s=args.duration, hz=args.hz,
            seed=args.seed, start_time_utc=args.start, session_id=args.session,
        ))
        write_samples(samples, args.output, args.format)
    except (ValueError, OSError, OverflowError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    print(f"Generated {len(samples)} synthetic samples ({args.scenario})")
    print(f"File: {args.output.resolve()}")
    if samples:
        first, last = samples[0], samples[-1]
        print(f"First: {first.vehicle_speed_kph:.2f} km/h, {first.engine_rpm:.1f} rpm")
        print(f"Last:  {last.vehicle_speed_kph:.2f} km/h, {last.engine_rpm:.1f} rpm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
