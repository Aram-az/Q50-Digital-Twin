# System architecture and engineering decisions

[← README](../README.md) · [Browser showcase](showcase.md) · [Native app](../native-app/README.md)

## Purpose

The project explores the same general problem—vehicle telemetry—across three different environments with different trust boundaries. The **synthetic CAN implementation**, the **local desktop API**, and the **native in-car Android sensor reader** are distinct systems. Do not confuse simulated values with actual ECU measurements.

## 1. Synthetic telemetry path

The Python simulator creates deterministic, timestamped samples. A synthetic CAN encoder packs speed/RPM/throttle and temperature into two custom 8-byte message types (IDs `0x500`, `0x501`), while an independent C++17 decoder validates and reconstructs samples. This provides reproducible examples for testing encoding, sequence checks and numerical scaling, but **does not claim reverse engineering of real Nissan CAN frames**.

`TelemetrySample` JSONL → synthetic binary frames → C++17 decoded JSONL → FastAPI ingestion.

## 2. Backend path

FastAPI validates incoming records, commits a driving session to SQL storage, then broadcasts committed telemetry over WebSockets. SQLAlchemy supports a local SQLite database or a PostgreSQL service. The React application provides a live display and historical replay. The backend is intentionally **local-only**, with no internet-facing authentication or managed cloud services.

### Why persist before broadcasting?

Broadcasting only after a successful commit prevents the browser showing samples that failed validation or were rolled back. Session IDs and elapsed-time uniqueness make duplicates detectable.

### Why timestamp-aware replay?

A sensor-dropout scenario must appear as a time gap in the playback timeline rather than pretending measurements were recorded continuously.

## 3. Native head-unit app

The pure-Java legacy Android application is designed for App Garage-capable infotainment firmware (Android API 10). Its read-only `SensorManager` listener receives possible vendor vehicle sensor events. `SensorState` tracks timestamps, availability and staleness independently of Canvas drawing. The app does not request network permissions or write to ECUs.

On November 7, 2026, the owner reported successfully building/installing/launching the packaged app on a 2017 Q50 Red Sport 400. Sensor readings, data quality and firmware-specific mappings are *not independently calibrated*. There is no current data path from the native app to the desktop service.

## 4. Public GitHub Pages showcase

The published site is compiled using `vite build --mode showcase` and is **fully static**. A deterministic TypeScript generator creates sample signals inside the browser. The mode makes no HTTP API or WebSocket requests; session history lives only in memory and disappears on reload. The same React gauges, thermal and dropout logic and replay controls can be demonstrated to recruiters without a backend.

The showcase must never be described as a real vehicle feed or a publicly hosted FastAPI instance.

## Testing and limitations

- Python `unittest`: simulator, synthetic CAN, schema and backend integration tests.
- Java unit checks: sensor-state logic without Android runtime dependency.
- Python EPK/manifest checks: format and build assumptions.
- Node tests: diagnostics, needle mapping and synthetic public showcase behavior.
- GitHub Actions: C++ decoder build, round-trip check, Python/Java tests, React build and Pages artifact.

**Pending:** independently measured sensor calibration, deployment on additional head-unit firmware, API authentication, head-unit data export, real ECU protocol documentation and automotive safety validation.
