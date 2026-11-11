#!/usr/bin/env python3
"""Exercise scoped mailbox proof, purpose grants and erasure against PG and Mailpit."""

import argparse
from email import policy
from email.parser import BytesParser
from html import unescape
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen
from uuid import uuid4

from consent import Fixture, SQL_FIXTURES, assert_equal, wait_until


API = "/api/warpdrive/crm-identity"
MARK = SQL_FIXTURES + "\n-- identity fixture\n"


def local_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def setting(key, value):
    literal = json.dumps(value).replace("'", "''")
    return f"UPDATE settings SET value='{literal}'::jsonb WHERE key='{key}';"


class IdentityFixture(Fixture):
    def __init__(self, root, engine, pg_bin, mailpit):
        super().__init__(root, engine, pg_bin)
        self.mailpit = mailpit
        self.pit_process = None
        self.smtp_port = local_port()
        self.pit_port = local_port()
        self.env["NEWSLETTER_DELIVERY_ENABLED"] = "true"

    def start(self):
        self.pit_process = subprocess.Popen([
            str(self.mailpit), "--listen", f"127.0.0.1:{self.pit_port}",
            "--smtp", f"127.0.0.1:{self.smtp_port}", "--smtp-allowed-recipients", r"^[^@]+@example\.test$",
        ], env=self.env, cwd=self.root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_until(lambda: self.pit("/readyz") is not None, "isolated SMTP capture")
        super().start(MARK)

    def sql(self, statement, database="consent"):
        if statement == MARK:
            smtp = [{"name": "fixture", "enabled": True, "host": "127.0.0.1", "port": self.smtp_port,
                     "auth_protocol": "none", "username": "", "password": "", "max_conns": 1,
                     "idle_timeout": "15s", "wait_timeout": "5s", "max_msg_retries": 0, "tls_type": "none"}]
            statement += "".join(setting(key, value) for key, value in (
                ("app.root_url", self.origin), ("smtp", smtp), ("app.notify_emails", []),
                ("app.from_email", "Fixture <sender@example.test>"),
            ))
        return super().sql(statement, database)

    def pit(self, path):
        try:
            with urlopen(f"http://127.0.0.1:{self.pit_port}{path}", timeout=3) as response:
                return response.read()
        except OSError:
            return None

    def messages(self, email):
        result = self.pit("/api/v1/messages")
        return [] if result is None else [
            message for message in json.loads(result)["messages"]
            if any(to["Address"] == email for to in message["To"])
        ]

    def token(self, email, challenge_id):
        def capture():
            for message in self.messages(email):
                raw = self.pit(f"/api/v1/message/{message['ID']}/raw")
                parsed = BytesParser(policy=policy.default).parsebytes(raw)
                body = parsed.get_body(preferencelist=("html",)).get_content()
                match = re.search(rf'href="([^\"]*/subscription/crm-verify/{challenge_id}\?[^\"]+)"', body)
                if match:
                    return unescape(match[1])
            return None
        wait_until(capture, "scoped mailbox verification email")
        path = urlsplit(capture())
        assert_equal(f"{path.scheme}://{path.netloc}", self.origin, "verification URL scope")
        return path.path, parse_qs(path.query)["token"][0]

    def api(self, path, body=None, expected=200, auth=True):
        headers = {**(self.auth if auth else {}), "Content-Type": "application/json"}
        data = None if body is None else json.dumps(body).encode()
        status, raw = self.request(API + path, headers, data)
        assert_equal(status, expected, f"private identity route {path}")
        return json.loads(raw)["data"] if status == 200 else None

    def verify(self, path, token, expected=200):
        status, _ = self.request(path, {"Content-Type": "application/x-www-form-urlencoded"},
                                 urlencode({"token": token}).encode())
        assert_equal(status, expected, "public affirmative verification")

    def stop(self):
        try:
            super().stop()
        finally:
            if self.pit_process is not None and self.pit_process.poll() is None:
                self.pit_process.terminate()
                try:
                    self.pit_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.pit_process.kill()
                    self.pit_process.wait(timeout=5)


def issue_identity(fixture, email):
    binding = str(uuid4())
    data = {"id": binding, "bindingId": binding, "purpose": "identity", "email": email, "listId": None}
    fixture.api("/challenges", data, expected=403, auth=False)
    initial = fixture.api("/challenges", data)
    assert_equal(fixture.api("/challenges", data), initial, "idempotent challenge replay")
    fixture.api("/challenges", {**data, "email": "wrong@example.test"}, expected=409)
    path, token = fixture.token(email, binding)
    for method in ("GET", "HEAD"):
        status, _ = fixture.request(path + "?" + urlencode({"token": token}), method=method)
        assert_equal(status, 200, "inert link fetch")
    assert_equal(fixture.api(f"/challenges/{binding}")["state"], "pending", "prefetch state")
    fixture.verify(path, token)
    fixture.verify(path, token, expected=404)
    verified = fixture.api(f"/challenges/{binding}")
    assert_equal(verified["state"], "verified", "affirmative proof state")
    assert_equal(fixture.membership(verified["subscriberId"]), "", "identity proof alone has no membership")
    assert_equal(len(fixture.messages(email)), 1, "one proof message")
    return verified


def prove(fixture):
    address = "crm-proof@example.test"
    proof = issue_identity(fixture, address)
    binding = proof["id"]
    subscriber = proof["subscriberId"]
    invite = str(uuid4())
    invite_body = {"id": invite, "bindingId": binding, "purpose": "newsletter", "email": address, "listId": 501}
    fixture.api("/challenges", {**invite_body, "listId": 503}, expected=409)
    assert_equal(fixture.api("/challenges", invite_body)["state"], "pending", "purpose challenge admission")
    lookup = {"bindingIds": [binding], "listId": 501}
    assert_equal(fixture.api("/grants", lookup), [], "pending invitation has no grant")
    generic = urlencode({"confirm": "true", "l": "00000000-0000-4000-8000-000000000501"}).encode()
    fixture.request(f"/subscription/optin/{proof['subscriberUuid']}", {"Content-Type": "application/x-www-form-urlencoded"}, generic)
    assert_equal(fixture.membership(subscriber), "501:unconfirmed", "generic link cannot consume purpose invite")
    path, token = fixture.token(address, invite)
    fixture.verify(path, token)
    grants = fixture.api("/grants", lookup)
    assert_equal([(item["grantUuid"], item["subscriberUuid"], item["purposeListId"]) for item in grants],
                 [(invite, proof["subscriberUuid"], 501)], "exact purpose grant")
    fixture.sql(f"UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id={subscriber} AND list_id=501")
    fixture.api("/challenges", {**invite_body, "id": str(uuid4())}, expected=409)
    fixture.sql(f"UPDATE subscriber_lists SET status='confirmed' WHERE subscriber_id={subscriber} AND list_id=501")
    assert_equal(fixture.api("/grants", lookup), [], "old grant stays revoked after membership regrant")

    erase = {"id": str(uuid4()), "bindingId": binding}
    receipt = fixture.api("/erasures", erase)
    assert_equal(fixture.api("/erasures", erase), receipt, "idempotent erasure replay")
    assert_equal(fixture.api(f"/erasures/{erase['id']}"), receipt, "durable erasure receipt")
    assert_equal(fixture.sql(f"SELECT count(*) FROM subscribers WHERE id={subscriber}"), "0", "subscriber erasure")
    assert_equal(fixture.sql(f"SELECT count(*) FROM warpdrive_crm_identity_challenges WHERE subscriber_id={subscriber}"), "0", "proof PII removal")
    assert_equal(fixture.sql("SELECT count(*) FROM warpdrive_crm_suppressions"), "1", "minimal suppression retention")
    next_id = str(uuid4())
    fixture.api("/challenges", {"id": next_id, "bindingId": next_id, "purpose": "identity", "email": address, "listId": None}, expected=503)
    assert_equal(fixture.sql(f"SELECT count(*) FROM subscribers WHERE id={subscriber} OR email='{address}'"), "0", "suppressed reentry")
    print("Scoped mailbox and list proof, irrevocable grant fencing and erasure passed against isolated SMTP/PostgreSQL.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    parser.add_argument("--mailpit", required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-crm-proof-") as directory:
        fixture = IdentityFixture(Path(directory), args.engine.resolve(), args.pg_bin.resolve(), args.mailpit.resolve())
        try:
            fixture.start()
            prove(fixture)
        finally:
            fixture.stop()


if __name__ == "__main__":
    main()
