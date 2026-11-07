# Technical specification — Q50 native proof of concept

## System boundary

Vehicle ECU -> OEM vehicle middleware -> Android SensorManager -> Q50Activity
-> SensorState (raw events) -> TelemetryView (read-only Canvas rendering)

The head unit may not expose the same `SensorManager` IDs on all variants.

## Data discipline

- Raw event source: Android sensor callback.  No simulated readings automatically
  replace a missing source; no latest-known reading after 3000 ms.
- `SensorState` rejects NaN, +/-infinity and impossible sensor type indexes.
- Unit assumptions for RPM / km/h / degC are PROVISIONAL until tested against
  independent readings on this specific head unit.
- No engine boost, AFR, knock, ignition timing or tune map signals are claimed.
- No sensor stream leaves the native app; the next phase can add user-initiated
  session export after reviewing storage and privacy boundaries.

## Rendering

Legacy Android Canvas only; 800x480 coordinate grid with uniform scaling.
Needles smooth toward most recent validated measurement without changing the
underlying readings. No external fonts, frameworks, or WebView.

## Lifecycle & resource hygiene

Subscribe once in Activity.onResume. Always unregister in onPause and before
resubscription. Request 200-ms updates for slow signals and GAME rate for fast
signals, but the vendor HAL may cap actual rates. Redraw at most every 50 ms
on sensor callbacks, with a slower heartbeat to update stale states.

## Why this app is read-only

The manifest requests only the vendor's observed CAN-read permission. No
INTERNET, WRITE_EXTERNAL_STORAGE, Bluetooth, camera, location, or ECU/control
permissions. The app does not open raw CAN device files or implement CAN TX.

## Trust & compatibility

An EPK wrapper proves container structure, not install trust or firmware
compatibility. The public certificate may not match every head unit. The
model-year compatibility and signal table are hypotheses to verify.
The manifest explicitly leaves the vehicle distraction restrictions enabled.

## Interview demonstration once verified

1. Show the Android app source (Java, activity lifecycle, custom Canvas).
2. Demonstrate stationary live RPM and the audit screen.
3. Document measured event rate, stale-data behavior and uptime.
4. Show the EPK inspector matching the third-party container field format.
5. Show the separate desktop simulation/CAN/C++/FastAPI software architecture.
