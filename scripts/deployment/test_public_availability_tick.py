"""Exercise one observer-host tick with the actual state and delivery APIs."""

from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from check_public_availability import read_observer, record_observation
from deliver_public_availability import _delivery_lock
from public_availability_tick import _exit_status, main, tick


HOST = "app.example.test"
TOKEN = "fixture-alert-bearer-1234567890"


class PublicAvailabilityTickTests(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.state = directory / "state"
        self.state.mkdir(mode=0o700)
        self.config = directory / "alert.json"
        self.config.write_text(json.dumps({"url": "https://alerts.example.test/events", "token": TOKEN}))
        self.config.chmod(0o600)
        self.now = datetime.now(UTC)

    def seed(self, states, *, offset=10, threshold=1):
        for index, state in enumerate(states):
            timestamp = self.now - timedelta(seconds=offset - index)
            record_observation(self.state, HOST, {"state": state, "observedAt": timestamp.isoformat()},
                               threshold=threshold, now=timestamp)
        return read_observer(self.state, HOST)["pending"]

    def run_tick(self, transport, *, threshold=1):
        return tick(self.state, HOST, self.config, threshold=threshold, curl="/owned/curl", run=transport)

    def test_healthy_sample_has_no_delivery_and_only_public_credential_free_probe(self):
        calls = []

        def transport(command, **options):
            calls.append(command)
            self.assertEqual(command[-1], f"https://{HOST}/api/health")
            self.assertIn("GET", command)
            self.assertNotIn("input", options)
            self.assertNotIn(TOKEN, repr((command, options)))
            self.assertEqual(options["timeout"], 8)
            return subprocess.CompletedProcess(command, 0, b'{"ok":true}\n200')

        result = self.run_tick(transport)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result, {"schemaVersion": 1, "kind": "warpdrive-public-availability-tick",
                                  "sample": "healthy", "record": "recorded", "delivery": "empty", "observerStale": False})
        self.assertEqual(_exit_status(result), 0)

    def test_observed_target_failure_can_deliver_a_new_event(self):
        bodies = []

        def transport(command, **options):
            if "GET" in command:
                return subprocess.CompletedProcess(command, 0, b"private-upstream-diagnostic\n503")
            payload = options["input"]
            self.assertNotIn(TOKEN, repr(command))
            self.assertNotIn(b"private-upstream-diagnostic", payload)
            bodies.append(payload)
            event = read_observer(self.state, HOST)["pending"][0]
            return self.accept(command, event)

        result = self.run_tick(transport)
        self.assertEqual((result["sample"], result["delivery"], _exit_status(result)), ("failed", "accepted", 1))
        self.assertEqual(len(bodies), 1)
        self.assertEqual(read_observer(self.state, HOST)["pending"], [])

    def test_next_tick_retries_exact_oldest_after_transport_failure(self):
        oldest, recovered = self.seed(("failed", "healthy"))
        calls = []

        def transport(command, **options):
            if "GET" in command:
                return subprocess.CompletedProcess(command, 0, b'{"ok":true}\n200')
            calls.append(options["input"])
            self.assertNotIn(TOKEN, repr(command))
            self.assertEqual(options["timeout"], 8)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(command, options["timeout"])
            return self.accept(command, oldest)

        result = self.run_tick(transport)
        self.assertEqual((result["delivery"], _exit_status(result)), ("held", 1))
        self.assertEqual(read_observer(self.state, HOST)["pending"], [oldest, recovered])
        # The stored timestamp has millisecond resolution. Give the next sample
        # an explicitly later timestamp through the same observer callable.
        from check_public_availability import check

        def later(*args, **kwargs):
            return {**check(*args, **kwargs), "observedAt": (datetime.now(UTC) + timedelta(seconds=1)).isoformat()}

        with patch("public_availability_tick.check", side_effect=later):
            result = self.run_tick(transport)
        self.assertEqual((result["delivery"], _exit_status(result)), ("accepted", 0))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(read_observer(self.state, HOST)["pending"], [recovered])

    def test_stale_record_hold_still_delivers_oldest_and_stays_unknown(self):
        oldest, = self.seed(("failed",), offset=300)

        def transport(command, **options):
            if "GET" in command:
                return subprocess.CompletedProcess(command, 0, b"rate limited\n429")
            return self.accept(command, oldest)

        result = self.run_tick(transport, threshold=2)
        self.assertEqual((result["sample"], result["record"], result["delivery"], result["observerStale"]),
                         ("unknown", "held", "accepted", True))
        self.assertEqual(_exit_status(result), 2)
        self.assertEqual(read_observer(self.state, HOST)["pending"], [])

    def test_busy_delivery_does_not_stop_recording_or_output_private_errors(self):
        def transport(command, **options):
            self.assertIn("GET", command)
            return subprocess.CompletedProcess(command, 0, b'{"ok":true}\n200')

        with _delivery_lock(self.state):
            result = self.run_tick(transport)
        self.assertEqual((result["sample"], result["record"], result["delivery"], result["observerStale"]),
                         ("healthy", "recorded", "held", None))

        output = io.StringIO()
        with patch("public_availability_tick.check", side_effect=OSError(TOKEN)), redirect_stdout(output):
            status = main([HOST, "--state-dir", str(self.state), "--config", str(self.config), "--failure-threshold", "1"])
        self.assertEqual(status, 2)
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["record"], "held")

    @staticmethod
    def accept(command, event):
        return subprocess.CompletedProcess(command, 0,
            json.dumps({"accepted": True, "eventId": event["id"]}).encode() + b"\n202")


if __name__ == "__main__":
    unittest.main()
