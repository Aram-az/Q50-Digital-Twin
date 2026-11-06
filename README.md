# Q50 Digital Twin

A simulation-first automotive telemetry portfolio project inspired by a modified 2017 Infiniti Q50 Red Sport 400. **All Phase 1 data is synthetic, not collected from a vehicle.**

## Requirements
- Python 3.11 or newer (standard library only for Phase 1)

## Windows PowerShell quick start
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m simulator.cli --scenario mixed --duration 10 --hz 10 --seed 42 --output data/sample/mixed_10s.jsonl
Get-Content data/sample/mixed_10s.jsonl -TotalCount 3
```
If `python` is not on PATH, use `py` to create the virtual environment instead.

## Other scenarios
```powershell
.\.venv\Scripts\python.exe -m simulator.cli --scenario idle --duration 10 --output data/sample/idle_10s.csv --format csv
.\.venv\Scripts\python.exe -m simulator.cli --scenario cruise --duration 10 --output data/sample/cruise_10s.jsonl
.\.venv\Scripts\python.exe -m simulator.cli --scenario acceleration --duration 20 --output data/sample/accel_20s.jsonl
```

`--duration` is simulated time, NOT real-time playback. The simulator writes the recording immediately.

## Principles
- Fixed-step simulation: each sample advances by 1/hz seconds.
- First-order dynamic response: speed approaches a throttle-derived target.
- Deterministic random generator: `--seed` repeats RPM/intake noise.
- JSON Lines: one self-contained JSON object per line for future streaming/import.
- Sample provenance: all values explicitly tagged `source=simulation`.
- Not a calibrated engine model or a vehicle-diagnostic tool.

See `docs/phase1.md` for milestones and constraints.
