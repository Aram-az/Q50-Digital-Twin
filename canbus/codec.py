"""Define and encode our *synthetic* two-frame, eight-byte CAN protocol.

Phase 2 deliberately separates a decoded telemetry *signal* from its CAN
transport representation. The protocol is invented for controlled simulation.
It must NEVER be transmitted onto an actual vehicle's CAN bus.

Frame 0x500 (8 bytes, little-endian):
    0..1  vehicle_speed_kph   unsigned integer, scale 0.01 km/h/count
    2..3  engine_rpm          unsigned integer, scale 0.1 rpm/count
    4..5  throttle_pct        unsigned integer, scale 0.1 percent/count
    6..7  sequence            unsigned 16-bit sequence number

Frame 0x501 (8 bytes, little-endian):
    0..1  coolant_temp_c      signed integer, scale 0.01 degrees C/count
    2..3  intake_temp_c       signed integer, scale 0.01 degrees C/count
    4     protocol_version    0x01
    5     reserved            0x00
    6..7  sequence            same sequence as frame 0x500

A log line has exactly six pipe-separated columns:
    timestamp_utc|elapsed_s|session_id|source|can_id|data_hex

Everything except the CAN ID and 8 payload bytes is *recording metadata*;
the metadata is not part of a real CAN data frame.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
import struct

from simulator.model import TelemetrySample

FRAME_MOTION = 0x500
FRAME_THERMAL = 0x501
PROTOCOL_VERSION = 1
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class CanFrame:
    """One eight-byte CAN payload with external log metadata."""

    timestamp_utc: str
    elapsed_s: float
    session_id: str
    source: str
    can_id: int
    data: bytes

    def to_log_line(self) -> str:
        """Serialize the frame to the strict, human-readable Phase 2 log."""
        if len(self.data) != 8:
            raise ValueError("This synthetic protocol uses exactly eight data bytes")
        return (
            f"{self.timestamp_utc}|{self.elapsed_s:.3f}|{self.session_id}|"
            f"{self.source}|0x{self.can_id:03X}|{self.data.hex().upper()}"
        )


def _scaled_unsigned(value: float, scale: int, field: str, maximum: float) -> int:
    """Quantize a physical value into an unsigned 16-bit integer."""
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} must be finite")
    if not 0 <= value <= maximum:
        raise ValueError(f"{field} is outside the permitted synthetic range")
    encoded = round(value * scale)
    if not 0 <= encoded <= 65535:
        raise ValueError(f"{field} does not fit in unsigned 16 bits")
    return encoded


def _scaled_signed(value: float, scale: int, field: str, minimum: float, maximum: float) -> int:
    """Quantize a Celsius measurement into a signed 16-bit integer."""
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} must be finite")
    if not minimum <= value <= maximum:
        raise ValueError(f"{field} is outside the permitted synthetic range")
    encoded = round(value * scale)
    if not -32768 <= encoded <= 32767:
        raise ValueError(f"{field} does not fit in signed 16 bits")
    return encoded


def encode_sample(sample: TelemetrySample, sequence: int) -> tuple[CanFrame, CanFrame]:
    """Turn one Phase 1 telemetry sample into two matching CAN frames.

    Both frames carry the same 16-bit sequence so the C++ decoder can detect
    mixed-up, duplicated and incomplete pairs. At 65535, the counter wraps.
    """
    if sample.schema_version != "1.0" or sample.source != "simulation" or sample.quality != "valid":
        raise ValueError("Only valid Phase 1 synthetic samples are supported")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or not 0 <= sequence <= 65535:
        raise ValueError("sequence must be an unsigned 16-bit integer")
    if not SESSION_ID_PATTERN.fullmatch(sample.session_id):
        raise ValueError("session_id must use letters, digits, '.', '-' or '_'")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", sample.timestamp_utc):
        raise ValueError("timestamp must be an ISO8601 UTC timestamp with milliseconds")
    if not math.isfinite(sample.elapsed_s) or sample.elapsed_s < 0:
        raise ValueError("elapsed_s must be finite and nonnegative")

    speed = _scaled_unsigned(sample.vehicle_speed_kph, 100, "speed", 400)
    rpm = _scaled_unsigned(sample.engine_rpm, 10, "RPM", 6553.5)
    throttle = _scaled_unsigned(sample.throttle_pct, 10, "throttle", 100)
    coolant = _scaled_signed(sample.coolant_temp_c, 100, "coolant", -40, 200)
    intake = _scaled_signed(sample.intake_temp_c, 100, "intake", -40, 150)

    motion_bytes = struct.pack("<HHHH", speed, rpm, throttle, sequence)
    thermal_bytes = struct.pack("<hhBBH", coolant, intake, PROTOCOL_VERSION, 0, sequence)
    metadata = dict(timestamp_utc=sample.timestamp_utc, elapsed_s=sample.elapsed_s,
                    session_id=sample.session_id, source=sample.source)
    return (
        CanFrame(**metadata, can_id=FRAME_MOTION, data=motion_bytes),
        CanFrame(**metadata, can_id=FRAME_THERMAL, data=thermal_bytes),
    )
