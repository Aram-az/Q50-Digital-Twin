"""Request/response models. This is the boundary between untrusted HTTP and storage.

We intentionally accept only Phase 1/2 *synthetic* samples in Phase 3.
Other declared source types can be supported after dedicated adapters are built.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SESSION_ID_RE = r"^[A-Za-z0-9._-]{1,80}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionCreate(StrictModel):
    session_id: str = Field(pattern=SESSION_ID_RE)
    label: str = Field(min_length=1, max_length=120)
    source: Literal["simulation"] = "simulation"


class SessionOut(StrictModel):
    session_id: str
    label: str
    source: str
    created_at: datetime
    sample_count: int


class SampleIn(StrictModel):
    schema_version: Literal["1.0"]
    session_id: str = Field(pattern=SESSION_ID_RE)
    source: Literal["simulation"]
    elapsed_s: float = Field(ge=0, le=3600, allow_inf_nan=False)
    timestamp_utc: str
    engine_rpm: float = Field(ge=0, le=10000, allow_inf_nan=False)
    vehicle_speed_kph: float = Field(ge=0, le=400, allow_inf_nan=False)
    coolant_temp_c: float = Field(ge=-40, le=200, allow_inf_nan=False)
    intake_temp_c: float = Field(ge=-40, le=150, allow_inf_nan=False)
    throttle_pct: float = Field(ge=0, le=100, allow_inf_nan=False)
    quality: Literal["valid"]

    @field_validator("timestamp_utc")
    @classmethod
    def require_utc_milliseconds(cls, timestamp: str) -> str:
        """Normalize no formats: enforce exact Phase 1 timestamp contract."""
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", timestamp):
            raise ValueError("timestamp_utc must be UTC ISO 8601, with exactly 3 decimals and Z")
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("timestamp_utc must be UTC")
        return timestamp


class SampleBatch(StrictModel):
    samples: list[SampleIn] = Field(min_length=1, max_length=500)


class SampleOut(SampleIn):
    id: int


class IngestResult(StrictModel):
    session_id: str
    inserted: int
    total_samples: int


class SessionStats(StrictModel):
    session_id: str
    count: int
    first_elapsed_s: float | None
    last_elapsed_s: float | None
    max_engine_rpm: float | None
    max_vehicle_speed_kph: float | None
