#!/usr/bin/env python3
"""Exercise the public handler against a disposable PostgreSQL server."""

import argparse
import base64
import concurrent.futures
import io
import json
import os
from pathlib import Path
import re
import secrets
import select
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


SQL_FIXTURES = """
INSERT INTO lists (id, uuid, name, type, optin) VALUES
  (501, '00000000-0000-4000-8000-000000000501', 'Pending', 'public', 'double'),
  (502, '00000000-0000-4000-8000-000000000502', 'Opted out', 'public', 'double'),
  (503, '00000000-0000-4000-8000-000000000503', 'Single', 'public', 'single'),
  (504, '00000000-0000-4000-8000-000000000504', 'Concurrent mode', 'public', 'single');
INSERT INTO subscribers (id, uuid, email, name, status) VALUES
  (501, '00000000-0000-4000-8000-000000000511', 'mixed@example.test', 'Mixed', 'enabled'),
  (502, '00000000-0000-4000-8000-000000000512', 'blocked@example.test', 'Blocked', 'blocklisted'),
  (503, '00000000-0000-4000-8000-000000000513', 'disabled@example.test', 'Disabled', 'disabled'),
  (504, '00000000-0000-4000-8000-000000000514', 'race@example.test', 'Race', 'enabled'),
  (505, '00000000-0000-4000-8000-000000000515', 'blocked-race@example.test', 'Blocked race', 'enabled');
INSERT INTO subscriber_lists (subscriber_id, list_id, status) VALUES
  (501, 501, 'unconfirmed'), (501, 502, 'unsubscribed'), (501, 503, 'unconfirmed'),
  (502, 501, 'unconfirmed'), (503, 501, 'unconfirmed'), (504, 501, 'unconfirmed'),
  (505, 501, 'unconfirmed');
UPDATE settings SET value = 'false'::jsonb WHERE key IN ('app.check_updates', 'app.show_optin_page');
UPDATE settings
SET value = jsonb_set(jsonb_set(value, '{0,host}', '"127.0.0.1"'), '{0,port}', '1')
WHERE key = 'smtp';
"""


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def wait_until(check, description, seconds=8):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for {description}")


class Fixture:
    def __init__(self, root, engine, pg_bin):
        self.root = root
        self.engine = engine
        self.pg_bin = pg_bin
        self.socket = root / "pg"
        self.socket.mkdir()
        self.env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
        self.env["LC_ALL"] = "C"
        self.data = root / "data"
        self.serve = None
        self.postgres_running = False
        self.log = (root / "engine.log").open("wb")

    def run(self, argv, **kwargs):
        return subprocess.run(argv, env=self.env, cwd=self.root, check=True,
                              capture_output=True, text=True, timeout=25, **kwargs)

    def psql_args(self, database="consent"):
        return [
            str(self.pg_bin / "psql"), "-X", "-qAtw", "-v", "ON_ERROR_STOP=1",
            "-h", str(self.socket), "-p", "5432", "-U", "consentproof", "-d", database,
        ]

    def sql(self, statement, database="consent"):
        return self.run(self.psql_args(database) + ["-c", statement]).stdout.strip()

    def start(self, fixtures=SQL_FIXTURES):
        self.run([str(self.pg_bin / "initdb"), "-A", "trust", "--no-locale",
                  "-U", "consentproof", "-D", str(self.data)])
        options = f"-k {self.socket} -c listen_addresses='' -p 5432"
        pg_log = self.root / "pg.log"
        try:
            self.run([str(self.pg_bin / "pg_ctl"), "-D", str(self.data), "-l",
                      str(pg_log), "-o", options, "-w", "start"])
        except subprocess.CalledProcessError as error:
            detail = pg_log.read_text() if pg_log.is_file() else error.stderr
            raise RuntimeError(f"Disposable PostgreSQL failed to start:\n{detail}") from error
        self.postgres_running = True
        self.sql("CREATE DATABASE consent", "postgres")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.origin = f"http://127.0.0.1:{port}"
        self.env.update({
            "LISTMONK_app__address": f"127.0.0.1:{port}",
            "LISTMONK_db__host": str(self.socket),
            "LISTMONK_db__port": "5432",
            "LISTMONK_db__user": "consentproof",
            "LISTMONK_db__database": "consent",
            "LISTMONK_db__ssl_mode": "disable",
            "LISTMONK_ADMIN_USER": "consent-proof",
            "LISTMONK_ADMIN_PASSWORD": secrets.token_urlsafe(24),
            "LISTMONK_ADMIN_API_USER": "consent-proof-api",
        })
        result = self.run([str(self.engine), "--config", "", "--install", "--yes"])
        token = re.search(r'export LISTMONK_ADMIN_API_TOKEN="([^"]+)"', result.stderr)
        if token is None:
            raise AssertionError("Fixture API token was not minted")
        credential = base64.b64encode(f"consent-proof-api:{token[1]}".encode()).decode()
        self.auth = {"Authorization": f"Basic {credential}"}
        self.sql(fixtures)
        self.serve = subprocess.Popen([str(self.engine), "--config", "", "--passive"],
                                      cwd=self.root, env=self.env, stdout=self.log,
                                      stderr=subprocess.STDOUT)
        wait_until(self.healthy, "passive engine health")

    def healthy(self):
        if self.serve.poll() is not None:
            raise AssertionError("Passive fixture engine exited")
        try:
            return self.request("/health")[0] == 200
        except OSError:
            return False

    def request(self, path, headers=None, body=None, method=None):
        request = urllib.request.Request(self.origin + path, headers=headers or {}, data=body, method=method)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def confirm(self, subscriber, lists):
        body = urllib.parse.urlencode([("confirm", "true")] + [
            ("l", f"00000000-0000-4000-8000-000000000{number}") for number in lists
        ]).encode()
        status, content = self.request(f"/subscription/optin/00000000-0000-4000-8000-000000000{subscriber}",
                                       {"Content-Type": "application/x-www-form-urlencoded"}, body)
        assert_equal(status, 200, "confirmation status")
        return content

    def membership(self, subscriber):
        return self.sql(
            f"""SELECT string_agg(list_id || ':' || status, ',' ORDER BY list_id)
                FROM subscriber_lists WHERE subscriber_id = {subscriber}"""
        )

    def update_list(self, list_id, **fields):
        headers = {**self.auth, "Content-Type": "application/json"}
        return self.request(f"/api/lists/{list_id}", headers, json.dumps(fields).encode(), method="PUT")

    def list_state(self, list_id):
        return self.sql(f"SELECT name || ':' || optin FROM lists WHERE id = {list_id}")

    def race_update(self, sql, blocked_query, action, *args):
        with subprocess.Popen(self.psql_args(), env=self.env, cwd=self.root, text=True,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as locker:
            try:
                locker.stdin.write(f"BEGIN;\n{sql};\n\\echo fixture_locked\n")
                locker.stdin.flush()
                readable, _, _ = select.select([locker.stdout], [], [], 5)
                if not readable or locker.stdout.readline().strip() != "fixture_locked":
                    raise AssertionError("Could not acquire the fixture lock")
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    pending = executor.submit(action, *args)
                    try:
                        wait_until(
                            lambda: self.sql(
                                f"""SELECT EXISTS (
                                     SELECT 1 FROM pg_stat_activity
                                     WHERE pid <> pg_backend_pid()
                                     AND wait_event_type = 'Lock'
                                     AND query LIKE '%{blocked_query}%'
                                   )"""
                            ) == "t",
                            "API operation blocked on the fixture transaction",
                        )
                    finally:
                        locker.stdin.write("COMMIT;\n\\q\n")
                        locker.stdin.flush()
                    result = pending.result(timeout=5)
                assert_equal(locker.wait(timeout=5), 0, "fixture transaction exit status")
                return result
            finally:
                if locker.poll() is None:
                    locker.kill()

    def concurrent_suppression(self, subscriber_uuid, sql):
        result = self.race_update(sql, "eligibleSubscriber AS MATERIALIZED", self.confirm, subscriber_uuid, [501])
        if b"No subscriptions" not in result:
            raise AssertionError(f"Concurrent suppression {subscriber_uuid} reported a confirmation")

    def stop(self):
        if self.serve is not None and self.serve.poll() is None:
            self.serve.terminate()
            try:
                self.serve.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.serve.kill()
                self.serve.wait(timeout=5)
        self.log.close()
        if self.postgres_running or (self.data / "postmaster.pid").is_file():
            self.run([str(self.pg_bin / "pg_ctl"), "-D", str(self.data), "-m",
                      "immediate", "-w", "stop"])


def prove_list_mode(fixture):
    status, body = fixture.update_list(501, name="Should remain unchanged", optin="single")
    assert_equal(status, 409, "double-to-single downgrade")
    if b"A double opt-in list cannot be changed to single opt-in" not in body:
        raise AssertionError("List downgrade response omitted the conflict reason")
    assert_equal(fixture.list_state(501), "Pending:double", "downgrade preserves the full list")
    assert_equal(fixture.membership(501), "501:unconfirmed,502:unsubscribed,503:unconfirmed",
                 "downgrade preserves membership status")

    status, _ = fixture.update_list(501, name="Pending renamed")
    assert_equal(status, 200, "name-only edit")
    assert_equal(fixture.list_state(501), "Pending renamed:double", "name-only edit preserves opt-in mode")

    # A stale single-mode edit must fail after a concurrent upgrade commits.
    status, _ = fixture.race_update(
        "UPDATE lists SET optin='double' WHERE id=504", "WITH target AS MATERIALIZED",
        lambda: fixture.update_list(504, name="Stale edit", optin="single"),
    )
    assert_equal(status, 409, "concurrent single-to-double upgrade defeats stale edit")
    assert_equal(fixture.list_state(504), "Concurrent mode:double", "concurrent list mode")


def prove_affirmative_confirmation(fixture):
    sub_uuid = "00000000-0000-4000-8000-000000000511"
    list_uuid = "00000000-0000-4000-8000-000000000501"
    path = f"/subscription/optin/{sub_uuid}"
    query_path = f"{path}?confirm=true&l={list_uuid}"
    pending = "501:unconfirmed,502:unsubscribed,503:unconfirmed"

    for url in (path, query_path):
        status, body = fixture.request(url)
        assert_equal(status, 200, "confirmation page GET")
        if f'form method="post" action="./{sub_uuid}"'.encode() not in body:
            raise AssertionError("Confirmation page did not render the explicit POST form")
        assert_equal(fixture.membership(501), pending, "GET leaves membership pending")

    status, body = fixture.request(query_path, method="HEAD")
    assert_equal((status, body), (200, b""), "confirmation page HEAD")
    assert_equal(fixture.membership(501), pending, "HEAD leaves membership pending")

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    for data in (f"l={list_uuid}", "confirm=true"):
        status, _ = fixture.request(query_path, headers, data.encode(), method="POST")
        assert_equal(status, 400, "incomplete confirmation body")
        assert_equal(fixture.membership(501), pending, "incomplete POST leaves membership pending")


def prove(fixture):
    prove_list_mode(fixture)
    prove_affirmative_confirmation(fixture)
    fixture.confirm(511, [501, 502, 503])
    assert_equal(fixture.membership(501), "501:confirmed,502:unsubscribed,503:unconfirmed",
                 "mixed-list confirmation")
    for uuid, record in ((512, 502), (513, 503)):
        result = fixture.confirm(uuid, [501])
        if b"No subscriptions" not in result:
            raise AssertionError("Globally suppressed subscriber received a confirmation")
        assert_equal(fixture.membership(record), "501:unconfirmed", "global suppression")
    fixture.concurrent_suppression(
        514, "UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id=504",
    )
    assert_equal(fixture.membership(504), "501:unsubscribed", "concurrent unsubscribe")
    fixture.concurrent_suppression(515, "UPDATE subscribers SET status='blocklisted' WHERE id=505")
    assert_equal(fixture.membership(505), "501:unconfirmed", "concurrent global suppression")
    status, _ = fixture.update_list(503, name="Stricter list", optin="double")
    assert_equal(status, 200, "single-to-double upgrade")
    assert_equal(fixture.list_state(503), "Stricter list:double", "upgraded list mode")
    status, _ = fixture.request("/api/warpdrive-capabilities")
    assert_equal(status, 403, "unauthenticated capabilities")
    status, body = fixture.request("/api/warpdrive-capabilities", fixture.auth)
    assert_equal(status, 200, "authenticated capabilities")
    assert_equal(json.loads(body)["data"], {
        "consent": 2, "dispatch": 1, "listConsentMode": 1, "publicSubscriberUpdate": 1,
        "campaignRevision": 1, "crmIdentity": 1, "crmAudiences": 1, "durableDelivery": 1, "crmAttribution": 1, "listEmbed": 1, "sesFeedback": 1, "readiness": 1, "atomicBulk": 1,
    }, "derived capabilities")
    status, source = fixture.request("/public/static/warpdrive-engine-source.tar.gz")
    assert_equal(status, 200, "source archive response")
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        for name in (
            "LICENSE", "listmonk-ef0a758.tar.gz",
            "patches/010-optin-confirmation.patch", "patches/020-dispatch.patch",
            "patches/025-list-consent-mode.patch", "patches/027-public-subscriber-update.patch",
            "patches/030-campaign-revision.patch", "patches/035-affirmative-optin.patch",
            "tests/public-subscriber-update.py",
        ):
            archive.getmember(name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    args = parser.parse_args()
    engine = args.engine.resolve(strict=True)
    pg_bin = args.pg_bin.resolve(strict=True)
    # PostgreSQL's socket path has a small platform-specific length limit.
    with tempfile.TemporaryDirectory(prefix="lm-consent-", dir="/tmp") as directory:
        fixture = Fixture(Path(directory), engine, pg_bin)
        try:
            fixture.start()
            prove(fixture)
        finally:
            fixture.stop()
    print("List mode, affirmative confirmation, suppression, lock races, capabilities and source archive passed.")


if __name__ == "__main__":
    main()
