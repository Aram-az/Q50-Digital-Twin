"""Standard-library unit tests: run with python -m unittest discover -s tests -v."""
import csv
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from simulator.cli import main
from simulator.model import generate_samples, throttle_for_scenario

BASE = dict(scenario="mixed", duration_s=2.0, hz=10, seed=42,
            start_time_utc="2026-01-01T00:00:00Z", session_id="test-session")


class SimulatorTests(unittest.TestCase):
    def test_count_and_timestamp_spacing(self):
        samples = list(generate_samples(**BASE))
        self.assertEqual(len(samples), 20)
        self.assertEqual(samples[0].elapsed_s, 0.0)
        self.assertEqual(samples[-1].elapsed_s, 1.9)
        self.assertEqual(samples[1].timestamp_utc, "2026-01-01T00:00:00.100Z")

    def test_repeatable_output(self):
        self.assertEqual(list(generate_samples(**BASE)), list(generate_samples(**BASE)))

    def test_value_ranges_and_provenance(self):
        for sample in generate_samples(**BASE):
            self.assertTrue(650 <= sample.engine_rpm <= 6500)
            self.assertTrue(0 <= sample.vehicle_speed_kph <= 125)
            self.assertTrue(0 <= sample.throttle_pct <= 100)
            self.assertEqual(sample.source, "simulation")
            self.assertEqual(sample.quality, "valid")

    def test_idle_never_moves(self):
        for sample in generate_samples(**{**BASE, "scenario": "idle"}):
            self.assertEqual(sample.vehicle_speed_kph, 0)

    def test_invalid_settings_rejected(self):
        for changes in ({"hz": 0}, {"duration_s": -2}, {"scenario": "unknown"},
                        {"duration_s": 0.15, "hz": 10},
                        {"start_time_utc": "2026-01-01T00:00:00"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                list(generate_samples(**{**BASE, **changes}))

    def test_mixed_scenario_switches(self):
        self.assertEqual(throttle_for_scenario("mixed", 2), 2.0)
        self.assertEqual(throttle_for_scenario("mixed", 7), 55.0)
        self.assertEqual(throttle_for_scenario("mixed", 20), 18.0)
        self.assertEqual(throttle_for_scenario("mixed", 35), 4.0)

    def test_jsonl_file(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / "sample.jsonl"
            self.assertEqual(main(["--duration", "1", "--output", str(output)]), 0)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 10)
            self.assertEqual(rows[0]["schema_version"], "1.0")

    def test_csv_file(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / "sample.csv"
            self.assertEqual(main(["--duration", "1", "--format", "csv", "--output", str(output)]), 0)
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 10)
            self.assertEqual(rows[0]["source"], "simulation")


if __name__ == "__main__":
    unittest.main()
