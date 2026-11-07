"""Phase 3 HTTP/WebSocket API for Q50 Digital Twin.

Run: python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
Swagger docs: http://127.0.0.1:8000/docs
Do not expose this unauthenticated development server to the public internet.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timezone
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from backend.app.db import Base, DrivingSession, TelemetryRecord, make_engine, make_session_factory
from backend.app.hub import TelemetryHub
from backend.app.schemas import (
    IngestResult, SampleBatch, SampleIn, SampleOut, SessionCreate, SessionOut, SessionStats,
)

load_dotenv()


def create_app(database_url: str | None = None) -> FastAPI:
    """App factory permits isolated SQLite databases for integration tests."""
    url = database_url or os.getenv("Q50_DATABASE_URL", "sqlite+pysqlite:///./data/q50-local.db")
    if url.startswith("sqlite") and ":memory:" not in url:
        # The default path is relative to the project root (where Uvicorn runs).
        if url.startswith("sqlite+pysqlite:///./data/"):
            Path("data").mkdir(exist_ok=True)
    engine = make_engine(url)
    SessionLocal = make_session_factory(engine)
    hub = TelemetryHub()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Development/learning convenience. Production would use Alembic migrations.
        await run_in_threadpool(Base.metadata.create_all, engine)
        try:
            yield
        finally:
            await run_in_threadpool(engine.dispose)

    app = FastAPI(title="Q50 Digital Twin API", version="0.3.0", lifespan=lifespan,
                  description="Local-only simulated telemetry ingestion, persistence and streaming.")
    app.state.engine = engine

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    def utc_datetime(value):
        # SQLite returns naive datetimes even when timezone=True; interpret these as UTC.
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

    def get_session_details(session_id: str) -> SessionOut | None:
        with SessionLocal() as db:
            session = db.get(DrivingSession, session_id)
            if session is None:
                return None
            total = db.scalar(select(func.count(TelemetryRecord.id)).where(
                TelemetryRecord.session_id == session_id
            )) or 0
            return SessionOut(session_id=session.session_id, label=session.label,
                              source=session.source, created_at=utc_datetime(session.created_at), sample_count=total)

    @app.get("/health")
    def health():
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected", "version": "0.3.0"}

    @app.post("/api/v1/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
    def create_session(payload: SessionCreate):
        with SessionLocal() as db:
            db.add(DrivingSession(**payload.model_dump()))
            try:
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(409, "A session with that ID already exists") from exc
        return get_session_details(payload.session_id)

    @app.get("/api/v1/sessions", response_model=list[SessionOut])
    def list_sessions(limit: int = Query(50, ge=1, le=200)):
        with SessionLocal() as db:
            sessions = db.scalars(select(DrivingSession).order_by(
                DrivingSession.created_at.desc(), DrivingSession.session_id
            ).limit(limit)).all()
            counts = dict(db.execute(select(TelemetryRecord.session_id, func.count(TelemetryRecord.id))
                                     .group_by(TelemetryRecord.session_id)).all())
            return [SessionOut(session_id=s.session_id, label=s.label, source=s.source,
                               created_at=utc_datetime(s.created_at), sample_count=counts.get(s.session_id, 0))
                    for s in sessions]

    @app.get("/api/v1/sessions/{session_id}", response_model=SessionOut)
    def read_session(session_id: str):
        result = get_session_details(session_id)
        if result is None:
            raise HTTPException(404, "Session not found")
        return result

    def insert_batch(session_id: str, payload: SampleBatch) -> IngestResult:
        """Store all samples in ONE transaction or none. Enforce increasing times."""
        items = payload.samples
        if any(item.session_id != session_id for item in items):
            raise HTTPException(422, "All sample session_id values must match the URL")
        if any(a.elapsed_s >= b.elapsed_s for a, b in zip(items, items[1:])):
            raise HTTPException(422, "Samples must have strictly increasing elapsed_s")

        with SessionLocal() as db:
            session = db.get(DrivingSession, session_id)
            if session is None:
                raise HTTPException(404, "Session not found")
            if any(item.source != session.source for item in items):
                raise HTTPException(422, "Source does not match session source")
            last_elapsed = db.scalar(select(func.max(TelemetryRecord.elapsed_s)).where(
                TelemetryRecord.session_id == session_id))
            if last_elapsed is not None and items[0].elapsed_s <= last_elapsed:
                raise HTTPException(409, "Sample time overlaps existing session data")
            db.add_all([TelemetryRecord(**item.model_dump()) for item in items])
            try:
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(409, "Duplicate telemetry record") from exc
            total = db.scalar(select(func.count(TelemetryRecord.id)).where(
                TelemetryRecord.session_id == session_id)) or 0
            return IngestResult(session_id=session_id, inserted=len(items), total_samples=total)

    @app.post("/api/v1/sessions/{session_id}/samples", response_model=IngestResult,
              status_code=status.HTTP_201_CREATED)
    async def ingest_samples(session_id: str, payload: SampleBatch):
        result = await run_in_threadpool(insert_batch, session_id, payload)
        # Only broadcast COMMITTED samples. A failed transaction sends nothing.
        samples = [sample.model_dump() for sample in payload.samples]
        event = ({"type": "telemetry", "session_id": session_id, "sample": samples[0]}
                 if len(samples) == 1 else
                 {"type": "telemetry_batch", "session_id": session_id, "samples": samples})
        await hub.broadcast(session_id, event)
        return result

    @app.get("/api/v1/sessions/{session_id}/samples", response_model=list[SampleOut])
    def read_samples(session_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
        with SessionLocal() as db:
            if db.get(DrivingSession, session_id) is None:
                raise HTTPException(404, "Session not found")
            rows = db.scalars(select(TelemetryRecord).where(TelemetryRecord.session_id == session_id)
                              .order_by(TelemetryRecord.elapsed_s).offset(offset).limit(limit)).all()
            return [SampleOut.model_validate({c: getattr(row, c) for c in SampleOut.model_fields})
                    for row in rows]

    @app.get("/api/v1/sessions/{session_id}/stats", response_model=SessionStats)
    def session_stats(session_id: str):
        with SessionLocal() as db:
            if db.get(DrivingSession, session_id) is None:
                raise HTTPException(404, "Session not found")
            count, first, last, max_rpm, max_speed = db.execute(select(
                func.count(TelemetryRecord.id), func.min(TelemetryRecord.elapsed_s),
                func.max(TelemetryRecord.elapsed_s), func.max(TelemetryRecord.engine_rpm),
                func.max(TelemetryRecord.vehicle_speed_kph),
            ).where(TelemetryRecord.session_id == session_id)).one()
            return SessionStats(session_id=session_id, count=count, first_elapsed_s=first,
                                last_elapsed_s=last, max_engine_rpm=max_rpm,
                                max_vehicle_speed_kph=max_speed)

    @app.websocket("/ws/telemetry/{session_id}")
    async def telemetry_websocket(websocket: WebSocket, session_id: str):
        # The WebSocket is read-only: clients cannot inject telemetry here.
        existing = await run_in_threadpool(get_session_details, session_id)
        if existing is None:
            await websocket.close(code=1008, reason="Unknown session")
            return
        await hub.connect(session_id, websocket)
        await websocket.send_json({"type": "connected", "session_id": session_id,
                                   "message": "Waiting for new telemetry"})
        try:
            # Receive loop notices clients disconnecting. Ignore client messages.
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await hub.disconnect(session_id, websocket)

    return app


app = create_app()
