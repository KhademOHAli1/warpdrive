#!/usr/bin/env python3
"""Verify public subscriber writes preserve current suppressions on the packed engine."""

import argparse
import concurrent.futures
from pathlib import Path
import select
import subprocess
import tempfile
import urllib.parse

from consent import Fixture, SQL_FIXTURES, assert_equal, wait_until


PUBLIC_FIXTURES = SQL_FIXTURES + """
INSERT INTO lists (id, uuid, name, type, optin, status) VALUES
  (506, '00000000-0000-4000-8000-000000000506', 'Archived', 'public', 'single', 'archived');
INSERT INTO subscribers (id, uuid, email, name, status) VALUES
  (506, '00000000-0000-4000-8000-000000000516', 'opted-out@example.test', 'Original', 'enabled'),
  (507, '00000000-0000-4000-8000-000000000517', 'prefs@example.test', 'Before', 'enabled'),
  (508, '00000000-0000-4000-8000-000000000518', 'signup-race@example.test', 'Before', 'enabled');
INSERT INTO subscriber_lists (subscriber_id, list_id, status) VALUES
  (506, 503, 'unsubscribed'), (507, 501, 'confirmed');
UPDATE settings SET value='true'::jsonb WHERE key IN ('privacy.allow_preferences', 'app.enable_public_subscription_page');
UPDATE settings SET value='false'::jsonb WHERE key='app.send_optin_confirmation';
"""


def uuid(number):
    return f"00000000-0000-4000-8000-000000000{number}"


def form(fixture, path, fields):
    status, _ = fixture.request(
        path,
        {"Content-Type": "application/x-www-form-urlencoded"},
        urllib.parse.urlencode(fields).encode(),
    )
    assert_equal(status, 200, "public form response")


def subscribe(fixture, email, lists):
    form(fixture, "/subscription/form", [("name", "New public name"), ("email", email)] + [
        ("l", uuid(number)) for number in lists
    ])


def while_locked(fixture, sql, request, query_fragment):
    with subprocess.Popen(fixture.psql_args(), env=fixture.env, cwd=fixture.root, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as locker:
        try:
            locker.stdin.write(f"BEGIN;\n{sql};\n\\echo fixture_locked\n")
            locker.stdin.flush()
            readable, _, _ = select.select([locker.stdout], [], [], 5)
            if not readable or locker.stdout.readline().strip() != "fixture_locked":
                raise AssertionError("Could not hold the fixture row lock")
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(request)
                try:
                    wait_until(
                        lambda: fixture.sql(f"""SELECT EXISTS (
                            SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid()
                            AND wait_event_type='Lock' AND query LIKE '%{query_fragment}%'
                        )""") == "t",
                        "public request waiting on the fixture row lock",
                    )
                finally:
                    locker.stdin.write("COMMIT;\n\\q\n")
                    locker.stdin.flush()
                pending.result(timeout=5)
            assert_equal(locker.wait(timeout=5), 0, "fixture lock transaction")
        finally:
            if locker.poll() is None:
                locker.kill()


def prove(fixture):
    subscribe(fixture, "Opted-Out@example.test", [501, 503])
    assert_equal(fixture.membership(506), "501:unconfirmed,503:unsubscribed", "existing list opt-out")
    assert_equal(fixture.sql("SELECT name FROM subscribers WHERE id=506"), "Original", "signup profile")
    for email, subscriber in (("blocked@example.test", 502), ("disabled@example.test", 503)):
        subscribe(fixture, email, [503])
        assert_equal(fixture.membership(subscriber), "501:unconfirmed", "global suppression")

    subscribe(fixture, "archived-only@example.test", [506])
    assert_equal(fixture.sql("SELECT COUNT(*) FROM subscribers WHERE email='archived-only@example.test'"),
                 "0", "archived list intake")
    subscribe(fixture, "new@example.test", [501, 506])
    assert_equal(fixture.sql("""SELECT string_agg(sl.list_id || ':' || sl.status, ',' ORDER BY sl.list_id)
        FROM subscribers s JOIN subscriber_lists sl ON sl.subscriber_id=s.id WHERE s.email='new@example.test'"""),
        "501:unconfirmed", "fresh signup uses only active selected lists")

    while_locked(
        fixture,
        """UPDATE subscribers SET status='blocklisted', email='new-prefs@example.test',
           attribs='{"flag": true}' WHERE id=507""",
        lambda: form(fixture, f"/subscription/{uuid(999)}/{uuid(517)}", [
            ("manage", "true"), ("name", "Public name"), ("l", uuid(501)),
        ]),
        "UPDATE subscribers SET name=",
    )
    assert_equal(fixture.sql("SELECT name || '|' || status || '|' || email || '|' || (attribs->>'flag') "
                             "FROM subscribers WHERE id=507"),
                 "Public name|blocklisted|new-prefs@example.test|true", "name-only preference write")

    while_locked(
        fixture,
        "UPDATE subscribers SET status='blocklisted' WHERE id=508",
        lambda: subscribe(fixture, "signup-race@example.test", [501, 503]),
        "publicLists AS MATERIALIZED",
    )
    assert_equal(fixture.membership(508), "", "concurrent suppression blocks public membership")
    assert_equal(fixture.sql("SELECT status FROM subscribers WHERE id=508"), "blocklisted", "signup race status")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-public-subscriber-") as directory:
        fixture = Fixture(Path(directory), args.engine.resolve(), args.pg_bin.resolve())
        try:
            fixture.start(PUBLIC_FIXTURES)
            prove(fixture)
        finally:
            fixture.stop()
    print("Public signup and preference writes preserved suppression, list scope and concurrent profile changes.")


if __name__ == "__main__":
    main()
