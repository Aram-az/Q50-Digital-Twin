# Q50 Digital Twin

**Full-stack, simulation-first automotive telemetry engineering portfolio inspired by a modified 2017 Infiniti Q50 Red Sport 400.**

> **Simulation only:** All existing measurements are synthetic. This program does not attach to, command or tune a vehicle. Synthetic CAN IDs `0x500`/`0x501` are project-defined, not Infiniti OEM IDs. The diagnostic alerts are not validated vehicle diagnoses.

## Features (Phase 4)

| Layer | Implementation | Features |
| --- | --- | --- |
| Simulator | Python | Deterministic vehicle states and telemetry (Phase 1) |
| Automotive protocol | Python encoder, C++17 decoder | 8-byte synthetic CAN frames, validation, sequence counters (Phase 2) |
| API | FastAPI, WebSockets | Sessions, persistent storage, live broadcasting (Phase 3) |
| Database | SQLite / PostgreSQL | Recorded sessions, statistics, sample retrieval (Phase 3) |
| Dashboard | React, TypeScript, Vite | Live gauges, time-series plots, saved sessions and replay (Phase 4) |
| Diagnostics | TypeScript rules | Demonstration-only overheating and dropout detection (Phase 4) |
| Live demo | Python coroutine | Start/stop bounded synthetic streams from React (Phase 4) |
| Validation | unittest + Node test runner | Backend, CAN, simulator and alert rules |

## Architecture

```text
[Python simulator] ---> [Synthetic CAN encoder] ---> [C++ decoder]
         |                                              |
         | (Live demo bypasses CAN decoder)             | (Historical import)
         +--------------------+-------------------------+
                              v
                       [FastAPI ingestion]
                       /               \\
                      v                 v
              [SQLite/Postgres]    [WebSocket hub]
                      |                 |
                      +-------+---------+
                              v
                     [React dashboard]
               [Charts, replay, demo diagnostics]
```

## Quick start — Windows PowerShell

Requires **Python 3.11+** and **Node.js 22.16+** recommended. VS Code is optional.

```powershell
# From repository root. First time only:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

For the easiest start, ensure `.env` contains:

```env
Q50_DATABASE_URL=sqlite+pysqlite:///./data/q50-local.db
```

**Terminal 1**, from repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2**, from repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173/**. The dashboard will show a clearly identified offline preview if the API is unavailable.

The API Swagger documentation is at **http://127.0.0.1:8000/docs**.

## Demo to try

1. Start a **30-second Mixed driving** simulation from the dashboard.
2. Watch RPM, speed and temperatures update from WebSocket messages.
3. Start a **Fault: overheating** scenario and inspect simulated diagnostic events.
4. Select a saved session and replay it using its original timestamps.
5. Try **Fault: sensor dropout** to observe missing-sample detection.

For the **actual Phase 2 C++ data path**, run the synthetic CAN encoder/decoder and import its decoded JSONL using `backend.tools.publish`. See [`docs/phase2.md`](docs/phase2.md) and [`docs/phase3.md`](docs/phase3.md).

## Tests

```powershell
# Python backend + phases 1–3 (build the C++ decoder first to avoid skips)
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# Frontend, from `frontend/` (Node.js 22.16+ recommended)
npm run test:logic
npm run build
```

- Python: **34 tests passed** in the artifact environment.
- Frontend: **4 diagnostics tests passed** with Node's TypeScript strip loader.
- Full Vite production build: **not tested in the artifact environment** (npm registry inaccessible). Run `npm install && npm run build` locally.

## Docs

- [Phase 1: deterministic simulation](docs/phase1.md)
- [Phase 2: synthetic CAN protocol and C++](docs/phase2.md)
- [Phase 3: FastAPI, WebSockets, database](docs/phase3.md)
- [Phase 4: frontend, live simulation, replay, diagnostics](docs/phase4.md)

## Limitations and roadmap

This is a local, single-user engineering project without authentication, a distributed message broker or calibrated drivetrain modeling. Later work may add isolated ESP32/CAN bench hardware, measured performance tests, richer fault models, secure deployment, and independently verified **read-only** recordings. No ECU flashing or actuation is planned.
