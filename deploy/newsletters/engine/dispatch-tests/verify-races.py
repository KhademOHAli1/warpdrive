#!/usr/bin/env python3
"""Test the engine's row-lock and fresh snapshot boundaries on a disposable PostgreSQL schema."""
import argparse
import os
from pathlib import Path
import re
import select
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("engine", type=Path)
parser.add_argument("--psql", default="psql")
args = parser.parse_args()

schema_name = "dispatch_race_" + uuid.uuid4().hex
settings = f"SET search_path TO {schema_name}, pg_catalog; SET statement_timeout = '8s';"
psql = [args.psql, "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"]
sessions = []


def execute(sql):
    return subprocess.check_output(
        psql, input=sql, text=True, timeout=12, stderr=subprocess.PIPE
    ).strip()


def statement(file, name):
    sql = (args.engine / "queries" / f"{file}.sql").read_text()
    parts = re.split(r"^-- name: ([\w-]+)\s*$", sql, flags=re.MULTILINE)
    return dict(zip(parts[1::2], parts[2::2]))[name]


def session():
    label = "dispatch-fixture-" + uuid.uuid4().hex
    proc = subprocess.Popen(
        psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PGAPPNAME": label},
    )
    sessions.append(proc)
    send(proc, settings)
    return proc, label


def send(proc, sql):
    proc.stdin.write((sql + "\n").encode())
    proc.stdin.flush()


def read_until(proc, marker):
    deadline = time.monotonic() + 9
    buffer = b""
    while time.monotonic() < deadline:
        ready, _, _ = select.select([proc.stdout], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        chunk = os.read(proc.stdout.fileno(), 4096)
        if not chunk:
            raise AssertionError(proc.stderr.read().decode())
        buffer += chunk
        if marker.encode() + b"\n" in buffer:
            return buffer.decode().splitlines()
    raise AssertionError(f"Timed out waiting for {marker}")


def wait_for_pg_lock(label):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        waiting = execute(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity "
            f"WHERE application_name = '{label}' AND wait_event_type = 'Lock');"
        )
        if waiting == "t":
            return
        time.sleep(0.03)
    raise AssertionError("Expected a genuine PostgreSQL row-lock wait")


schema = (args.engine / "schema.sql").read_text()
schema = re.sub(r"\bDROP (?:TYPE|TABLE|INDEX|MATERIALIZED VIEW) IF EXISTS [^;]*;", "", schema)
schema = re.sub(r"CREATE EXTENSION IF NOT EXISTS [^;]*;", "", schema)
try:
    execute(f"CREATE SCHEMA {schema_name}; {settings}\n{schema}")
    execute(
        settings
        + """
INSERT INTO lists(id, uuid, name, type) VALUES (1, gen_random_uuid(), 'Fixture', 'private');
INSERT INTO campaigns(id, uuid, name, subject, from_email, body, messenger, status, send_at)
VALUES (1, gen_random_uuid(), 'Due', 'Due', 'sender@example.test', '', 'email', 'scheduled', NOW() - interval '1 minute');
"""
    )

    # The scheduler cannot claim a row locked by a concurrent operator transition.
    owner, _ = session()
    send(owner, "BEGIN; SELECT id FROM campaigns WHERE id = 1 FOR UPDATE;\n\\echo CAMPAIGN_LOCKED")
    read_until(owner, "CAMPAIGN_LOCKED")
    claim = statement("campaigns", "next-campaigns")
    assert execute(settings + f"PREPARE claim AS {claim}\nEXECUTE claim('{{}}','{{}}');") == ""
    send(owner, "UPDATE campaigns SET status='draft' WHERE id=1; COMMIT;\n\\echo UNSCHEDULED")
    read_until(owner, "UNSCHEDULED")
    assert execute(settings + f"PREPARE claim AS {claim}\nEXECUTE claim('{{}}','{{}}');") == ""

    # A new association owns a foreign-key key-share lock before it commits.
    # The list deletion path must wait, then see that association in a fresh statement.
    send(
        owner,
        "BEGIN; INSERT INTO campaign_lists(campaign_id,list_id,list_name) VALUES (1,1,'Fixture');\n"
        "\\echo ASSOCIATION_WRITTEN",
    )
    read_until(owner, "ASSOCIATION_WRITTEN")
    deleter, app = session()
    lock = statement("lists", "lock-lists-for-deletion")
    refs = statement("lists", "campaign-references-lists")
    send(
        deleter,
        f"PREPARE lock_list AS {lock}\nPREPARE has_refs AS {refs}\n"
        "BEGIN; EXECUTE lock_list(ARRAY[1], '', true, '{}');\n\\echo LIST_LOCKED",
    )
    wait_for_pg_lock(app)
    send(owner, "COMMIT;\n\\echo ASSOCIATION_COMMITTED")
    read_until(owner, "ASSOCIATION_COMMITTED")
    read_until(deleter, "LIST_LOCKED")
    send(deleter, "EXECUTE has_refs(ARRAY[1]); ROLLBACK;\n\\echo CHECKED")
    assert "t" in read_until(deleter, "CHECKED")
    assert execute(settings + "SELECT count(*) FROM lists WHERE id=1;") == "1"
finally:
    for proc in sessions:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=4)
    execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE;")

print("Passed scheduler-versus-operator claim and concurrent list-retention row locks")
