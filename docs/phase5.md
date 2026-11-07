# Phase 5 / Red Sport Instrument Lab

**Objective:** Replace the Phase 4 template-like dashboard with a purpose-built, functional, motorsport-inspired instrument UI. This changes **only the frontend**, not the simulator, C++ decoder, FastAPI server, or databases.

## Concept / Design

- **GT-R MFD influence:** analog micro-gauges, instrument labels, numbered display presets, graphite housing, and compact performance traces (reference: Polyphony Digital's GT-R MFD portfolio, Nissan GT-R MFD documentation).
- **Q50 Red Sport identity:** twin main instruments, offset Q50 display and R/S 400 edition marking, restrained red highlights, pale gauge lettering, and workshop-style bench controls. No OEM imagery or logos are embedded.
- **Instrument-first hierarchy:** large animated tachometer and road speed, mechanical preset switches, then control hardware. No sidebar or SaaS statistics cards.
- **No external fonts, assets, telemetry services, or extra dependencies.** All dials are original SVG geometry; all texture and finish is CSS.

## Live data behavior

1. Without a backend or before selecting a session, the dashboard cycles an **explicitly labeled offline simulation preview** at 10 Hz. This is a UI demonstration, not vehicle input.
2. With the FastAPI backend available, select scenario and duration, then **START SIMULATION**. The backend creates records and broadcasts a WebSocket stream. Needles and MFD values follow the latest sample when LIVE mode is active.
3. Select an existing session in preset `04 / LOGBOOK`; press REPLAY to play its recorded timestamps (including gaps), or use the timeline to scrub.
4. `02 / THERMAL` shows rule-based demo alerts and a temperature trace, `03 / TRACE` visualizes RPM and speed, and `01 / DRIVE` shows six independent signal/peak dials.

### How the geometry works

- Needle angle is `135 + clamp((value-min)/(max-min),0,1) * 270` degrees.
- The SVG face uses radial tick coordinates `(cx + cos(angle)*r, cy + sin(angle)*r)`.
- The needle is rotated around an SVG pivot with a 170 ms visual transition.
- Rev LEDs and throttle stack are integer-quantized representations of the input values.
- Trends plot measured/recorded samples, with explicit visual breaks for simulated sample gaps over 0.5 s.
- The built-in preview does not run an API, but updates the animated gauge positions with a 100 ms interval.

## Windows update steps

1. Commit/preserve any uncommitted Phase 4 changes before overwriting files.
2. From **the root** of the existing `q50-digital-twin` repo in PowerShell:
   `Expand-Archive -LiteralPath "$HOME\Downloads\q50-digital-twin-phase5-update.zip" -DestinationPath . -Force`
3. Terminal 1 from root: ` .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload `.
4. Terminal 2: `cd frontend` then `npm install` (first time only), `npm run test:logic`, `npm run build`, `npm run dev`.
5. Open `http://127.0.0.1:5173`. Choose each preset, start a synthetic drive, run a fault, and replay a saved session.

To test the visual design without starting the backend, you may run **only** the frontend; it will show its animated, explicitly labeled offline preview. This mode does not persist any data.

## Safety and accuracy

This application is not connected to a vehicle and is not an OEM diagnostic instrument. Simulated CAN identifiers belong to this project. Temperature thresholds, gauge ranges, RPM red highlight, and all simulated inputs are for UI/engineering testing only. The project sends no ECU, OBD or actuator commands.

## Verification notes

The backend 34 tests and frontend pure-logic 9 tests were executed successfully in the build environment. TypeScript source syntax and a local shim-based type analysis passed. `npm install`/actual Vite production bundling and a graphical browser render **must be verified on your Windows machine** because the npm registry/browser preview was unavailable in the build environment.
