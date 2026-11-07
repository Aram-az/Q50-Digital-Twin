# Phase 1 - Simulation foundation

## Scope
Synthetic vehicle telemetry, fixed-step deterministic simulation, normalized data schema, CLI recording to JSONL/CSV and automated tests.

## Not included yet
Live OBD-II, CAN decoding, embedded firmware, backend, dashboard, real-time wall-clock streaming or real Q50 calibration.

## Acceptance criteria
1. Unit tests pass.
2. Running mixed scenario at 10Hz for 10 seconds writes exactly 100 JSONL objects.
3. Re-running with identical parameters produces byte-for-byte identical output.
4. Every sample has `source=simulation` and carries units defined in `simulator/model.py`.
5. Invalid simulator parameters return a nonzero exit status.

## Model limitations
The RPM/speed/temperature relationships are simplified mathematical functions. They deliberately omit drivetrain gearing, turbo dynamics, traction, thermal control, ECU calibration and realistic engine load. They must never be used as mechanical safety thresholds or Q50-specific performance claims.
