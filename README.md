# Q50 Digital Twin

**Simulation-first automotive telemetry + embedded/software engineering project**
inspired by a personally modified 2017 Infiniti Q50 Red Sport 400.

> **Safety:** Every CAN identifier and payload in Phase 2 is **synthetic**, not
> an Infiniti/Nissan CAN ID, a standardized OBD-II PID or a documented car ECU
> message. Never transmit these test frames onto a physical vehicle bus.
> This code does not connect to your car.

## Current capabilities (Phase 1 + Phase 2)

- Deterministic Python simulator for RPM, speed, throttle and temperatures.
- CSV/JSONL export with labeled synthetic data provenance.
- Python synthetic CAN encoder (two 8-byte payloads per sample).
- Independent C++17 decoder with sequence checking and robust validation.
- Cross-language round-trip verifier: decoded JSONL exactly equals original.
- Automated tests (including corrupted frames and counter wraparound).
- GitHub Actions CI workflow compiling C++ and testing the pipeline on Linux.

## Architecture

```text
Python simulated telemetry -> JSONL -> Python CAN encoder
    -> synthetic .canlog -> C++ decoder -> decoded JSONL
```

## Requirements

- Python 3.11+ (standard library, no `pip install` needed)
- Windows 11 PowerShell + VS Code
- C++17 compiler such as MSYS2 **UCRT64** g++

## Windows PowerShell quick start

Run these commands **from the project's root folder**, where `README.md` lives.

```powershell
# Skip if you already created .venv for Phase 1.
python -m venv .venv

# Add the default UCRT64 compiler folder to THIS PowerShell session's PATH.
$env:Path = "C:\msys64\ucrt64\bin;$env:Path"
g++ --version

# Build C++17 decoder. UCRT64 toolchain supplies runtime DLLs on PATH.
New-Item -ItemType Directory -Force decoder\bin | Out-Null
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic decoder/src/main.cpp -o decoder/bin/q50-can-decoder.exe

# End-to-end experiment.
.\.venv\Scripts\python.exe -m simulator.cli --scenario mixed --duration 10 --hz 10 --seed 42 --output data/sample/mixed_10s.jsonl
.\.venv\Scripts\python.exe -m canbus.cli --input data/sample/mixed_10s.jsonl --output data/can/mixed_10s.canlog
.\decoder\bin\q50-can-decoder.exe --input data/can/mixed_10s.canlog --output data/decoded/mixed_10s.jsonl
.\.venv\Scripts\python.exe tools/verify_roundtrip.py data/sample/mixed_10s.jsonl data/decoded/mixed_10s.jsonl

# All 20 tests (8 Phase 1 + 12 Phase 2).
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

If `g++` is not installed, open **MSYS2 UCRT64** and run:

```bash
pacman -S --needed mingw-w64-ucrt-x86_64-gcc
```

If you cannot run `python` to create `.venv`, use `py -m venv .venv`.

## Inspect the encoded data

```powershell
Get-Content data/can/mixed_10s.canlog -TotalCount 4
Get-Content data/decoded/mixed_10s.jsonl -TotalCount 2
```

Expected: **100 telemetry records -> 200 synthetic frames -> 100 decoded records.**
The verification tool prints `PASS` if every reconstructed record matches.

## Files to understand

- [`simulator/model.py`](simulator/model.py): deterministic synthetic physics (Phase 1).
- [`canbus/codec.py`](canbus/codec.py): fields -> scaled integers -> bytes (Phase 2).
- [`canbus/cli.py`](canbus/cli.py): convert input JSONL -> `.canlog` (Phase 2).
- [`decoder/src/main.cpp`](decoder/src/main.cpp): bytes -> C++ decoded records (Phase 2).
- [`schemas/synthetic-can-protocol.md`](schemas/synthetic-can-protocol.md): byte-level protocol specification.
- [`tests/test_canbus.py`](tests/test_canbus.py): unit and Python/C++ integration tests.
- [`docs/phase2.md`](docs/phase2.md): background, setup, acceptance criteria and debugging.

## Roadmap

1. **Complete:** Phase 1 — simulated telemetry and data schema.
2. **Complete in source:** Phase 2 — synthetic CAN encoding + C++ decoding.
3. **Next:** Phase 3 — FastAPI backend, real-time streaming, PostgreSQL.
4. **Afterward:** Phase 4 — React dashboard, diagnostics and replay.
5. **Optional extensions:** physical CAN bench test (not car CAN), validated Q50
   telemetry recordings, 3D digital twin and performance reporting.

No live vehicle integration, proprietary Nissan CAN decoding or real ECU fault
diagnosis is claimed by this version.
