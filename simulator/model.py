"""Deterministic, deliberately simplified vehicle simulation.

Values are synthetic demonstrations, NOT calibrated Q50 Red Sport measurements.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import random
from typing import Iterator

CHANNEL_UNITS = {
    "engine_rpm": "rpm",
    "vehicle_speed_kph": "km/h",
    "coolant_temp_c": "degC",
    "intake_temp_c": "degC",
    "throttle_pct": "percent",
}


@dataclass(frozen=True)
class TelemetrySample:
    schema_version: str
    session_id: str
    source: str
    elapsed_s: float
    timestamp_utc: str
    engine_rpm: float
    vehicle_speed_kph: float
    coolant_temp_c: float
    intake_temp_c: float
    throttle_pct: float
    quality: str

    def to_dict(self) -> dict:
        return asdict(self)


def throttle_for_scenario(scenario: str, elapsed_s: float) -> float:
    """A simple driver input schedule, not an engine control strategy."""
    if scenario == "idle":
        return 2.0
    if scenario == "cruise":
        return 19.0
    if scenario == "acceleration":
        return 65.0 if elapsed_s < 12.0 else 12.0
    if scenario == "mixed":
        cycle = elapsed_s % 40.0
        if cycle < 5:
            return 2.0
        if cycle < 17:
            return 55.0
        if cycle < 29:
            return 18.0
        return 4.0
    raise ValueError(f"Unknown scenario: {scenario}")


def generate_samples(
    *, scenario: str, duration_s: float, hz: int, seed: int,
    start_time_utc: str, session_id: str,
) -> Iterator[TelemetrySample]:
    """Generate exactly duration_s*hz samples using a fixed-step state update.

    We use a first-order speed response, a simplified RPM relationship, and a
    slowly changing temperature model. No random draws depend on wall time.
    """
    if scenario not in {"idle", "cruise", "acceleration", "mixed"}:
        raise ValueError("Invalid scenario")
    if hz < 1 or hz > 100:
        raise ValueError("hz must be between 1 and 100")
    if not math.isfinite(duration_s) or duration_s <= 0 or duration_s > 3600:
        raise ValueError("duration must be in (0, 3600] seconds")
    steps = round(duration_s * hz)
    if not math.isclose(steps / hz, duration_s, abs_tol=1e-9):
        raise ValueError("duration * hz must be an integer (whole number of samples)")

    from datetime import datetime, timedelta, timezone
    start = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    if start.tzinfo is None or start.utcoffset() != timedelta(0):
        raise ValueError("start time must be UTC with timezone")
    rng = random.Random(seed)
    dt = 1.0 / hz
    speed = 0.0 if scenario != "cruise" else 75.0
    coolant = 86.0

    for index in range(steps):
        elapsed = index * dt
        throttle = throttle_for_scenario(scenario, elapsed)
        if scenario == "idle":
            target_speed = 0.0
        elif scenario == "cruise":
            target_speed = 75.0
        else:
            target_speed = max(0.0, min(115.0, (throttle - 7.0) * 1.8))
        # First-order response: x_next = x + alpha * (target - x).
        alpha = min(1.0, dt / 3.0)
        speed += alpha * (target_speed - speed)
        speed = max(0.0, min(125.0, speed))
        # Synthetic RPM approximates idle + vehicle speed + throttle load.
        rpm = 750.0 + 27.0 * speed + 11.0 * throttle
        rpm += rng.uniform(-22.0, 22.0)
        rpm = max(650.0, min(6500.0, rpm))
        # Thermal model relaxes toward a load-dependent temperature.
        target_coolant = 89.0 + 0.05 * throttle
        coolant += min(1.0, dt / 25.0) * (target_coolant - coolant)
        intake = 29.0 + 0.035 * throttle + rng.uniform(-0.3, 0.3)
        timestamp = (start + timedelta(seconds=elapsed)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        yield TelemetrySample(
            schema_version="1.0", session_id=session_id, source="simulation",
            elapsed_s=round(elapsed, 3), timestamp_utc=timestamp,
            engine_rpm=round(rpm, 1), vehicle_speed_kph=round(speed, 2),
            coolant_temp_c=round(coolant, 2), intake_temp_c=round(intake, 2),
            throttle_pct=round(throttle, 1), quality="valid",
        )
