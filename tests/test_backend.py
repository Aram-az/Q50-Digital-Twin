"""Phase 3 integration tests. Uses a real temporary SQLite database, not mocks.

The production SQLAlchemy models are identical for PostgreSQL, but this suite
only asserts SQLite behavior. Validate PostgreSQL manually via Docker Compose.
"""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import quote

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.schemas import SampleIn
from backend.tools.publish import load_samples
from simulator.model import generate_samples


class BackendIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        database = Path(self.tmp.name) / "integration.db"
        url = "sqlite+pysqlite:///" + database.as_posix()
        self.client_context = TestClient(create_app(database_url=url))
        self.client = self.client_context.__enter__()
        self.addCleanup(lambda: self.client_context.__exit__(None, None, None))
        self.root = "/api/v1/sessions"
        self.samples = [s.to_dict() for s in generate_samples(
            scenario="mixed", duration_s=0.5, hz=10, seed=42,
            start_time_utc="2026-01-01T00:00:00Z", session_id="backend-test")]

    def create_session(self, session_id="backend-test"):
        result = self.client.post(self.root, json={
            "session_id": session_id, "label": "Test driving session", "source": "simulation"
        })
        self.assertEqual(result.status_code, 201, result.text)
        return result

    def ingest(self, records=None):
        return self.client.post(f"{self.root}/backend-test/samples",
                                json={"samples": records if records is not None else self.samples})

    def test_health_connects_to_database(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["database"], "connected")

    def test_session_creation_and_list(self):
        resp = self.create_session()
        self.assertEqual(resp.json()["sample_count"], 0)
        listed = self.client.get(self.root).json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["session_id"], "backend-test")
        self.assertEqual(self.client.get(self.root + "/backend-test").status_code, 200)

    def test_duplicate_session_rejected(self):
        self.create_session()
        dup = self.client.post(self.root, json={"session_id": "backend-test", "label": "Duplicate"})
        self.assertEqual(dup.status_code, 409)

    def test_ingestion_query_pagination_and_stats(self):
        self.create_session()
        response = self.ingest()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["inserted"], 5)
        self.assertEqual(self.client.get(self.root + "/backend-test").json()["sample_count"], 5)
        page = self.client.get(self.root + "/backend-test/samples?limit=2&offset=1")
        self.assertEqual(page.status_code, 200)
        self.assertEqual(len(page.json()), 2)
        self.assertEqual(page.json()[0]["elapsed_s"], 0.1)
        self.assertIn("id", page.json()[0])
        stats = self.client.get(self.root + "/backend-test/stats").json()
        self.assertEqual(stats["count"], 5)
        self.assertEqual(stats["first_elapsed_s"], 0.0)
        self.assertEqual(stats["last_elapsed_s"], 0.4)
        self.assertEqual(stats["max_engine_rpm"], max(x["engine_rpm"] for x in self.samples))

    def test_invalid_value_rejected_without_writes(self):
        self.create_session()
        bad = [dict(self.samples[0], coolant_temp_c=500)]
        response = self.ingest(bad)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get(self.root + "/backend-test/stats").json()["count"], 0)

    def test_mixed_session_ids_and_non_increasing_times_rejected_atomically(self):
        self.create_session()
        bad = [self.samples[0], {**self.samples[1], "session_id": "different"}]
        self.assertEqual(self.ingest(bad).status_code, 422)
        bad = [self.samples[1], self.samples[0]]
        self.assertEqual(self.ingest(bad).status_code, 422)
        self.assertEqual(self.client.get(self.root + "/backend-test/stats").json()["count"], 0)

    def test_duplicate_elapsed_rejected_without_partial_insert(self):
        self.create_session()
        self.assertEqual(self.ingest(self.samples[:2]).status_code, 201)
        # This batch starts with a previously inserted elapsed time.
        self.assertEqual(self.ingest(self.samples[1:4]).status_code, 409)
        self.assertEqual(self.client.get(self.root + "/backend-test/stats").json()["count"], 2)

    def test_missing_session_and_unsupported_source(self):
        self.assertEqual(self.ingest().status_code, 404)
        self.assertEqual(self.client.get(self.root + "/missing/samples").status_code, 404)
        resp = self.client.post(self.root, json={"session_id": "live", "label": "Not allowed", "source": "live"})
        self.assertEqual(resp.status_code, 422)

    def test_reject_unknown_fields_and_invalid_time(self):
        self.create_session()
        self.assertEqual(self.ingest([{**self.samples[0], "hidden": "oops"}]).status_code, 422)
        self.assertEqual(self.ingest([{**self.samples[0], "timestamp_utc": "yesterday"}]).status_code, 422)

    def test_websocket_emits_only_committed_samples(self):
        self.create_session()
        with self.client.websocket_connect("/ws/telemetry/backend-test") as ws:
            self.assertEqual(ws.receive_json()["type"], "connected")
            response = self.ingest(self.samples[:1])
            self.assertEqual(response.status_code, 201)
            event = ws.receive_json()
            self.assertEqual(event["type"], "telemetry")
            self.assertEqual(event["sample"]["elapsed_s"], 0.0)
            # Batch produces one bounded batch event.
            response = self.ingest(self.samples[1:])
            self.assertEqual(response.status_code, 201)
            event = ws.receive_json()
            self.assertEqual(event["type"], "telemetry_batch")
            self.assertEqual(len(event["samples"]), 4)

    def test_publisher_loads_existing_phase2_data(self):
        file = Path(self.tmp.name) / "samples.jsonl"
        file.write_text("\n".join(json.dumps(s) for s in self.samples), encoding="utf-8")
        loaded = load_samples(file, "renamed-sample")
        self.assertEqual(len(loaded), len(self.samples))
        self.assertTrue(all(s["session_id"] == "renamed-sample" for s in loaded))


if __name__ == "__main__":
    unittest.main()
