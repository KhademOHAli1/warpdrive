#!/usr/bin/env python3
"""Exercise the private operational outbox against a disposable passive engine."""

import argparse
import base64
import concurrent.futures
from datetime import datetime
import json
from pathlib import Path
import select
import subprocess
import sys
import tempfile
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from consent import Fixture, assert_equal, wait_until

API = "/api/warpdrive/operational-events"


def api(fixture, path=API, body=None, expected=200, auth=None, method=None, raw=None):
    headers = {**(fixture.auth if auth is None else auth), "Content-Type": "application/json"}
    payload = raw if raw is not None else None if body is None else json.dumps(body).encode()
    status, content = fixture.request(path, headers, payload, method)
    assert_equal(status, expected, "operational API response")
    return json.loads(content)["data"] if status == 200 else None


def restart(fixture):
    fixture.serve.terminate()
    fixture.serve.wait(timeout=5)
    fixture.serve = subprocess.Popen(
        [str(fixture.engine), "--config", "", "--passive"], cwd=fixture.root,
        env=fixture.env, stdout=fixture.log, stderr=subprocess.STDOUT,
    )
    wait_until(fixture.healthy, "restarted passive engine")


def seed(fixture, label):
    delivery, subscriber_uuid = str(uuid4()), str(uuid4())
    campaign = int(fixture.sql(f"""
      INSERT INTO campaigns(uuid,name,subject,from_email,body,status,messenger)
      VALUES(gen_random_uuid(),'Private canary {label}','Never expose campaign content',
             'sender@example.test','SECRET_CONTENT_CANARY','paused','email') RETURNING id
    """))
    subscriber = int(fixture.sql(f"""
      INSERT INTO subscribers(uuid,email,name,status)
      VALUES('{subscriber_uuid}','privacy-{label}@example.test','PRIVATE_PERSON_CANARY','enabled') RETURNING id
    """))
    fixture.sql(f"""
      INSERT INTO warpdrive_delivery_runs(campaign_id) VALUES({campaign});
      INSERT INTO warpdrive_delivery_recipients(id,campaign_id,subscriber_id,subscriber_uuid,address_digest)
      SELECT '{delivery}',{campaign},id,uuid,sha256(convert_to(email,'UTF8')) FROM subscribers WHERE id={subscriber};
    """)
    return campaign, delivery, subscriber_uuid


def change(fixture, delivery, state):
    fixture.sql(f"""
      UPDATE warpdrive_delivery_recipients SET state='{state}', lease_token=NULL,
          lease_until=NULL, updated_at=clock_timestamp() WHERE id='{delivery}'
    """)


def ack_all(fixture):
    while True:
        page = api(fixture)
        if not page["events"]:
            return
        api(fixture, API + "/ack", {"event_ids": [e["id"] for e in page["events"]]})


def restricted_auth(fixture, name, permissions):
    values = ",".join("'" + value + "'" for value in permissions)
    role = int(fixture.sql(f"INSERT INTO roles(type,name,permissions) VALUES('user','{name}',ARRAY[{values}]::text[]) RETURNING id"))
    user = api(fixture, "/api/users", {
        "username": name, "type": "api", "status": "enabled", "user_role_id": role,
    })
    token = user["password"]
    return {"Authorization": "Basic " + base64.b64encode(f"{name}:{token}".encode()).decode()}


def prove(fixture):
    assert_equal(api(fixture, "/api/warpdrive-capabilities")["operationalEvents"], 1, "operational capability")
    assert_equal(fixture.sql("SELECT count(*) FROM warpdrive_delivery_migrations WHERE version=5"), "1", "schema migration")
    api(fixture, auth={}, expected=403)
    api(fixture, API + "/ack", {"event_ids": [str(uuid4())]}, auth={}, expected=403)
    reader = restricted_auth(fixture, "ops-reader", ["settings:get"])
    denied = restricted_auth(fixture, "ops-denied", [])
    assert_equal(api(fixture, auth=reader), {"events": [], "pending": False}, "scoped read")
    api(fixture, auth=denied, expected=403)
    api(fixture, API + "/ack", {"event_ids": [str(uuid4())]}, auth=reader, expected=403)

    campaign, delivery, subscriber_uuid = seed(fixture, "terminal")
    fixture.sql(f"BEGIN; UPDATE warpdrive_delivery_recipients SET state='rejected' WHERE id='{delivery}'; ROLLBACK")
    assert_equal(api(fixture)["events"], [], "rollback has no event")
    assert_equal(fixture.sql(f"SELECT state FROM warpdrive_delivery_recipients WHERE id='{delivery}'"), "pending", "rollback source unchanged")
    fixture.sql("""
      CREATE FUNCTION reject_ops_fixture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END; $$;
      CREATE TRIGGER reject_ops_fixture BEFORE INSERT ON warpdrive_operational_events
      FOR EACH ROW EXECUTE FUNCTION reject_ops_fixture();
    """)
    try:
        try:
            change(fixture, delivery, "rejected")
        except subprocess.CalledProcessError:
            pass
        else:
            raise AssertionError("outbox failure did not abort source transaction")
        assert_equal(fixture.sql(f"SELECT state FROM warpdrive_delivery_recipients WHERE id='{delivery}'"), "pending", "outbox failure preserves source")
    finally:
        fixture.sql("DROP TRIGGER reject_ops_fixture ON warpdrive_operational_events; DROP FUNCTION reject_ops_fixture()")
    change(fixture, delivery, "rejected")
    first = api(fixture)
    assert_equal([(e["kind"], e["reason"], e["count"]) for e in first["events"]], [("delivery.failed", "delivery_rejected", 1)], "terminal event")
    snapshot = fixture.sql("SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence) FROM warpdrive_operational_events e")
    assert_equal(api(fixture), first, "GET replay")
    assert_equal(fixture.sql("SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence) FROM warpdrive_operational_events e"), snapshot, "GET is pure")
    change(fixture, delivery, "rejected")
    assert_equal(api(fixture), first, "duplicate outcome")
    event = first["events"][0]
    UUID(event["id"])
    datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00"))
    assert set(event) == {"id", "kind", "reason", "count", "occurred_at"}
    raw = json.dumps(first)
    for private in ("@example.test", "CANARY", delivery, subscriber_uuid, "campaign_id", "message_id"):
        assert private not in raw, "private source information leaked"
    restart(fixture)
    assert_equal(api(fixture), first, "lost ACK and restart preserve event UUID")
    for query in ("limit=0", "limit=101", "limit=bad", "limit=1&limit=2", "cursor=1", "limit=%ZZ", "limit=1;bad=1"):
        api(fixture, API + "?" + query, expected=400)
    bad = ({}, {"event_ids": []}, {"event_ids": [event["id"], "invalid"]},
           {"event_ids": [event["id"]] * 101}, {"event_ids": [event["id"]], "extra": True})
    for payload in bad:
        api(fixture, API + "/ack", payload, expected=400)
    api(fixture, API + "/ack", raw=(json.dumps({"event_ids": [event["id"]]}) + "{}").encode(), expected=400)
    api(fixture, API + "/ack", raw=(f'{{"event_ids":["invalid"],"event_ids":["{event["id"]}"]}}').encode(), expected=400)
    assert_equal(api(fixture), first, "invalid ACK is atomic")
    request = {"event_ids": [event["id"], event["id"], str(uuid4())]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: api(fixture, API + "/ack", request), range(2)))
    assert_equal(results, [{"acknowledged": 1}, {"acknowledged": 1}], "concurrent deduplicated ACK")
    acknowledged = fixture.sql(f"SELECT acknowledged_at FROM warpdrive_operational_events WHERE id='{event['id']}'")
    assert_equal(api(fixture, API + "/ack", request), {"acknowledged": 1}, "lost ACK response replay")
    assert_equal(fixture.sql(f"SELECT acknowledged_at FROM warpdrive_operational_events WHERE id='{event['id']}'"), acknowledged, "ACK replay timestamp unchanged")
    restart(fixture)
    assert_equal(api(fixture)["events"], [], "ACK survives restart")

    accepted_campaign, accepted, _ = seed(fixture, "accepted")
    change(fixture, accepted, "accepted")
    assert_equal(api(fixture)["events"], [], "ordinary acceptance emits no resolution")
    uncertain_campaign, uncertain, _ = seed(fixture, "unknown")
    change(fixture, uncertain, "unknown")
    api(fixture, f"/api/warpdrive-delivery/{uncertain_campaign}/resolve", {"delivery_id": uncertain, "outcome": "accepted"})
    assert_equal([(e["kind"], e["reason"]) for e in api(fixture)["events"]], [
        ("delivery.uncertain", "submission_unknown"), ("delivery.resolved", "operator_accepted")], "operator resolution")
    assert_equal(fixture.sql(f"SELECT smtp_accepted_at IS NULL FROM warpdrive_delivery_recipients WHERE id='{uncertain}'"), "t", "operator review invents no SMTP provenance")
    ack_all(fixture)

    expired_campaign, expired, _ = seed(fixture, "expired")
    fixture.sql(f"""
      UPDATE warpdrive_delivery_recipients SET state='submitting', lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()-interval '2 minutes', message_id='<PRIVATE_MESSAGE_CANARY>', attempts=1
      WHERE id='{expired}';
    """)
    before = fixture.sql(f"SELECT row_to_json(d) FROM warpdrive_delivery_recipients d WHERE id='{expired}'")
    restart(fixture)
    wait_until(lambda: len(api(fixture)["events"]) == 1, "expired submission event")
    assert_equal(fixture.sql(f"SELECT row_to_json(d) FROM warpdrive_delivery_recipients d WHERE id='{expired}'"), before, "passive sweep preserves every receipt field")
    assert_equal(fixture.sql(f"SELECT status FROM campaigns WHERE id={expired_campaign}"), "paused", "passive campaign unchanged")
    api(fixture, f"/api/warpdrive-delivery/{expired_campaign}/resolve", {"delivery_id": expired, "outcome": "rejected"})
    assert_equal([(e["kind"], e["reason"]) for e in api(fixture)["events"]], [
        ("delivery.uncertain", "submission_unknown"), ("delivery.resolved", "operator_rejected")], "expired review resolution")
    restart(fixture)
    assert_equal(len(api(fixture)["events"]), 2, "resolved rejected receipt does not create another failure")
    ack_all(fixture)

    race_campaign, race_delivery, _ = seed(fixture, "acceptance-race")
    fixture.sql(f"""
      UPDATE warpdrive_delivery_recipients SET state='submitting', lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()-interval '2 minutes', message_id='<race@example.test>', attempts=1
      WHERE id='{race_delivery}';
    """)
    with subprocess.Popen(fixture.psql_args(), cwd=fixture.root, env=fixture.env, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as accepted:
        try:
            accepted.stdin.write(f"""BEGIN;
DO $$ BEGIN
  PERFORM id FROM campaigns WHERE id={race_campaign} FOR UPDATE;
  UPDATE warpdrive_delivery_recipients SET state='accepted', lease_token=NULL,
    lease_until=NULL,smtp_accepted_at=clock_timestamp() WHERE id='{race_delivery}';
END $$;
\\echo accepted_waiting
""")
            accepted.stdin.flush()
            readable, _, _ = select.select([accepted.stdout], [], [], 5)
            assert readable and accepted.stdout.readline().strip() == "accepted_waiting", "acceptance lock not ready"
            restart(fixture)
            assert_equal(api(fixture)["events"], [], "sweep skips locked uncommitted acceptance")
            accepted.stdin.write("COMMIT;\n\\q\n")
            accepted.stdin.flush()
            assert_equal(accepted.wait(timeout=5), 0, "acceptance commit")
        finally:
            if accepted.poll() is None:
                accepted.kill()
                accepted.wait(timeout=5)
    assert_equal([(e["kind"], e["reason"]) for e in api(fixture)["events"]], [
        ("delivery.uncertain", "submission_unknown"), ("delivery.resolved", "provider_accepted")], "acceptance closes uncertainty in source order")
    restart(fixture)
    assert_equal(len(api(fixture)["events"]), 2, "no late uncertainty after acceptance")
    ack_all(fixture)

    sweep_campaign, sweep_delivery, _ = seed(fixture, "sweep-first")
    fixture.sql(f"""
      UPDATE warpdrive_delivery_recipients SET state='submitting', lease_token=gen_random_uuid(),
          lease_until=clock_timestamp()-interval '2 minutes', message_id='<sweep@example.test>', attempts=1
      WHERE id='{sweep_delivery}';
      CREATE FUNCTION hold_ops_sweep_fixture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(85085,1); RETURN NEW; END; $$;
      CREATE TRIGGER hold_ops_sweep_fixture BEFORE INSERT ON warpdrive_operational_events FOR EACH ROW
      WHEN (NEW.event_key=digest('delivery:{sweep_delivery}:delivery.uncertain','sha256'))
      EXECUTE FUNCTION hold_ops_sweep_fixture();
    """)
    with subprocess.Popen(fixture.psql_args(), cwd=fixture.root, env=fixture.env, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as guard:
        try:
            guard.stdin.write("DO $$ BEGIN PERFORM pg_advisory_lock(85085,1); END $$;\n\\echo sweep_guard\n")
            guard.stdin.flush()
            readable, _, _ = select.select([guard.stdout], [], [], 5)
            assert readable and guard.stdout.readline().strip() == "sweep_guard", "sweep guard unavailable"
            restart(fixture)
            wait_until(lambda: fixture.sql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%SELECT warpdrive_enqueue_operational(%')") == "t", "sweep holds campaign before enqueue")
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                accepted = executor.submit(fixture.sql, f"""/*ops_accept_after_sweep*/ BEGIN;
                  SELECT id FROM campaigns WHERE id={sweep_campaign} FOR UPDATE;
                  UPDATE warpdrive_delivery_recipients SET state='accepted',lease_token=NULL,
                    lease_until=NULL,smtp_accepted_at=clock_timestamp() WHERE id='{sweep_delivery}'; COMMIT;
                """)
                try:
                    wait_until(lambda: fixture.sql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ops_accept_after_sweep%')") == "t", "acceptance waits for sweep campaign lock")
                finally:
                    guard.stdin.write("SELECT pg_advisory_unlock(85085,1);\n\\q\n")
                    guard.stdin.flush()
                accepted.result(timeout=5)
            assert_equal(guard.wait(timeout=5), 0, "sweep guard released")
        finally:
            if guard.poll() is None:
                guard.kill()
                guard.wait(timeout=5)
            fixture.sql("DROP TRIGGER hold_ops_sweep_fixture ON warpdrive_operational_events; DROP FUNCTION hold_ops_sweep_fixture()")
    assert_equal([(e["kind"], e["reason"]) for e in api(fixture)["events"]], [
        ("delivery.uncertain", "submission_unknown"), ("delivery.resolved", "provider_accepted")], "sweep-first issue resolves after accepted commit")
    ack_all(fixture)

    # An earlier sequence commits after a later page was committed/ACKed.
    with subprocess.Popen(fixture.psql_args(), cwd=fixture.root, env=fixture.env, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as late:
        try:
            late.stdin.write("BEGIN;\nDO $$ BEGIN PERFORM warpdrive_enqueue_operational('late-commit','delivery.failed','delivery_rejected','2020-01-01'); END $$;\n\\echo waiting\n")
            late.stdin.flush()
            readable, _, _ = select.select([late.stdout], [], [], 5)
            assert readable and late.stdout.readline().strip() == "waiting", "late source transaction not ready"
            fixture.sql("SELECT warpdrive_enqueue_operational('early-commit','delivery.failed','delivery_rejected','2026-11-11')")
            early = api(fixture)
            assert_equal(len(early["events"]), 1, "uncommitted earlier event remains invisible")
            ack_all(fixture)
            late.stdin.write("COMMIT;\n\\q\n")
            late.stdin.flush()
            assert_equal(late.wait(timeout=5), 0, "late commit")
        finally:
            if late.poll() is None:
                late.kill()
                late.wait(timeout=5)
    assert_equal(len(api(fixture)["events"]), 1, "earlier sequence/timestamp not lost")
    fixture.sql("SELECT warpdrive_enqueue_operational('page-two','delivery.failed','delivery_rejected',clock_timestamp())")
    page = api(fixture, API + "?limit=1")
    assert_equal((len(page["events"]), page["pending"]), (1, True), "bounded page indicates more")
    ack_all(fixture)
    assert_equal(api(fixture), {"events": [], "pending": False}, "complete drain")
    print("Operational outbox proof passed: RBAC, pure reads, atomic outcomes, privacy, replay/restart, passive expiry, resolution and late commit ordering.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="lm-operations085-", dir="/tmp") as folder:
        fixture = Fixture(Path(folder), args.engine.resolve(strict=True), args.pg_bin.resolve(strict=True))
        try:
            fixture.start()
            prove(fixture)
        finally:
            fixture.stop()
