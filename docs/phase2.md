# Phase 2 - Synthetic CAN + C++ decoder

## Objective
Turn the Phase 1 JSONL telemetry stream into simulated CAN data payloads,
then decode those payloads in independent C++17 code and reconstruct the original
records exactly.

## Design

```text
Phase 1 Python simulator
          |
          v
JSONL telemetry record (1.0)
          |
          v
Python canbus.codec encoder
          |
          v
Two 8-byte synthetic CAN frames per record (0x500 and 0x501)
          |
          v
Plain-text .canlog recording, with metadata outside CAN payload
          |
          v
C++17 decoder: validate pair, interpret bytes, recover units
          |
          v
Decoded JSONL, compatible with Phase 1 schema
```

## Safety / realism
These frames are invented to teach transport, packing and decoding. They are
not Infiniti IDs and must never be transmitted to an actual vehicle bus.
The project does not read or transmit real CAN at this stage.

## Quick start, Windows PowerShell
From repository root, with `.venv` set up:

```powershell
# Only if MSYS2 UCRT64 g++ isn't on PATH yet (assumes default MSYS2 installation).
$env:Path = "C:\msys64\ucrt64\bin;$env:Path"
g++ --version
New-Item -ItemType Directory -Force decoder\bin | Out-Null
g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic decoder/src/main.cpp -o decoder/bin/q50-can-decoder.exe

.\.venv\Scripts\python.exe -m simulator.cli --scenario mixed --duration 10 --hz 10 --seed 42 --output data/sample/mixed_10s.jsonl
.\.venv\Scripts\python.exe -m canbus.cli --input data/sample/mixed_10s.jsonl --output data/can/mixed_10s.canlog
.\decoder\bin\q50-can-decoder.exe --input data/can/mixed_10s.canlog --output data/decoded/mixed_10s.jsonl
.\.venv\Scripts\python.exe tools/verify_roundtrip.py data/sample/mixed_10s.jsonl data/decoded/mixed_10s.jsonl
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Expect 100 samples -> 200 synthetic CAN frames -> 100 reconstructed samples.
The verifier should print `PASS: all 100 telemetry samples matched exactly`.
The full test suite contains 20 tests (8 existing + 12 added) with no skipped
integration tests once the C++ decoder is compiled. A failing test is not a
success; review error output before moving on.

## Core concepts
- **CAN frame vs. record:** A frame's data payload is just 8 raw bytes here.
  Timestamp and session are added by our log file, not carried inside CAN.
- **Little-endian:** least significant byte stored first. Two bytes `2A 20`
  form the integer `0x202A` (8234).
- **Quantization:** float value -> scaled integer for transport, scaled back
  after decoding. Precision set to 0.01 for speed/temperatures and 0.1 for RPM/throttle.
- **Signed integers:** two's-complement allows negative Celsius temperatures.
- **Sequence counter:** detects missing or duplicate logical samples; wraps
  from 65535 back to 0.
- **Contract testing:** Python and C++ independently agree on wire format.
- **Fail closed:** corrupted data produces a decoder error instead of quietly
  displaying misleading measurements.

## Definition of done
- Encoder produces two frames per valid synthetic sample.
- C++17 decoder compiles cleanly on Windows UCRT64.
- Decoder reconstructs JSONL records equal to the Python input.
- Invalid/incomplete frame pairs are rejected.
- All automated unit + integration tests pass.
- Code and docs are committed to GitHub.

## Next major implementation
Phase 3: FastAPI ingestion, asynchronous WebSocket streaming and data storage.
