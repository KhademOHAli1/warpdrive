#!/usr/bin/env python3
"""Exercise the durable scheduler with disposable PostgreSQL and a scripted loopback relay."""

import argparse
from collections import defaultdict, deque
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from consent import Fixture, assert_equal, wait_until


class Relay(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), SMTP)
        self.received = defaultdict(list)
        self.plans = defaultdict(deque)
        self.lock = threading.Lock()
        self.resume = threading.Event()

    def plan(self, recipient, *responses):
        with self.lock:
            self.plans[recipient].extend(responses)

    def captures(self, recipient):
        with self.lock:
            return list(self.received[recipient])

    def data(self, recipient, content):
        message = BytesParser(policy=policy.default).parsebytes(content)
        with self.lock:
            self.received[recipient].append(str(message["Message-ID"]))
            choices = self.plans[recipient]
            return choices.popleft() if choices else "accept"


class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(12)
        self.wfile.write(b"220 fixture.local ESMTP\r\n")
        recipient = ""
        try:
            for line in self.rfile:
                command = line.decode("ascii", errors="strict").strip()
                if command.upper().startswith(("EHLO ", "HELO ", "MAIL FROM:")):
                    self.wfile.write(b"250 fixture.local\r\n")
                elif command.upper().startswith("RCPT TO:"):
                    recipient = command.split(":", 1)[1].strip("<>")
                    if not recipient.endswith("@example.test"):
                        self.wfile.write(b"550 fixture accepts synthetic recipients only\r\n")
                        return
                    self.wfile.write(b"250 OK\r\n")
                elif command == "DATA":
                    self.wfile.write(b"354 End data with a dot\r\n")
                    content = bytearray()
                    for body_line in self.rfile:
                        if body_line == b".\r\n":
                            break
                        content.extend(body_line)
                    else:
                        return
                    action = self.server.data(recipient, bytes(content))
                    if action == "drop":
                        return
                    if action == "hold" and not self.server.resume.wait(10):
                        return
                    response = b"451 Try again later\r\n" if action == "retry" else b"250 Queued\r\n"
                    self.wfile.write(response)
                elif command == "QUIT":
                    self.wfile.write(b"221 Goodbye\r\n")
                    return
                else:
                    self.wfile.write(b"250 OK\r\n")
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return


class EngineFixture(Fixture):
    def launch(self):
        self.serve = subprocess.Popen(
            [str(self.engine), "--config", ""], cwd=self.root, env=self.env,
            stdout=self.log, stderr=subprocess.STDOUT,
        )
        wait_until(self.healthy, "scheduler health")

    def stop_engine(self, kill=False):
        if self.serve is not None and self.serve.poll() is None:
            if kill:
                self.serve.kill()
            else:
                self.serve.terminate()
            self.serve.wait(timeout=5)

    def api(self, path, method="GET", payload=None, expected=200):
        headers = {**self.auth, "Content-Type": "application/json"}
        body = None if payload is None else json.dumps(payload).encode()
        status, raw = self.request(path, headers, body, method)
        assert_equal(status, expected, f"{method} {path}: {raw[:250]}")
        return json.loads(raw).get("data")

    def campaign(self, name, recipients):
        list_id = int(self.sql(f"""
            INSERT INTO lists(uuid, name, type, optin)
            VALUES (gen_random_uuid(), '{name}', 'private', 'double') RETURNING id
        """))
        for recipient in recipients:
            self.sql(f"""
                WITH inserted AS (
                    INSERT INTO subscribers(uuid, email, name, status)
                    VALUES (gen_random_uuid(), '{recipient}', 'Synthetic', 'enabled') RETURNING id
                )
                INSERT INTO subscriber_lists(subscriber_id, list_id, status)
                SELECT id, {list_id}, 'confirmed' FROM inserted
            """)
        data = self.api("/api/campaigns", "POST", {
            "name": name, "subject": name, "type": "regular", "body": "<p>Synthetic</p>",
            "content_type": "html", "lists": [list_id],
        })
        return data["id"]

    def status(self, campaign_id):
        return self.api(f"/api/campaigns/{campaign_id}")

    def transition(self, campaign_id, status, expected=200):
        prior = self.status(campaign_id)
        self.api(f"/api/campaigns/{campaign_id}/status", "PUT", {
            "status": status, "expected_updated_at": prior["updated_at"],
        }, expected=expected)

    def deliveries(self, campaign_id):
        return self.api(f"/api/warpdrive-delivery/{campaign_id}")

    def wait_counts(self, campaign_id, counts):
        wait_until(lambda: self.deliveries(campaign_id)["counts"] == counts,
                   f"campaign {campaign_id} receipt counts {counts}", seconds=18)

    def finish(self, campaign_id, sent):
        wait_until(lambda: self.status(campaign_id)["status"] == "finished",
                   f"campaign {campaign_id} completion", seconds=18)
        assert_equal(self.status(campaign_id)["sent"], sent, "durable sent count")


def fixture_sql(port):
    relay = json.dumps([{
        "name": "synthetic", "enabled": True, "host": "127.0.0.1", "port": port,
        "auth_protocol": "none", "tls_type": "none", "max_conns": 1,
        "max_msg_retries": 8, "wait_timeout": "2s", "idle_timeout": "2s",
        "email_headers": [], "from_addresses": [],
    }])
    return f"""
        INSERT INTO campaigns(id, uuid, name, subject, from_email, body, status, messenger, sent, started_at)
        VALUES (999, gen_random_uuid(), 'Prior engine', 'Legacy', 'sender@example.test', 'Prior',
                'running', 'email', 1, NOW());
        UPDATE settings SET value='{relay}'::jsonb WHERE key='smtp';
        UPDATE settings SET value='false'::jsonb WHERE key='app.check_updates';
        UPDATE settings SET value='"Sender <sender@example.test>"'::jsonb WHERE key='app.from_email';
        UPDATE settings SET value='[]'::jsonb WHERE key='app.notify_emails';
        UPDATE settings SET value='1'::jsonb WHERE key='app.concurrency';
        UPDATE settings SET value='10'::jsonb WHERE key='app.batch_size';
    """


def prove_pause_resume(fixture, relay):
    relay.resume.clear()
    first = "pause-first@example.test"
    second = "pause-second@example.test"
    relay.plan(first, "hold")
    campaign = fixture.campaign("Pause and resume", [first, second])
    fixture.transition(campaign, "running")
    wait_until(lambda: relay.captures(first), "first paused-run SMTP transaction", seconds=18)
    fixture.transition(campaign, "paused")
    relay.resume.set()
    fixture.wait_counts(campaign, {"accepted": 1, "pending": 1})
    assert_equal(relay.captures(second), [], "pause prevents queued submission")
    fixture.transition(campaign, "running")
    fixture.finish(campaign, 2)
    assert_equal(len(relay.captures(first)), 1, "resume skips accepted receipt")
    assert_equal(len(relay.captures(second)), 1, "resume processes queued receipt")


def prove_lost_ack(fixture, relay):
    recipient = "lost-ack@example.test"
    relay.plan(recipient, "drop")
    campaign = fixture.campaign("Lost acknowledgement", [recipient])
    fixture.transition(campaign, "running")
    fixture.wait_counts(campaign, {"unknown": 1})
    assert_equal(fixture.status(campaign)["status"], "paused", "unknown delivery pauses campaign")
    review = fixture.deliveries(campaign)["review"]
    assert_equal(len(review), 1, "bounded receipt review")
    assert_equal(relay.captures(recipient), [review[0]["message_id"]], "one SMTP attempt and stable correlation")
    assert_equal(set(review[0]), {"id", "message_id", "attempts", "updated_at"}, "safe receipt shape")
    fixture.transition(campaign, "running", expected=409)
    payload = {"delivery_id": review[0]["id"], "outcome": "accepted"}
    fixture.api(f"/api/warpdrive-delivery/{campaign}/resolve", "POST", payload)
    fixture.api(f"/api/warpdrive-delivery/{campaign}/resolve", "POST", payload, expected=409)
    fixture.transition(campaign, "running")
    fixture.finish(campaign, 1)
    assert_equal(len(relay.captures(recipient)), 1, "review never resends an accepted message")


def prove_process_restart(fixture, relay):
    relay.resume.clear()
    first = "restart-uncertain@example.test"
    second = "restart-leased@example.test"
    relay.plan(first, "hold")
    campaign = fixture.campaign("Recover after SIGKILL", [first, second])
    fixture.transition(campaign, "running")
    wait_until(lambda: relay.captures(first), "SMTP DATA received before engine SIGKILL", seconds=18)
    fixture.wait_counts(campaign, {"submitting": 1, "leased": 1})
    fixture.stop_engine(kill=True)
    relay.resume.set()
    # Advance fixture time after stopping the old process, without shortening production leases.
    fixture.sql(f"""
        UPDATE warpdrive_delivery_recipients SET lease_until = NOW() - INTERVAL '1 second'
        WHERE campaign_id = {campaign} AND state IN ('submitting', 'leased')
    """)
    fixture.launch()
    fixture.wait_counts(campaign, {"unknown": 1, "pending": 1})
    review = fixture.deliveries(campaign)["review"][0]
    assert_equal(relay.captures(first), [review["message_id"]], "restart never resends an uncertain submission")
    assert_equal(relay.captures(second), [], "restart keeps work on hold pending reconciliation")
    fixture.api(f"/api/warpdrive-delivery/{campaign}/resolve", "POST", {
        "delivery_id": review["id"], "outcome": "accepted",
    })
    fixture.transition(campaign, "running")
    fixture.finish(campaign, 2)
    assert_equal(len(relay.captures(second)), 1, "expired pre-submit lease safely recovered")
    assert_equal(len(relay.captures(first)), 1, "recovery never sends first recipient twice")


def prove_definite_retry(fixture, relay):
    recipient = "retry@example.test"
    relay.plan(recipient, "retry", "accept")
    campaign = fixture.campaign("Definite transient rejection", [recipient])
    fixture.transition(campaign, "running")
    wait_until(lambda: len(relay.captures(recipient)) == 1, "relay returned 451", seconds=18)
    wait_until(lambda: fixture.sql(f"""
        SELECT state || ':' || attempts FROM warpdrive_delivery_recipients WHERE campaign_id = {campaign}
    """) == "pending:1", "retry persisted after definitive 451")
    fixture.sql(f"UPDATE warpdrive_delivery_recipients SET available_at = NOW() WHERE campaign_id = {campaign}")
    fixture.finish(campaign, 1)
    ids = relay.captures(recipient)
    assert_equal((len(ids), len(set(ids))), (2, 1), "definite retries keep the same Message-ID")
    fixture.sql(f"DELETE FROM subscribers WHERE email = '{recipient}'")
    assert_equal(fixture.sql(f"""
        SELECT state = 'accepted' AND subscriber_id IS NULL AND subscriber_uuid IS NULL
            AND address_digest IS NULL AND message_id IS NOT NULL
        FROM warpdrive_delivery_recipients WHERE campaign_id = {campaign}
    """), "t", "erasure keeps the receipt while clearing recipient identity")


def prove_atomic_admission(fixture, relay):
    recipient = "admission@example.test"
    campaign = fixture.campaign("Rollback before durable admission", [recipient])
    fixture.sql(f"""
        CREATE FUNCTION fixture_fail_delivery_admission() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture rejected durable admission'; END;
        $$;
        CREATE TRIGGER fixture_fail_delivery_admission BEFORE INSERT ON warpdrive_delivery_recipients
        FOR EACH ROW WHEN (NEW.campaign_id = {campaign}) EXECUTE FUNCTION fixture_fail_delivery_admission();
    """)
    fixture.transition(campaign, "running")
    wait_until(lambda: "fixture rejected durable admission" in (fixture.root / "engine.log").read_text(),
               "injected ledger write failure", seconds=18)
    assert_equal(fixture.sql(f"SELECT last_subscriber_id FROM campaigns WHERE id = {campaign}"), "0",
                 "cursor rolls back with admission")
    assert_equal(fixture.deliveries(campaign)["counts"], {}, "failed admission leaves no queued receipt")
    assert_equal(relay.captures(recipient), [], "SMTP waits for durable admission")
    fixture.sql("DROP TRIGGER fixture_fail_delivery_admission ON warpdrive_delivery_recipients")
    fixture.finish(campaign, 1)
    assert_equal(len(relay.captures(recipient)), 1, "recipient recovered after the write fault")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    args = parser.parse_args()
    with Relay() as relay, tempfile.TemporaryDirectory(prefix="lm-delivery-", dir="/tmp") as folder:
        worker = threading.Thread(target=relay.serve_forever, daemon=True)
        worker.start()
        fixture = EngineFixture(Path(folder), args.engine.resolve(strict=True), args.pg_bin.resolve(strict=True))
        try:
            fixture.start(fixture_sql(relay.server_address[1]))
            assert_equal(fixture.status(999)["status"], "paused", "legacy started campaign quarantined")
            assert_equal(fixture.deliveries(999)["hold"], "legacy", "legacy cursor cannot be reconciled by guessing")
            fixture.transition(999, "running", expected=409)
            fixture.stop_engine()
            fixture.launch()
            assert_equal(fixture.api("/api/warpdrive-capabilities")["durableDelivery"], 1, "durability capability")
            status, _ = fixture.request("/api/warpdrive-delivery/999")
            assert_equal(status, 403, "anonymous receipt access")
            prove_pause_resume(fixture, relay)
            prove_lost_ack(fixture, relay)
            prove_process_restart(fixture, relay)
            prove_definite_retry(fixture, relay)
            prove_atomic_admission(fixture, relay)
        except BaseException:
            print((Path(folder) / "engine.log").read_text(), file=sys.stderr)
            raise
        finally:
            relay.resume.set()
            fixture.stop()
            relay.shutdown()
            worker.join(timeout=3)
    print("Legacy hold, pause/resume, lost acknowledgement, SIGKILL, retry, erasure and atomic admission passed.")


if __name__ == "__main__":
    main()
