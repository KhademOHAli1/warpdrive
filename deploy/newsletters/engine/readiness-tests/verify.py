#!/usr/bin/env python3
"""Exercise readiness on the packed engine with a disposable database and a no-send relay."""

import argparse
from datetime import datetime
import json
from pathlib import Path
import socketserver
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from consent import Fixture, assert_equal, wait_until


class ProbeRelay(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        self.wfile.write(b"220 readiness.fixture ESMTP\r\n")
        for line in self.rfile:
            command = line.decode("ascii").strip().split(" ", 1)[0]
            self.server.commands.append(command)
            if command == "EHLO":
                self.wfile.write(b"250-readiness.fixture\r\n250 AUTH PLAIN\r\n")
            elif command == "AUTH":
                self.wfile.write(b"235 fixture credentials accepted\r\n")
            elif command in {"HELO", "NOOP", "QUIT"}:
                self.wfile.write(b"250 fixture ready\r\n")
            else:
                self.wfile.write(b"550 message transactions forbidden in this fixture\r\n")
                return


class FixtureRelay(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), ProbeRelay)
        self.commands = []


def api(fixture, path):
    status, raw = fixture.request(path, fixture.auth)
    assert_equal(status, 200, f"GET {path}")
    return json.loads(raw)["data"]


def restart(fixture):
    fixture.serve.terminate()
    fixture.serve.wait(timeout=5)
    fixture.serve = subprocess.Popen(
        [str(fixture.engine), "--config", ""], cwd=fixture.root, env=fixture.env,
        stdout=fixture.log, stderr=subprocess.STDOUT,
    )
    wait_until(fixture.healthy, "active engine health")


def prove_rates(fixture):
    fixture.sql("""
        INSERT INTO campaigns(id, uuid, name, subject, from_email, body, status, messenger)
        VALUES (799, gen_random_uuid(), 'Synthetic rates', 'Synthetic rates', 'sender@example.test',
                'Synthetic', 'finished', 'email');
        INSERT INTO warpdrive_delivery_runs(campaign_id) VALUES (799);
        INSERT INTO warpdrive_delivery_recipients(campaign_id, state, smtp_accepted_at)
        VALUES (799, 'accepted', NOW()), (799, 'accepted', NOW()-INTERVAL '3 minutes'),
               (799, 'accepted', NOW()-INTERVAL '20 minutes'), (799, 'accepted', NULL);
    """)
    rates = api(fixture, "/api/warpdrive-delivery/799")["rates"]
    assert_equal(len(rates), 15, "rate window")
    minutes = [datetime.fromisoformat(bucket["minute"]) for bucket in rates]
    assert_equal((minutes[-1] - minutes[0]).total_seconds(), 14 * 60, "contiguous UTC minute buckets")
    assert_equal(sum(bucket["accepted"] for bucket in rates), 2, "only recent proven SMTP acceptances")
    observed = [minute for minute, bucket in zip(minutes, rates) if bucket["accepted"] == 1]
    assert_equal(len(observed), 2, "two accepted minutes")
    assert_equal((observed[1] - observed[0]).total_seconds(), 3 * 60, "separate accepted minutes")


def fixture_sql(port, uploads):
    relay = json.dumps([{
        "name": "fixture", "enabled": True, "host": "127.0.0.1", "port": port,
        "auth_protocol": "plain", "username": "fixture", "password": "synthetic-fixture",
        "tls_type": "none", "max_conns": 1,
        "wait_timeout": "1s", "idle_timeout": "2s",
    }])
    return f"""
        UPDATE settings SET value='false'::jsonb WHERE key='app.check_updates';
        UPDATE settings SET value='{relay}'::jsonb WHERE key='smtp';
        UPDATE settings SET value='{json.dumps(str(uploads))}'::jsonb WHERE key='upload.filesystem.upload_path';
        UPDATE settings SET value='100'::jsonb WHERE key='app.concurrency';
        UPDATE settings SET value='1000'::jsonb WHERE key='app.message_rate';
        UPDATE settings SET value='10000'::jsonb WHERE key='app.batch_size';
    """


def prove(fixture, relay, uploads):
    path = "/api/warpdrive/readiness"
    status, _ = fixture.request(path)
    assert_equal(status, 403, "anonymous readiness")
    passive = api(fixture, path)
    assert_equal(passive["ready"], False, "passive is not ready for delivery")
    assert_equal(passive["database"], {"status": "ready"}, "engine schema")
    assert_equal(passive["scheduler"], {"status": "passive", "lastScanAt": None}, "passive scheduler")
    assert_equal(passive["relay"]["status"], "ready", "relay greeting, negotiation and NOOP")
    assert_equal(passive["media"]["status"], "ready", "filesystem read/write")
    assert_equal(list(uploads.iterdir()), [], "probe object removed")
    assert_equal(passive["feedback"], {"status": "disabled", "lastEventAt": None}, "optional feedback")
    assert_equal(passive["limits"], {
        "workers": 8, "perWorkerMessagesPerSecond": 5, "messagesPerSecond": 40,
        "batchSize": 200, "queueCapacity": 16, "clamped": True,
    }, "effective budget")
    assert_equal(fixture.sql("SELECT value FROM settings WHERE key='app.concurrency'"), "100", "stored setting unchanged")
    assert_equal(api(fixture, "/api/warpdrive-capabilities")["readiness"], 1, "readiness capability")
    prove_rates(fixture)

    restart(fixture)
    wait_until(lambda: api(fixture, path)["ready"], "real scheduler heartbeat", seconds=12)
    active = api(fixture, path)
    assert_equal(active["scheduler"]["status"], "ready", "active scheduler")
    assert active["scheduler"]["lastScanAt"]
    assert {"EHLO", "AUTH", "NOOP"}.issubset(relay.commands)
    assert not {"MAIL", "RCPT", "DATA"}.intersection(relay.commands), "readiness initiated a mail transaction"

    fixture.sql("DROP INDEX warpdrive_delivery_smtp_recent")
    assert_equal(api(fixture, path)["database"]["status"], "migration_required", "schema health loss")
    assert_equal(api(fixture, path)["ready"], False, "schema health gate")
    fixture.sql("""
        CREATE INDEX warpdrive_delivery_smtp_recent ON warpdrive_delivery_recipients(campaign_id, smtp_accepted_at)
        WHERE smtp_accepted_at IS NOT NULL;
        UPDATE settings SET value=jsonb_set(value, '{0,port}', '1') WHERE key='smtp';
    """)
    restart(fixture)
    assert_equal(api(fixture, path)["relay"]["status"], "unavailable", "relay outage")
    assert_equal(api(fixture, path)["ready"], False, "relay outage gate")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    args = parser.parse_args()
    with FixtureRelay() as relay, tempfile.TemporaryDirectory(prefix="lm-readiness-", dir="/tmp") as folder:
        worker = threading.Thread(target=relay.serve_forever, daemon=True)
        worker.start()
        uploads = Path(folder) / "uploads"
        uploads.mkdir()
        fixture = Fixture(Path(folder), args.engine.resolve(strict=True), args.pg_bin.resolve(strict=True))
        fixture.env["LISTMONK_db__max_open"] = "20"
        try:
            fixture.start(fixture_sql(relay.server_address[1], uploads))
            prove(fixture, relay, uploads)
        finally:
            fixture.stop()
            relay.shutdown()
            worker.join(timeout=3)
    print("Readiness, schema/relay failure gates, no-send SMTP probe, rate buckets and effective limits passed.")


if __name__ == "__main__":
    main()
