# Synthetic CAN protocol v1 — controlled simulation ONLY

**This is not the Nissan/Infiniti CAN database or an OBD-II request/response mapping.**
The IDs `0x500` and `0x501` are invented identifiers for a virtual network.
Never replay these frames onto a real vehicle CAN bus.

Each Phase 1 telemetry sample is quantized into **two classic eight-byte CAN data payloads**.
The CAN ID, DLC and payload are the frame-level concepts; our `.canlog` adds
human-readable timestamp, elapsed time, session and source information *outside* the CAN frame.

## Message A: synthetic motion (`0x500`)

| Bytes | Field | Type | Physical scale |
|---|---|---|---|
| 0–1 | vehicle speed | uint16 LE | raw / 100 = km/h |
| 2–3 | engine RPM | uint16 LE | raw / 10 = rpm |
| 4–5 | throttle | uint16 LE | raw / 10 = percent |
| 6–7 | sequence | uint16 LE | count, wraps after 65535 |

## Message B: synthetic thermal (`0x501`)

| Bytes | Field | Type | Physical scale |
|---|---|---|---|
| 0–1 | coolant temperature | int16 LE | raw / 100 = degrees Celsius |
| 2–3 | intake temperature | int16 LE | raw / 100 = degrees Celsius |
| 4 | protocol version | uint8 | exactly 1 |
| 5 | reserved | uint8 | exactly 0 |
| 6–7 | sequence | uint16 LE | must equal motion frame sequence |

### Example golden vector

For speed `82.34`, RPM `3250.1`, throttle `21.5`, coolant `92.45`, intake
`-5.25`, and sequence `42`, the frames are:

```text
0x500  2A20F57ED7002A00
0x501  1D24F3FD01002A00
```

Example: speed 82.34 km/h -> 8234 hundredths -> hex `0x202A` -> little-endian bytes `2A20`.
Negative temperatures are represented with two's-complement signed integers.

## Text log envelope

Each `.canlog` line is:

```text
timestamp_utc|elapsed_s|session_id|source|can_id|data_hex
2026-01-01T00:00:00.000Z|0.000|demo-session-001|simulation|0x500|0000651E14000000
2026-01-01T00:00:00.000Z|0.000|demo-session-001|simulation|0x501|99213F0B01000000
```

The six pipe-separated columns are **not themselves a CAN wire format**. On a
real CAN bus, only the arbitration identifier, DLC and payload travel inside
the CAN frame; timestamp and session metadata come from logging software.

## Decoder rules

- Exactly two consecutive frames per sample, one `0x500` and one `0x501`, either order.
- Both have identical timestamp, session, elapsed time and source.
- Both share the same 16-bit sequence; successive samples increment modulo 65536.
- Unknown IDs, invalid hex, bad lengths, missing or duplicate frames and unsupported versions are errors.
- Decoded values must satisfy declared telemetry ranges.
- The C++ program writes the original Phase 1 JSONL record layout after successful validation.

**Boundary:** This does not implement standardized OBD-II PIDs or reverse-engineer a proprietary CAN network. Those require separate protocols, verification and safety assessment.
