# Phase 4 - React telemetry dashboard and simulated diagnostics

**Safety:** Simulation only. This project does not read from a vehicle, flash an ECU, actuate anything or send CAN traffic to a car. Fault thresholds are instructional and not Infiniti-specific.

## Components

- `frontend/src/App.tsx`: dashboard state, REST API session listing, WebSocket updates, playback transport, simulation-control buttons and diagnostics panels.
- `frontend/src/components/Visuals.tsx`: SVG gauges, time-series plots, original generic sedan visualization.
- `frontend/src/lib/api.ts`: typed REST requests, paginated history fetch and WebSocket URL.
- `frontend/src/lib/diagnostics.ts`: pure deterministic rule engine for simulated data.
- `frontend/src/lib/preview.ts`: offline UI preview dataset; always labeled synthetic.
- `backend/app/main.py`: adds bounded simulation-only demo routes. Existing Phase 3 routes remain compatible.
- `backend/app/schemas.py`: validates duration, sample rate, and scenario for demo requests.
- `tests/test_backend.py`: Phase 4 server integration tests.
- `frontend/tests/diagnostics.test.mjs`: alert rule tests.

## Windows 11 requirements

- Python 3.11+ and existing Phase 3 `.venv`.
- Node.js **22.16+** recommended for both Vite and its built-in TypeScript-strip test runner.
- VS Code (PowerShell terminal).
- SQLite (quick start) or Docker Desktop/PostgreSQL (existing Phase 3 setup).
- G++ only needed to re-run the Phase 2 C++ tests, not to launch the dashboard.

## Update from existing Phase 3 repository

Back up or commit your existing work. Extract `q50-digital-twin-phase4-update.zip` **into the existing project root**, not into an extra nested directory:

```powershell
Expand-Archive -LiteralPath "$HOME\Downloads\q50-digital-twin-phase4-update.zip" -DestinationPath . -Force
```

The update overlays the modified backend API, README, tests, CI workflow and `.gitignore`, and adds `frontend/` plus this guide. It does **not** replace your Phase 1/2 code, Git history, `.venv`, or `.env`.

## Run (two terminals)

1. From the **project root**, install Python dependencies (skip if already installed):

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
   ```

2. Ensure `.env` points to SQLite for an immediate start:

   ```env
   Q50_DATABASE_URL=sqlite+pysqlite:///./data/q50-local.db
   ```

   If you previously selected PostgreSQL in Phase 3, you may keep it, provided Docker and the database are running.

3. **Terminal A**, project root:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

   Verify `http://127.0.0.1:8000/health` reports `status=ok` and `version=0.4.0`.

4. **Terminal B**, project root:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

5. Open **http://127.0.0.1:5173/**. The Vite development server proxies `/api`, `/health` and `/ws` to FastAPI on port 8000. Do not visit the Vite page with `file://`.

## Demo workflow

- Choose **Mixed driving** and **30 seconds**; select **Start new simulation**. Watch gauges and graphs update as data is written to the Phase 3 database.
- Choose **Fault: overheating** and start a new session. After the synthetic coolant value reaches 105 °C, the diagnostics panel shows a warning; the 115 °C threshold produces a second, critical alert.
- Choose **Fault: sensor dropout**. A gap in the sample stream produces a telemetry-gap warning after samples resume.
- Click **Stop** during an active session to preserve the partial recording.
- Open a saved session in **Session History**. Use Replay, Pause, 0.5–4× speed, the scrubber, or **LIVE** to follow the most recent received sample.
- API docs at **http://127.0.0.1:8000/docs** show the new `/api/v1/demo/*` routes.

The "live" demo uses **Python simulator → FastAPI → database → WebSocket → React**, not the Phase 2 CAN decoder. To demonstrate the entire Python → CAN → C++ → API chain, follow Phase 2's encode/decode steps, then import `data/decoded/*.jsonl` with the existing Phase 3 publisher and view the resulting session in React.

## Important backend routes

- `POST /api/v1/demo/sessions` - creates a session and starts a bounded synthetic stream. Body e.g. `{"scenario":"mixed","duration_s":30,"hz":10,"seed":42}`.
- `GET /api/v1/demo/sessions/{id}` - status and sample count for an in-memory demo job.
- `POST /api/v1/demo/sessions/{id}/stop` - requests stopping the job.
- Existing Phase 3 routes for session history, sample pagination, statistics and WebSockets are unchanged.

Demo task status is held in one local server process and does not survive a restart; the **committed telemetry history does survive**. A production system would use a durable task queue and shared pub/sub. Keep **one Uvicorn worker**.

## Validation

From project root:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Expected: **34 Python tests** if the Phase 2 decoder is built; the 7 C++ tests may skip if it is missing. Rebuild with the Phase 2 command to run them all.

From `frontend/`:

```powershell
npm run test:logic
npm run build
```

Expected: **4 diagnostic logic tests** and a successful TypeScript/Vite production build. Run these commands locally to verify that the TypeScript checks and production build succeed.

## Key concepts to learn

1. **Browser → API communication**: use `fetch` to query historical session data, while Vite proxies same-origin requests to FastAPI.
2. **WebSockets**: a persistent connection delivers committed telemetry to React. A reconnect triggers history reconciliation.
3. **React state**: changes to selected session, incoming samples or playhead trigger reactive dashboard renders.
4. **TypeScript contracts**: shared record types reflect backend Pydantic models, reducing mismatches.
5. **Timestamp-driven replay**: `requestAnimationFrame` updates playback based on elapsed time rather than assuming every packet arrives.
6. **Finite thresholds / event edges**: alerts trigger when a threshold is first crossed, avoiding 100 duplicates for the same fault.
7. **Bounded synthetic jobs**: background coroutine writes samples one by one, can stop, and is canceled on app shutdown.

## Known limitations

- Demo rules are **not** mechanical diagnoses and do not decode OBD DTCs.
- One FastAPI worker; the in-memory WebSocket hub is not distributed.
- Sessions over 20,000 samples need a paginated/streamed visualization extension.
- No authentication; bind services to `127.0.0.1` and do not expose to the public internet.
- Browser mock visualization is generic and not an official Infiniti 3D/CAD model.
- Real vehicle communication and bench CAN hardware are outside this phase.
