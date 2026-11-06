"""Phase 2 encoder tests plus optional full Python -> C++ round-trip tests.

Compile the C++ decoder before running this suite to enable integration tests.
"""
from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

from canbus.cli import convert
from canbus.codec import FRAME_MOTION, FRAME_THERMAL, encode_sample
from simulator.model import TelemetrySample, generate_samples

ROOT = Path(__file__).resolve().parents[1]
DECODER = ROOT / "decoder" / "bin" / "q50-can-decoder.exe"
BASE = dict(scenario="mixed", duration_s=2.0, hz=10, seed=42,
            start_time_utc="2026-01-01T00:00:00Z", session_id="test-session")


class EncoderTests(unittest.TestCase):
    def test_known_bytes_and_little_endian(self):
        sample = replace(next(generate_samples(**BASE)),
                         vehicle_speed_kph=82.34, engine_rpm=3250.1,
                         throttle_pct=21.5, coolant_temp_c=92.45,
                         intake_temp_c=-5.25)
        motion, thermal = encode_sample(sample, 42)
        self.assertEqual(motion.can_id, FRAME_MOTION)
        self.assertEqual(thermal.can_id, FRAME_THERMAL)
        self.assertEqual(motion.data, bytes.fromhex("2A20F57ED7002A00"))
        self.assertEqual(thermal.data, bytes.fromhex("1D24F3FD01002A00"))
        self.assertEqual(len(motion.data), 8)
        self.assertEqual(len(thermal.data), 8)

    def test_sequence_counter_is_encoded(self):
        sample = next(generate_samples(**BASE))
        a, b = encode_sample(sample, 65535)
        self.assertEqual(struct.unpack_from("<H", a.data, 6)[0], 65535)
        self.assertEqual(struct.unpack_from("<H", b.data, 6)[0], 65535)

    def test_reject_out_of_range_or_wrong_source(self):
        sample = next(generate_samples(**BASE))
        invalid = [
            replace(sample, throttle_pct=150),
            replace(sample, coolant_temp_c=-100),
            replace(sample, engine_rpm=float("nan")),
            replace(sample, source="live"),
            replace(sample, session_id="not safe|session"),
        ]
        for item in invalid:
            with self.subTest(item=item), self.assertRaises(ValueError):
                encode_sample(item, 0)
        with self.assertRaises(ValueError):
            encode_sample(sample, 65536)

    def test_encoding_produces_twice_as_many_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.jsonl"
            output_path = Path(directory) / "out.canlog"
            samples = list(generate_samples(**BASE))
            input_path.write_text("".join(json.dumps(s.to_dict()) + "\n" for s in samples), encoding="utf-8")
            self.assertEqual(convert(input_path, output_path), len(samples))
            lines = output_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 2 * len(samples))
            self.assertEqual(lines[0].split("|")[4], "0x500")
            self.assertEqual(lines[1].split("|")[4], "0x501")

    def test_bad_input_does_not_replace_existing_log(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "input.jsonl"
            output_path = Path(directory) / "out.canlog"
            input_path.write_text('{"bad":true}\n', encoding="utf-8")
            output_path.write_text("previous working data\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                convert(input_path, output_path)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "previous working data\n")


@unittest.skipUnless(DECODER.is_file(), "compile C++ decoder first to enable integration tests")
class CppIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.input = self.root / "input.canlog"
        self.output = self.root / "output.jsonl"

    def run_decoder(self, lines: list[str]):
        self.input.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return subprocess.run(
            [str(DECODER), "--input", str(self.input), "--output", str(self.output)],
            capture_output=True, text=True, check=False,
        )

    def test_exact_roundtrip_all_phase1_fields(self):
        samples = list(generate_samples(**BASE))
        lines = [line for sequence, sample in enumerate(samples)
                 for frame in encode_sample(sample, sequence)
                 for line in [frame.to_log_line()]]
        result = self.run_decoder(lines)
        self.assertEqual(result.returncode, 0, result.stderr)
        decoded = [json.loads(line) for line in self.output.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(decoded, [sample.to_dict() for sample in samples])

    def test_counter_wraparound(self):
        samples = list(generate_samples(**{**BASE, "duration_s": 0.3}))
        lines = [frame.to_log_line() for idx, sample in enumerate(samples)
                 for frame in encode_sample(sample, (65535 + idx) % 65536)]
        result = self.run_decoder(lines)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.output.read_text(encoding="utf-8").splitlines()), 3)

    def test_pair_can_arrive_in_either_order(self):
        sample = next(generate_samples(**BASE))
        frames = encode_sample(sample, 17)
        result = self.run_decoder([frames[1].to_log_line(), frames[0].to_log_line()])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.output.read_text(encoding="utf-8"))["engine_rpm"], sample.engine_rpm)

    def test_incomplete_pair_is_rejected(self):
        sample = next(generate_samples(**BASE))
        line = encode_sample(sample, 0)[0].to_log_line()
        result = self.run_decoder([line])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("incomplete", result.stderr)

    def test_bad_hex_and_wrong_identifier_rejected(self):
        sample = next(generate_samples(**BASE))
        good = [f.to_log_line() for f in encode_sample(sample, 0)]
        for modified in [good[0].replace("0x500", "0x222"), good[0][:-1] + "Z"]:
            with self.subTest(modified=modified):
                result = self.run_decoder([modified, good[1]])
                self.assertNotEqual(result.returncode, 0)

    def test_sequence_mismatch_duplicate_and_gap_rejected(self):
        samples = list(generate_samples(**{**BASE, "duration_s": 0.3}))
        zero = [f.to_log_line() for f in encode_sample(samples[0], 0)]
        one = [f.to_log_line() for f in encode_sample(samples[1], 1)]
        two_gap = [f.to_log_line() for f in encode_sample(samples[2], 3)]
        cases = [
            [zero[0], one[1]],       # different counter and metadata
            [zero[0], zero[0]],      # same ID twice
            zero + two_gap,         # missing logical sample sequence
        ]
        for lines in cases:
            with self.subTest(lines=lines):
                result = self.run_decoder(lines)
                self.assertNotEqual(result.returncode, 0)

    def test_incompatible_protocol_version_rejected(self):
        sample = next(generate_samples(**BASE))
        motion, thermal = encode_sample(sample, 0)
        data = bytearray(thermal.data)
        data[4] = 2
        bad_line = replace(thermal, data=bytes(data)).to_log_line()
        result = self.run_decoder([motion.to_log_line(), bad_line])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("protocol version", result.stderr)


if __name__ == "__main__":
    unittest.main()
