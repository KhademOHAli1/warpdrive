#!/usr/bin/env python3
"""Verify scoped signup, audience records, bulk suppression and active import cancellation."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import select
import subprocess
import tempfile
from urllib.parse import urlencode

from consent import Fixture, SQL_FIXTURES, assert_equal, wait_until


ACTIVE = "00000000-0000-4000-8000-000000000501"
OTHER = "00000000-0000-4000-8000-000000000502"
PRIVATE = "00000000-0000-4000-8000-000000000599"
ARCHIVED = "00000000-0000-4000-8000-000000000598"
FIXTURES = SQL_FIXTURES + f"""
INSERT INTO lists (id, uuid, name, type, optin, status) VALUES
  (599, '{PRIVATE}', 'Private fixture', 'private', 'double', 'active'),
  (598, '{ARCHIVED}', 'Archived fixture', 'public', 'double', 'archived');
UPDATE settings SET value='true'::jsonb WHERE key='app.enable_public_subscription_page';
UPDATE settings SET value='false'::jsonb WHERE key='app.send_optin_confirmation';
UPDATE settings SET value='[]'::jsonb WHERE key='app.notify_emails';
UPDATE settings SET value='{{"altcha":{{"enabled":true,"complexity":64}},"hcaptcha":{{"enabled":false,"key":"","secret":""}}}}'::jsonb
WHERE key='security.captcha';
INSERT INTO campaigns (id, uuid, name, subject, from_email, body, messenger) VALUES
  (701, '00000000-0000-4000-8000-000000000701', 'Fixture campaign', 'Fixture subject', 'sender@example.test', '', 'email');
INSERT INTO campaign_views (campaign_id, subscriber_id) VALUES (701,501);
INSERT INTO links (id, uuid, url) VALUES (701, '00000000-0000-4000-8000-000000000711', 'https://example.test/private-value');
INSERT INTO link_clicks (campaign_id, link_id, subscriber_id) VALUES (701,701,501);
INSERT INTO bounces (id, subscriber_id, type, source) VALUES (701,502,'hard','fixture');
"""


def api(fixture, path, method="GET", body=None):
    headers = {**fixture.auth, "Content-Type": "application/json"}
    encoded = None if body is None else json.dumps(body).encode()
    status, raw = fixture.request(path, headers, encoded, method=method)
    assert_equal(status, 200, f"{method} {path}")
    return json.loads(raw)


def solve_captcha(fixture):
    status, raw = fixture.request("/api/public/captcha/altcha")
    assert_equal(status, 200, "ALTCHA endpoint")
    challenge = json.loads(raw)
    answer = next(i for i in range(challenge["maxNumber"] + 1)
                  if hashlib.sha256(f"{challenge['salt']}{i}".encode()).hexdigest() == challenge["challenge"])
    return base64.b64encode(json.dumps({**challenge, "number": answer}).encode()).decode()


def signup(fixture):
    path = f"/subscription/form?l={ACTIVE}"
    status, html = fixture.request(path)
    assert_equal(status, 200, "scoped public signup")
    assert b'<altcha-widget' in html, "Scoped form lost verification"
    assert f'name="l" value="{ACTIVE}"'.encode() in html, "Scoped list is missing"
    assert f'name="l" value="{OTHER}"'.encode() not in html, "Another list was rendered"
    assert f'action="?l={ACTIVE}"'.encode() in html, "Scoped form action lost its selection"
    for invalid in (PRIVATE, ARCHIVED, f"{ACTIVE}&l={OTHER}", "invalid"):
        assert_equal(fixture.request(f"/subscription/form?l={invalid}")[0], 404, "invalid list scope")
    fields = {"email": "scoped-signup@example.test", "name": "Scoped signup", "l": OTHER}
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    assert_equal(fixture.request(path, headers, urlencode(fields).encode())[0], 400, "missing public CAPTCHA")
    fields["altcha"] = solve_captcha(fixture)
    assert_equal(fixture.request(path, headers, urlencode(fields).encode())[0], 200, "verified scoped signup")
    assert_equal(fixture.sql("""SELECT string_agg(sl.list_id || ':' || sl.status, ',' ORDER BY sl.list_id)
        FROM subscribers s JOIN subscriber_lists sl ON sl.subscriber_id=s.id WHERE s.email='scoped-signup@example.test'"""),
        "501:unconfirmed", "POST cannot broaden the chosen list")


def records_and_bulk(fixture):
    activity = api(fixture, "/api/subscribers/501/activity")["data"]
    assert_equal(activity["campaign_views"][0]["view_count"], 1, "real activity campaign view")
    assert_equal(activity["link_clicks"][0]["click_count"], 1, "real activity click")
    exported = api(fixture, "/api/subscribers/501/export")
    assert_equal(exported["profile"][0]["status"], "enabled", "profile JSON export contract")
    assert_equal(api(fixture, "/api/subscribers/lists", "PUT", {
        "ids": [501, 504], "target_list_ids": [501], "action": "unsubscribe",
    })["data"], True, "selected unsubscribe")
    assert_equal(fixture.membership(501), "501:unsubscribed,502:unsubscribed,503:unconfirmed", "exact list selection")
    assert_equal(fixture.membership(504), "501:unsubscribed", "second selected member")
    assert_equal(fixture.membership(505), "501:unconfirmed", "unselected member")
    assert_equal(api(fixture, "/api/subscribers/blocklist", "PUT", {"ids": [501, 504]})["data"], True, "selected blocklist")
    assert_equal(fixture.sql("SELECT string_agg(status::text, ',' ORDER BY id) FROM subscribers WHERE id IN(501,504,505)"),
                 "blocklisted,blocklisted,enabled", "bulk global suppression scope")
    assert_equal(api(fixture, "/api/bounces/701", "DELETE")["data"], True, "bounce deletion")
    assert_equal(fixture.sql("SELECT count(*) FROM bounces WHERE id=701"), "0", "bounce row removed")
    assert_equal(fixture.sql("SELECT status FROM subscribers WHERE id=502"), "blocklisted", "bounce removal retains suppression")


def start_import(fixture):
    boundary = "warpdrive-cancellation-fixture"
    filename = "cancel-fixture.csv"
    params = json.dumps({"mode": "subscribe", "delim": ",", "lists": [501],
                         "subscription_status": "unconfirmed", "overwrite_subscription_status": False})
    csv = "email,name\n" + "cancel-fixture@example.test,Fixture\n" * 12_000
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"params\"\r\n\r\n{params}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: text/csv\r\n\r\n{csv}\r\n--{boundary}--\r\n").encode()
    status, raw = fixture.request("/api/import/subscribers", {**fixture.auth, "Content-Type": f"multipart/form-data; boundary={boundary}"}, body)
    assert_equal(status, 200, "start active import")
    assert_equal(json.loads(raw)["data"]["status"], "importing", "active importer status")


def cancel_import(fixture):
    with subprocess.Popen(fixture.psql_args(), env=fixture.env, cwd=fixture.root, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as locker:
        try:
            locker.stdin.write("BEGIN;\nLOCK TABLE subscribers IN SHARE MODE;\n\\echo fixture_locked\n")
            locker.stdin.flush()
            readable, _, _ = select.select([locker.stdout], [], [], 5)
            if not readable or locker.stdout.readline().strip() != "fixture_locked":
                raise AssertionError("Could not hold the fixture importer lock")
            start_import(fixture)
            wait_until(lambda: fixture.sql("""SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%upsert%' OR
                      (pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO subscribers%'))""") == "t",
                       "active import blocked on the isolated fixture")
            stopping = api(fixture, "/api/import/subscribers", "DELETE")["data"]
            assert_equal(stopping["status"], "stopping", "active cancellation acknowledged")
            locker.stdin.write("COMMIT;\n\\q\n")
            locker.stdin.flush()
            assert_equal(locker.wait(timeout=5), 0, "fixture lock release")
        finally:
            if locker.poll() is None:
                locker.kill()
    def status():
        return api(fixture, "/api/import/subscribers")["data"]
    wait_until(lambda: status()["status"] not in ("importing", "stopping"), "cancelled import settled", seconds=25)
    result = status()
    logs = api(fixture, "/api/import/subscribers/logs")["data"]
    assert "stop request received" in logs, "Importer did not consume the stop signal"
    assert 0 < result["imported"] < result["total"], "Cancelled import did not finish partially"
    print(f"Active cancellation acknowledged and settled with {result['imported']} of {result['total']} rows processed ({result['status']}).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-audience-parity-") as directory:
        fixture = Fixture(Path(directory), args.engine.resolve(), args.pg_bin.resolve())
        try:
            fixture.start(FIXTURES)
            signup(fixture)
            records_and_bulk(fixture)
            cancel_import(fixture)
        finally:
            fixture.stop()
    print("Scoped verified signup, subscriber records, exact bulk suppression and isolated bounce deletion passed.")


if __name__ == "__main__":
    main()
