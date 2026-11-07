"""Watch new telemetry over a WebSocket. Run in a separate PowerShell tab.

python -m backend.tools.watch --session-id phase3-demo-001
"""
from __future__ import annotations

import argparse
import asyncio
import json

from websockets.asyncio.client import connect


async def watch(url: str, session_id: str) -> None:
    endpoint = f"{url.rstrip('/')}/ws/telemetry/{session_id}"
    print(f"Connecting to {endpoint} ... (Ctrl+C to stop)")
    async with connect(endpoint) as ws:
        async for message in ws:
            event = json.loads(message)
            if event.get("type") == "telemetry":
                sample = event["sample"]
                print(f"t={sample['elapsed_s']:5.1f}s | {sample['vehicle_speed_kph']:6.2f} km/h"
                      f" | {sample['engine_rpm']:7.1f} RPM | coolant {sample['coolant_temp_c']:5.1f} C")
            elif event.get("type") == "telemetry_batch":
                print(f"Received {len(event['samples'])} historical samples in a batch")
            else:
                print(event)


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch Q50 live telemetry via WebSocket")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--url", default="ws://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        asyncio.run(watch(args.url, args.session_id))
    except KeyboardInterrupt:
        print("Stopped.")
    except Exception as exc:
        parser.exit(1, f"ERROR: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
