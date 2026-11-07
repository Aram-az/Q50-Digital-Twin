# Q50 Digital Twin

**Automotive telemetry engineering - from simulated vehicle data to an original native Infiniti App Garage application.**

A personal computer-engineering project built around a **2017 Infiniti Q50 Red Sport 400**, combining a synthetic CAN pipeline, C++ decoding, Python simulation, FastAPI, a real-time React instrument cluster, and a **read-only native Android app for the factory InTouch display**.

> **In-car milestone - owner-reported, November 7, 2026:** The native `Q50 Native Telemetry` application was compiled, packaged as an `.epk`, installed and reported working on the developer's 2017 Q50 Red Sport 400. Compatibility with other vehicles, head-unit versions, and sensor calibration remains unverified. The desktop dashboard is **still simulation/recording-driven**; it does **not yet ingest real data from the in-car app**.

## At a glance

| Component | Technology | What it demonstrates | Status |
| --- | --- | --- | --- |
| Virtual vehicle | Python | Deterministic driving scenarios and reproducible telemetry | Implemented |
| Synthetic CAN pipeline | Python + C++17 | 8-byte frame encoding, low-level decoding, error handling | Implemented |
| Telemetry service | FastAPI + WebSockets | Validated ingest, sessions and live events | Implemented |
| Persistence | SQLite / PostgreSQL | Driving-session storage and historical statistics | Implemented; local DB options |
| Desktop cluster | React + TypeScript + SVG | Animated GT-R-inspired gauges, live simulation, replay, warnings | Implemented |
| **In-car App Garage app** | **Java / Android API 10 / Canvas / EPK v2** | **Legacy Android integration and read-only head-unit sensors** | **Built and installed on owner's Q50 (reported)** |
| Real-car → desktop bridge | To be designed | Export/import of validated in-car recordings | Not implemented |

## Two different sources of telemetry

**1. Synthetic desktop pipeline (Phases 1–5.1)**

```text
Python Q50-inspired simulator -> synthetic CAN encoder -> C++ decoder
              |                                  |
       live simulation                    JSONL recordings
              +------------------+---------------+
                                 v
                         FastAPI ingestion
                          /           \
                   SQL storage    WebSocket hub
                          \           /
                           React dashboard
```

The synthetic IDs `0x500` and `0x501` are **project-defined**, not Infiniti OEM message IDs. The desktop simulation is not calibrated to a specific ECU, tune or drivetrain.

**2. Native vehicle interface (Phase 6A)**

```text
Factory infotainment sensor services
                 |
     Android SensorManager
                 |
  Q50 Native Telemetry (Java)
       |                 |
  sensor freshness   custom Canvas gauges
       |
   in-car display only (currently)
```

The native app uses documented vendor sensor interfaces to **read** available signals; it does not command CAN, flash the ECU, change calibrations or tune the vehicle. Sensor identifiers/scales are provisional and should be independently checked against the vehicle's instruments. Native values are **not yet** transferred into the desktop database.

## Native Q50 app - validated installation milestone

- Custom Java/Canvas instrument UI designed for the legacy **800 × 480** infotainment screen, with RPM and speed dials, thermal and throttle readouts, a raw sensor audit and visible demo mode.
- Subscribes to available Android vehicle sensors using `SensorManager`; shows missing or stale values instead of inventing live readings.
- Builds a signed legacy-compatible APK and wraps it as an App Garage `.epk` using an openly documented EPK v2 process and public compatibility certificate.
- **Owner-tested installation and operation on a 2017 Q50 Red Sport 400**. This documents an integration result, not independent verification of each sensor's calibration, update rate or accuracy.
- The app is intentionally read-only and does not request network or ECU control access.

**Source, exact Windows build instructions, tests, safety limitations and credits:** [`native-app/README.md`](native-app/README.md).

## Desktop instrument lab

The original Phase 4 dashboard was redesigned in Phase 5 and refined in Phase 5.1 into a custom performance display:

- Twin animated analog-style gauges, redline/shift-light treatment and dynamic throttle indication.
- Four multi-function display presets: **DRIVE**, **THERMAL**, **TRACE**, **LOGBOOK**.
- Synthetic drive controls, time-accurate session replay, recording history and demonstration-only diagnostic alerts.
- Clearly labeled offline animation when the live development backend is unavailable.

The presentation takes inspiration from performance instrument clusters but uses original React, SVG and CSS. Gauge ranges and alert thresholds are **not certified Infiniti specifications**.

## Quick start - desktop (Windows PowerShell)

Prerequisites: Python 3.11+, Node.js version supported by the frontend toolchain, and Git. Open PowerShell at the repository root.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

For a local SQLite database, use this setting in `.env`:

```env
Q50_DATABASE_URL=sqlite+pysqlite:///./data/q50-local.db
```

Start the API in terminal A:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Start the desktop dashboard in terminal B:

```powershell
cd frontend
npm install
npm run dev
```

- Dashboard: `http://127.0.0.1:5173/`
- API documentation: `http://127.0.0.1:8000/docs`

Start a synthetic session, inspect gauges, try an injected overheating or dropout condition, and replay a saved session. The API and UI are intended for local development, not public deployment.

## Build native App Garage app (Windows PowerShell)

Use **JDK 17** for the legacy Android/D8 toolchain. Install Android SDK platform 34 and Build-Tools 34.0.0. With a Python virtual environment available:

```powershell
.\.venv\Scripts\python.exe -m pip install -r native-app\requirements-build.txt
.\native-app\build.ps1
```

Successful build outputs are:

```text
native-app/build/q50-native.apk
native-app/build/q50-native.epk
```

For build-key handling, detailed preflight tests, and **parked-only** compatibility checks, follow [`native-app/README.md`](native-app/README.md) rather than installing solely from these brief instructions. Never commit `native-app/signing/`, local secrets, `.env`, build outputs or recordings containing private location data.

## Testing

```powershell
# Phases 1–4: Python backend and simulation tests
.\.venv\Scripts\python.exe -m unittest discover -s tests -v

# Phase 6A: packaging/manifest tests
.\.venv\Scripts\python.exe -m unittest discover -s native-app\tests -p 'test_*.py' -v

# Phase 6A: Java telemetry-state tests
javac --release 8 -d native-app\build\classes native-app\src\com\aram\q50telemetry\SensorState.java native-app\tests\SensorStateTest.java
java -cp native-app\build\classes SensorStateTest
```

Frontend checks (inside `frontend/`):

```powershell
npm run test:logic
npm run build
```

The native-app tests, Python tests and browser build are separate; a successful APK/EPK packaging operation does not prove each live signal is calibrated.

## Project documentation

- [`native-app/README.md`](native-app/README.md) - native code, EPK packaging, Windows setup and credits
- [`docs/phase1.md`](docs/phase1.md) - synthetic simulator
- [`docs/phase2.md`](docs/phase2.md) - synthetic CAN encoding and C++ decoding
- [`docs/phase3.md`](docs/phase3.md) - backend, sessions and WebSockets
- [`docs/phase4.md`](docs/phase4.md) - dashboard and replay
- [`docs/phase5.md`](docs/phase5.md) - custom performance instrument design
- [`docs/phase5-stability.md`](docs/phase5-stability.md) - responsive layout and animation fixes
- [`native-app/docs/INSTALL_WINDOWS.md`](native-app/docs/INSTALL_WINDOWS.md) - native build and install walkthrough

## Next engineering milestones

- Confirm actual RPM, speed, temperature and throttle signal values against reliable instrumentation **while stationary**; record supported and unsupported sensor types.
- Measure latency, staleness, event rates and UI frame consistency on the target unit.
- Research a user-initiated, read-only export path for recording on-car data and importing it into the existing desktop Digital Twin. **This capability is not implemented.**
- Publish a short, parked-vehicle demonstration with a clear distinction between measured telemetry and synthetic preview.

## Safety, scope and attribution

This is an independent educational engineering project, not an Infiniti/Nissan product or certified diagnostic instrument. It is **read-only** and must not be used to make safety-critical driving decisions. Avoid screen interaction while driving. No ECU reflashing, tune control, commands to actuators or bypassing driving restrictions are within scope.

The App Garage integration technique and vendor sensor hypotheses were informed by the public, MIT-licensed research of [AppGarage Dash](https://github.com/bugjosh/appgarage-dash) and [Q50 App / O.R.I.O.N.](https://github.com/czpeanut/q50-app). The in-car application code in this repository is a separate implementation.
