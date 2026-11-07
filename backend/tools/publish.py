"""Publish a Phase 1/2 JSONL recording into the Phase 3 API.

Examples:
  python -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id imported-demo --mode import
  python -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id live-demo --mode replay

All requests are local HTTP; never expose this unauthenticated demo backend publicly.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from urllib import error, request

from backend.app.schemas import SampleIn


def post_json(url: str, payload: dict):
    """Use the standard library HTTP client so the publisher needs no extra SDK."""
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=15) as response:
            return json.load(response)
    except error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} at {url}: {message}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Cannot reach API at {url}: {exc.reason}") from exc


def get_json(url: str):
    try:
        with request.urlopen(url, timeout=15) as response:
            return json.load(response)
    except error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} while reading {url}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Cannot reach {url}: {exc.reason}") from exc


def load_samples(path: Path, session_id: str) -> list[dict]:
    """Validate the entire source file before sending any POST requests."""
    result: list[dict] = []
    with path.open("r", encoding="utf-8") as stream:
        for index, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                record["session_id"] = session_id  # Renaming avoids duplicate-session collisions.
                model = SampleIn.model_validate(record)
                result.append(model.model_dump())
            except (ValueError, TypeError, AttributeError) as exc:
                raise ValueError(f"Invalid JSONL record at line {index}: {exc}") from exc
    if not result:
        raise ValueError("The input file has no telemetry records")
    if any(a["elapsed_s"] >= b["elapsed_s"] for a, b in zip(result, result[1:])):
        raise ValueError("Input samples must be in increasing elapsed_s order")
    return result


def publish(path: Path, base_url: str, session_id: str, mode: str, rate: float, batch_size: int, existing: bool = False) -> None:
    if not 0 < rate <= 100:
        raise ValueError("--rate must be between 0 (exclusive) and 100")
    if not 1 <= batch_size <= 500:
        raise ValueError("--batch-size must be between 1 and 500")
    if mode not in {"import", "replay"}:
        raise ValueError("Invalid mode")
    records = load_samples(path, session_id)
    root = base_url.rstrip("/") + "/api/v1/sessions"
    if existing:
        created = get_json(root + "/" + session_id)
        if created["source"] != "simulation" or created["sample_count"] != 0:
            raise ValueError("--existing requires an empty simulation session")
        print(f"Using existing empty session {session_id} ({len(records)} samples to send)")
    else:
        created = post_json(root, {"session_id": session_id, "label": f"{mode}: {path.stem}", "source": "simulation"})
        print(f"Created session {created['session_id']} ({len(records)} samples to send)")
    endpoint = root + "/" + session_id + "/samples"
    if mode == "import":
        for start in range(0, len(records), batch_size):
            chunk = records[start:start + batch_size]
            result = post_json(endpoint, {"samples": chunk})
            print(f"Imported {result['total_samples']}/{len(records)} samples")
    else:
        # Monotonic clock prevents OS clock adjustments from shifting playback.
        begin = time.monotonic()
        origin = records[0]["elapsed_s"]
        for i, sample in enumerate(records):
            target = (sample["elapsed_s"] - origin) / rate
            delay = target - (time.monotonic() - begin)
            if delay > 0:
                time.sleep(delay)
            post_json(endpoint, {"samples": [sample]})
            if (i + 1) % 10 == 0 or i + 1 == len(records):
                print(f"Streamed {i + 1}/{len(records)} samples", flush=True)
    print(f"Finished. Session: {base_url.rstrip('/')}/api/v1/sessions/{session_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload or replay decoded synthetic telemetry to Q50 API")
    parser.add_argument("--input", type=Path, required=True, help="Phase 1/2 JSONL recording")
    parser.add_argument("--session-id", required=True, help="New unique ID (e.g. phase3-demo-001)")
    parser.add_argument("--mode", choices=["import", "replay"], default="replay")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--rate", type=float, default=1.0, help="Playback speed; 2 means 2x faster")
    parser.add_argument("--batch-size", type=int, default=100, help="Import mode: samples per request")
    parser.add_argument("--existing", action="store_true", help="Use an existing EMPTY simulation session (lets WebSocket watch connect first)")
    args = parser.parse_args()
    try:
        publish(args.input, args.url, args.session_id, args.mode, args.rate, args.batch_size, args.existing)
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"ERROR: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
