# Q50 Digital Twin

**Simulation-first automotive telemetry + C++ CAN decoding + real-time FastAPI backend.**
Inspired by a personally modified 2017 Infiniti Q50 Red Sport 400.

> **Safety:** The CAN IDs `0x500`/`0x501` and payload layout are deliberately
> synthetic, not Infiniti/Nissan frames. This repository never sends any
> commands to a car, connects to an ECU, or claims to diagnose real faults.
> The Phase 3 API is **local-only development code with no authentication**.

## Working capabilities (Phases 1–3)

- **Phase 1:** Deterministic Python vehicle simulation, reproducible JSONL/CSV output.
- **Phase 2:** Synthetic 8-byte CAN encoding in Python, independent C++17 decoder,
  sequence validation and exact round-trip testing.
- **Phase 3:** FastAPI REST endpoints, Pydantic validation, transactional SQLAlchemy
  storage, PostgreSQL/SQLite support, WebSocket telemetry fan-out, session listing,
  paginated samples, statistics and a real-time publisher/monitor CLI.
- **Verification:** 31 automated tests (8 simulator, 12 CAN, 11 backend) when the
  Phase 2 C++ executable is compiled. The GitHub Actions workflow builds it.

## Architecture

```text
Python simulated vehicle -> synthetic CAN encoder -> .canlog
   -> C++17 decoder -> decoded JSONL -> Phase 3 publisher
   -> POST /api/v1/sessions/{id}/samples -> Pydantic validation
   -> SQLAlchemy transaction -> SQLite (quick start) / PostgreSQL (Docker)
                                  |
                                  `-> WebSocket broadcast (committed samples)
                                      -> terminal monitor (React UI in Phase 4)
```

## Requirements

- Python 3.11+; Windows 11 PowerShell/VS Code (Linux/macOS also supported)
- C++17 compiler for Phase 2 tests (MSYS2 UCRT64 G++ on Windows)
- Docker Desktop only if you want PostgreSQL rather than the SQLite quick start

## Quick start (Windows PowerShell, from repository root)

```powershell
# Reuse your existing .venv from Phase 1 if it already exists.
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item .env.example .env  # Skip if you already have .env

# Compile C++17 decoder to enable all Phase 2 integration tests.
$env:Path = "C:\msys64\ucrt64\bin;$env:Path"
New-Item -ItemType Directory -Force decoder\bin | Out-Null
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic decoder/src/main.cpp -o decoder/bin/q50-can-decoder.exe

# 31 tests = 8 Phase 1 + 12 Phase 2 + 11 Phase 3.
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# Start backend (leave this terminal running).
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

- API docs: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>
- Detailed Windows setup and live WebSocket walkthrough: **[docs/phase3.md](docs/phase3.md)**

### Import 100 samples quickly (new PowerShell terminal)

```powershell
.\.venv\Scripts\python.exe -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id q50-import-001 --mode import
```

Then open <http://127.0.0.1:8000/api/v1/sessions/q50-import-001/stats>.
This creates its own session. Use a new `--session-id` each time to avoid duplicate inserts.

### Watch live WebSocket data (three terminals)

**Terminal A:** run Uvicorn as above.

**Terminal B:** create an empty session first, then connect your watcher:

```powershell
$body = @{session_id="q50-live-001"; label="Live Phase 3 demo"; source="simulation"} | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/sessions -Method Post -ContentType application/json -Body $body
.\.venv\Scripts\python.exe -m backend.tools.watch --session-id q50-live-001
```

**Terminal C:** replay the recording at simulated real time:

```powershell
.\.venv\Scripts\python.exe -m backend.tools.publish --input data/decoded/mixed_10s.jsonl --session-id q50-live-001 --mode replay --existing --rate 1
```

You should see approximately ten samples per second printed in Terminal B.
Repeat with a **new** session ID on each run.

## Use PostgreSQL instead of SQLite (optional, recommended for the finished project)

```powershell
docker compose up -d db
docker compose ps
```

Edit your **untracked** `.env` file and set:

```env
Q50_DATABASE_URL=postgresql+psycopg://q50dev:q50_dev_only@127.0.0.1:5433/q50digitaltwin
```

Restart Uvicorn; then verify <http://127.0.0.1:8000/health>. The API will create
its database tables on startup. The two databases are separate (data is **not**
automatically migrated from SQLite to PostgreSQL).

To inspect PostgreSQL:

```powershell
docker compose exec db psql -U q50dev -d q50digitaltwin -c "SELECT count(*) FROM telemetry_records;"
```

To stop PostgreSQL safely, preserving its Docker volume: `docker compose down`.
`docker compose down -v` **deletes the stored database volume**; only use that
if you intentionally want to discard the data.

## API endpoints

| Method | Route | Result |
|---|---|---|
| GET | `/health` | DB connectivity |
| POST | `/api/v1/sessions` | Create a simulated driving session |
| GET | `/api/v1/sessions` | List sessions |
| GET | `/api/v1/sessions/{id}` | Session summary/count |
| POST | `/api/v1/sessions/{id}/samples` | Commit 1–500 ordered telemetry samples |
| GET | `/api/v1/sessions/{id}/samples?offset=0&limit=100` | Paginated samples |
| GET | `/api/v1/sessions/{id}/stats` | Count/elapsed time/max RPM/max speed |
| WS | `/ws/telemetry/{id}` | `connected`, `telemetry`, `telemetry_batch` events |

### Engineering limitations

- Single-process WebSocket connections; not a distributed message broker.
- Session ingestion requires monotonically increasing elapsed timestamps.
- No authorization; bind the server to `127.0.0.1` only.
- Phase 3 accepts only `source=simulation` and `quality=valid` telemetry.
- SQLAlchemy `create_all` is used in development; production systems require
  schema migration tooling (e.g., Alembic).
- PostgreSQL is supported/configured, but CI currently tests **SQLite**; verify
  PostgreSQL using Docker on your development machine.
- The replay tool uploads decoded JSONL, not live car data or real bus frames.

## Repository guide

- [`simulator/model.py`](simulator/model.py) — vehicle simulation and time steps.
- [`canbus/codec.py`](canbus/codec.py) — synthetic CAN binary encoding.
- [`decoder/src/main.cpp`](decoder/src/main.cpp) — independent C++ decoder.
- [`backend/app/main.py`](backend/app/main.py) — HTTP endpoints and WebSocket API.
- [`backend/app/db.py`](backend/app/db.py) — SQLAlchemy database tables.
- [`backend/app/schemas.py`](backend/app/schemas.py) — strict input validation.
- [`backend/app/hub.py`](backend/app/hub.py) — in-process WebSocket fan-out.
- [`backend/tools/publish.py`](backend/tools/publish.py) — JSONL importer/replayer.
- [`backend/tools/watch.py`](backend/tools/watch.py) — WebSocket terminal monitor.
- [`tests/test_backend.py`](tests/test_backend.py) — database + API integration tests.
- [`docs/phase3.md`](docs/phase3.md) — Phase 3 details and troubleshooting.

**Next:** Phase 4 — React/TypeScript dashboard, live charts and fault visualization.
