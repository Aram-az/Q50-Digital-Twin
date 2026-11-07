# Phase 3 - Backend, Real-Time Streaming & Persistent Storage

## Goal

Connect the Phase 2 **decoded synthetic JSONL** to a real API, preserve session
data in SQLite/PostgreSQL, and broadcast *newly committed* measurements over a
WebSocket. This is the service Phase 4's React dashboard will connect to.

**Scope:** local, single-process developer application. No real car interface,
ECU access, or external/public deployment. No authentication is implemented.

## Architecture and design decisions

```text
Phase 1 model -> Phase 2 Python CAN encoding -> C++ decoding -> decoded JSONL
                                             -> backend/tools/publish.py
                                             -> HTTP POST /api/v1/.../samples
                                             -> Pydantic typed validation
                                             -> SQLAlchemy transaction
                                             -> PostgreSQL or SQLite storage
                                             -> WebSocket fan-out
                                             -> backend/tools/watch.py
```

- **FastAPI** handles HTTP request routing and WebSocket connections. OpenAPI
  documentation is generated automatically under `/docs`.
- **Pydantic** validates telemetry fields, units/ranges, timestamps, provenance,
  and the maximum of 500 samples per HTTP request. Invalid requests get 422.
- **SQLAlchemy** stores session headers and individual samples. A unique
  constraint on `(session_id, elapsed_s)` protects against duplicate times.
- **Transactions** mean an invalid/conflicting batch is not half-written. WebSocket
  notifications are sent only after the commit succeeds.
- **WebSocket** is a long-lived server-to-client connection; a one-sample POST
  emits a `telemetry` event, while a bulk upload emits `telemetry_batch`.
- **Single-worker design:** the WebSocket subscriber map is held in process
  memory. Running multiple Uvicorn workers would require Redis or another
  shared pub/sub service. Use one worker for this project.
- **Database backends:** SQLite quick start without Docker; PostgreSQL via Docker
  is recommended for the portfolio and matches the intended architecture.
- **Development-only schema setup:** SQLAlchemy `create_all()` creates tables
  but does not migrate existing ones. Introduce Alembic before real upgrades.

## Windows 11 setup

Open the existing `q50-digital-twin` repository in VS Code. In PowerShell, check:

```powershell
Get-Location
Get-ChildItem README.md
```

Install dependencies into Phase 1's virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

Create `.env` only if absent:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

The default `.env` uses SQLite. No Docker is necessary for the first run.

Ensure the old Phase 2 decoder is compiled so the prior 7 C++ integration
checks execute rather than skip. With MSYS2 UCRT64 installed:

```powershell
$env:Path = "C:\msys64\ucrt64\bin;$env:Path"
New-Item -ItemType Directory -Force decoder\bin | Out-Null
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic decoder/src/main.cpp -o decoder/bin/q50-can-decoder.exe
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Expected: **31 tests, OK**, with **no skipped** C++ tests.

### Terminal A - API server

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

API documentation: http://127.0.0.1:8000/docs

Health from a *second PowerShell* terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected JSON object: `{"status":"ok","database":"connected","version":"0.3.0"}`.

### Terminal B - create session and watch live telemetry

```powershell
$body = @{session_id="phase3-live-001"; label="My first live stream"; source="simulation"} | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/sessions -Method Post -ContentType application/json -Body $body
.\.venv\Scripts\python.exe -m backend.tools.watch --session-id phase3-live-001
```

`connected` should appear. Keep the monitor running.

### Terminal C - transmit 100 decoded Phase 2 samples

```powershell
.\.venv\Scripts\python.exe -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id phase3-live-001 --existing --mode replay --rate 1
```

Terminal B should show roughly **10 new readings per second** with simulated
speed, RPM, and coolant temperature. Terminal C finishes after the recording
has been replayed. Stop watching with `Ctrl+C`.

Then retrieve persisted statistics:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/sessions/phase3-live-001/stats
```

Expected `count: 100`, elapsed range `0.0` to `9.9` seconds.

### Additional exercise - quick batch import

```powershell
.\.venv\Scripts\python.exe -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id phase3-import-001 --mode import --batch-size 100
Invoke-RestMethod http://127.0.0.1:8000/api/v1/sessions/phase3-import-001/samples?limit=2
```

A new session ID is required for each import. The app intentionally rejects
repeating timestamps within a session (`409 Conflict`). If the sample file
is missing, repeat the Phase 2 simulation, CAN encoding and C++ decoding steps.

## Switch to PostgreSQL

1. Install/start Docker Desktop with the WSL2 Linux backend (Windows 11 Home
   supports this mode). Confirm `docker --version` and `docker compose version`.
2. From the project root, run:

   ```powershell
   docker compose up -d db
   docker compose ps
   ```

3. In `.env`, change the active line to:

   ```env
   Q50_DATABASE_URL=postgresql+psycopg://q50dev:q50_dev_only@127.0.0.1:5433/q50digitaltwin
   ```

4. Stop the Python server with `Ctrl+C` and start it again.
5. Re-run the health check and the import command using a new session ID.
6. Verify PostgreSQL directly:

   ```powershell
   docker compose exec db psql -U q50dev -d q50digitaltwin -c "SELECT count(*) FROM telemetry_records;"
   ```

These are local development credentials. Port 5433 is intentionally bound to
127.0.0.1 only. Never publish this Compose file on a cloud host without proper
secrets, access controls and network policy. SQLite data is not migrated.

`docker compose down` stops the database without removing persisted volume.
Do not use `docker compose down -v` unless you intentionally want to erase it.

## REST and WebSocket contract

| Method | Path | Outcome |
|---|---|---|
| GET | `/health` | Query DB and report readiness |
| POST | `/api/v1/sessions` | Create session (201), duplicate = 409 |
| GET | `/api/v1/sessions` | Recent sessions and sample counts |
| GET | `/api/v1/sessions/{id}` | One session, or 404 |
| POST | `/api/v1/sessions/{id}/samples` | Insert 1–500 increasing samples (201) |
| GET | `/api/v1/sessions/{id}/samples?offset=0&limit=100` | Paginated history |
| GET | `/api/v1/sessions/{id}/stats` | Count, elapsed-time range, max RPM/speed |
| WS | `/ws/telemetry/{id}` | Receive `connected` / `telemetry` / `telemetry_batch` |

New session JSON:

```json
{"session_id":"my-demo-001","label":"Local simulation","source":"simulation"}
```

Bulk ingestion JSON shape:

```json
{"samples":[{"schema_version":"1.0","session_id":"my-demo-001","source":"simulation","elapsed_s":0.0,"timestamp_utc":"2026-01-01T00:00:00.000Z","engine_rpm":800.0,"vehicle_speed_kph":0.0,"coolant_temp_c":90.0,"intake_temp_c":29.0,"throttle_pct":2.0,"quality":"valid"}]}
```

Single telemetry WebSocket event:

```json
{"type":"telemetry","session_id":"my-demo-001","sample":{"schema_version":"1.0","session_id":"my-demo-001","source":"simulation","elapsed_s":0.0,"timestamp_utc":"2026-01-01T00:00:00.000Z","engine_rpm":800.0,"vehicle_speed_kph":0.0,"coolant_temp_c":90.0,"intake_temp_c":29.0,"throttle_pct":2.0,"quality":"valid"}}
```

## Concepts to understand for interviews

1. **REST vs WebSockets:** HTTP requests create and retrieve persisted data;
   WebSockets push changes without polling. A WebSocket connection stays open.
2. **Data validation:** Pydantic is the trust boundary for inbound data. It
   rejects out-of-range readings, invalid timestamps and unexpected properties.
3. **Database transactions:** All records in a POST batch commit together;
   partial writes on error are rolled back.
4. **Unique constraints:** Composite key `(session_id, elapsed_s)` prevents
   storing two conflicting samples at the same simulated instant.
5. **Asynchrony and threading:** FastAPI's async endpoint broadcasts on the
   event loop; synchronous SQLAlchemy work runs in a worker thread to avoid
   blocking WebSocket processing.
6. **Persistence vs transient events:** The DB retains all committed samples,
   while WebSocket events are live notifications and not a durable message queue.
7. **Time handling:** `elapsed_s` is simulation-time order; `timestamp_utc` is
   a synthetic, fixed UTC timestamp; replay pacing uses a monotonic wall clock.
8. **Limitations:** This demo has no user accounts/authentication, no clustered
   WebSockets, and no long-term schema migrations. Do not deploy it publicly.

## Acceptance criteria

- Existing Python simulator and C++ decoder still compile and pass tests.
- `python -m unittest discover -s tests -v` reports 31 passed tests.
- `/health` returns `database: connected`.
- 100 decoded records are accepted through HTTP and stored with correct values.
- A client attached to `/ws/telemetry/{id}` receives the sample updates live.
- `GET /api/v1/sessions/{id}/stats` returns count 100 after replay/import.
- A duplicate session, duplicate time, and invalid sensor value are rejected.
- Switching to PostgreSQL and replaying data works on your own machine.
- The GitHub Actions workflow passes (tests use SQLite; PostgreSQL must be
  checked locally).

## Troubleshooting

- **ModuleNotFoundError: `fastapi` / `sqlalchemy`:** Install dependencies using
  `.\\.venv\\Scripts\\python.exe -m pip install -r backend/requirements.txt`.
- **Port 8000 already used:** Stop the old Uvicorn terminal with `Ctrl+C`.
- **HTTP 409 session exists:** Choose a fresh `--session-id`. Duplicates are
  intentionally rejected to prevent accidental writes.
- **WebSocket monitor shows only connected:** Start the publisher using the
  *same session ID*, `--existing`, and `--mode replay` in another terminal.
- **PostgreSQL connection refused:** Start Docker Desktop and `docker compose
  up -d db`, check `docker compose ps`, then verify `.env` and restart Uvicorn.
- **Not all tests executed:** Compile Phase 2 C++ as shown above. Its integration
  tests skip if `decoder/bin/q50-can-decoder.exe` doesn't exist.
- **Old data appears:** SQLite and Postgres store persistent sessions. Create
  new session names; don't delete database files or volumes unless intended.
