"""SQLAlchemy connection and ORM definitions.

SQLite is the zero-Docker quick-start; PostgreSQL is the recommended backend.
The same ORM models and endpoint code support both databases.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    """Base metadata that creates our two database tables."""


class DrivingSession(Base):
    __tablename__ = "driving_sessions"

    session_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class TelemetryRecord(Base):
    __tablename__ = "telemetry_records"
    __table_args__ = (
        # One sample per time instant within a session. A repeated POST is a conflict.
        UniqueConstraint("session_id", "elapsed_s", name="uq_session_elapsed"),
        Index("ix_telemetry_session_time", "session_id", "elapsed_s"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        String(80), ForeignKey("driving_sessions.session_id", ondelete="CASCADE"), nullable=False
    )
    schema_version: Mapped[str] = mapped_column(String(8), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    elapsed_s: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp_utc: Mapped[str] = mapped_column(String(24), nullable=False)
    engine_rpm: Mapped[float] = mapped_column(Float, nullable=False)
    vehicle_speed_kph: Mapped[float] = mapped_column(Float, nullable=False)
    coolant_temp_c: Mapped[float] = mapped_column(Float, nullable=False)
    intake_temp_c: Mapped[float] = mapped_column(Float, nullable=False)
    throttle_pct: Mapped[float] = mapped_column(Float, nullable=False)
    quality: Mapped[str] = mapped_column(String(16), nullable=False)


def make_engine(url: str):
    """Construct an engine; add SQLite thread/foreign-key settings only for SQLite."""
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine


def make_session_factory(engine):
    """Each API request gets an independent transactional database session."""
    return sessionmaker(bind=engine, expire_on_commit=False)
