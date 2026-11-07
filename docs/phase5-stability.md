# Phase 5.1 - Instrument stability and layout patch

This is a **frontend-only** patch built from the distributed Phase 5 source. It does not change the Python backend, database, vehicle simulator, C++ decoder, or CAN frame protocol.

## Fixes

- Stable 1:1 aspect ratio for main RPM/speed dials; stronger center-column sizing and less risk of crowded gauges at intermediate viewport widths.
- Needle rotation anchored to the SVG `viewBox` center, independent of parent layout and scaling.
- Auxiliary gauge arcs now use one *fixed* SVG semicircle with animated `stroke-dasharray` progress, rather than rewriting the path geometry on every sample.
- Auxiliary gauge SVGs scale proportionally (`width` + aspect ratio, no forced mismatched pixel height); gauge cards have predictable grid rows and footnotes no longer collide with labels.
- Breakpoints reworked for widths under 1100, 920, 540, and 375 px. The cluster switches to two primary dials followed by a control strip before the center column becomes overcrowded.
- Offline preview reverses smoothly at each end instead of jumping from the final frame to the first frame.
- Preview stays clearly labeled while a new live session is waiting for its first sample; avoids displaying a static value that looks like frozen real telemetry.
- Replay peak gauges only consider samples at or before the playback cursor, not data from the future of the selected recording.
- Typical single-sample WebSocket updates append efficiently instead of always rebuilding and sorting the full history.
- Improved narrow-width MFD toolbar wrapping, small button layout, and responsive scope readouts.

## Install over your existing Phase 5 repository

In your repository root (Windows PowerShell):

```powershell
# Optional: save a local backup before overwriting files.
Copy-Item .\frontend "$HOME\q50-frontend-backup" -Recurse -Force

Expand-Archive -LiteralPath "$HOME\Downloads\q50-digital-twin-phase5-1-fix.zip" -DestinationPath . -Force

cd frontend
npm run test:logic
npm run build
npm run dev
```

`npm install` first if your project's `node_modules` is missing. The FastAPI backend starts separately, as described in `README.md`.

## Manual browser smoke test

In Chrome or Edge DevTools Device Toolbar, check 1440, 1024, 820, 540, 390, and 360 px widths (and a range of browser zoom levels):

- Both large dials stay circular, aligned, and fully visible; needles rotate around the center.
- Middle readout, rev-light bar, and throttle indicators never cover the scales.
- MFD presets 01–04 stay clickable and do not overflow the viewport.
- Each auxiliary arc stays centered in its own instrument well during telemetry updates.
- Offline attract loop does not jump sharply at its boundaries.
- Live simulation, replay, pause, scrub, overheating, and dropout continue to work against the Phase 4/5 API.

## Verification

- 11 Node frontend logic tests pass (including two new gauge/loop regression tests).
- All 9 frontend TS/TSX files pass TypeScript syntactic transpilation.
- Full Vite/React browser build was not possible in the patch-generation environment because npm dependency installation was unavailable. **Run `npm run build` locally before committing.**

These are simulation-only gauges. Their thresholds are illustrative and do not represent Infiniti OEM specifications.
