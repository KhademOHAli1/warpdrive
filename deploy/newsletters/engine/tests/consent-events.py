#!/usr/bin/env python3
"""Prove durable exact-grant revocation feed and tombstones on a disposable engine."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import tempfile
from uuid import uuid4

from consent import Fixture, assert_equal, wait_until

API = "/api/warpdrive/crm-identity"


def api(fixture, path, body=None, expected=200, auth=True):
    headers = {**(fixture.auth if auth else {}), "Content-Type": "application/json"}
    data = None if body is None else json.dumps(body).encode()
    status, raw = fixture.request(API + path, headers, data)
    assert_equal(status, expected, "private consent event endpoint")
    return json.loads(raw)["data"] if status == 200 else None


def seed(fixture, index):
    binding, grant, subscriber_uuid = str(uuid4()), str(uuid4()), str(uuid4())
    list_id, subscriber_id = 800 + index, 900 + index
    email = f"revocation-{index}@example.test"
    fixture.sql(f"""
      INSERT INTO lists(id,uuid,name,type,optin) VALUES({list_id},'{uuid4()}','Synthetic purpose','private','double');
      INSERT INTO subscribers(id,uuid,email,name,status) VALUES({subscriber_id},'{subscriber_uuid}','{email}','Synthetic','enabled');
      INSERT INTO subscriber_lists(subscriber_id,list_id,status) VALUES({subscriber_id},{list_id},'confirmed');
      INSERT INTO warpdrive_crm_identity_challenges(challenge_uuid,binding_uuid,purpose,subscriber_id,subscriber_uuid,email,token_digest,expires_at,verified_at)
      VALUES('{binding}','{binding}','identity',{subscriber_id},'{subscriber_uuid}','{email}',decode(repeat('ab',32),'hex'),clock_timestamp()+interval '1 hour',clock_timestamp());
      INSERT INTO warpdrive_crm_consent_grants(grant_uuid,binding_uuid,subscriber_id,subscriber_uuid,email,purpose_list_id,granted_at)
      VALUES('{grant}','{binding}',{subscriber_id},'{subscriber_uuid}','{email}',{list_id},clock_timestamp());
    """)
    digest = sha256(f"{binding}:{grant}:{subscriber_id}:{subscriber_uuid}:{list_id}".encode()).hexdigest()
    return {"bindingUuid": binding, "grantUuid": grant, "subscriberId": subscriber_id,
            "subscriberUuid": subscriber_uuid, "purposeListId": list_id, "scopeDigest": digest, "email": email}


def check_event(fixture, record):
    rows = api(fixture, "/revocations")
    assert_equal(len(rows), 1, "one first-revocation event")
    event = rows[0]
    for key in ("bindingUuid", "grantUuid", "purposeListId", "scopeDigest"):
        assert_equal(event[key], record[key], "exact consent event scope")
    assert event["id"] != record["grantUuid"], "revocation must not collide with confirmation event"
    assert record["email"] not in json.dumps(event), "mailbox leaked into event"
    assert record["subscriberUuid"] not in json.dumps(event), "subscriber identity leaked into event"
    assert_equal(api(fixture, "/revocations"), rows, "unacknowledged replay")
    api(fixture, "/revocations/ack", {"ids": [event["id"]]})
    api(fixture, "/revocations/ack", {"ids": [event["id"]]})
    assert_equal(api(fixture, "/revocations"), [], "idempotent acknowledgement")
    return event


def restart(fixture):
    fixture.serve.terminate()
    fixture.serve.wait(timeout=5)
    fixture.serve = subprocess.Popen(
        [str(fixture.engine), "--config", "", "--passive"], cwd=fixture.root, env=fixture.env,
        stdout=fixture.log, stderr=subprocess.STDOUT)
    wait_until(fixture.healthy, "restarted engine")


def prove(fixture):
    api(fixture, "/revocations", expected=403, auth=False)
    def schema_status():
        status, raw = fixture.request("/api/warpdrive/readiness", fixture.auth)
        assert_equal(status, 200, "private readiness")
        return json.loads(raw)["data"]["database"]["status"]
    assert_equal(schema_status(), "ready", "consent outbox readiness")
    for kind, name in (("INDEX", "warpdrive_crm_consent_events_pending_idx"), ("TABLE", "warpdrive_crm_consent_events")):
        fixture.sql(f"ALTER {kind} {name} RENAME TO synthetic_hidden")
        assert_equal(schema_status(), "migration_required", "missing consent schema gate")
        fixture.sql(f"ALTER {kind} synthetic_hidden RENAME TO {name}")
        assert_equal(schema_status(), "ready", "restored consent schema gate")
    api(fixture, "/revocations/ack", {"ids": []}, expected=400)
    api(fixture, "/revocations/ack", {"ids": ["invalid"]}, expected=400)
    actions = [
        lambda row: f"UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id={row['subscriberId']}",
        lambda row: f"DELETE FROM subscriber_lists WHERE subscriber_id={row['subscriberId']}",
        lambda row: f"UPDATE subscribers SET status='blocklisted' WHERE id={row['subscriberId']}",
        lambda row: f"UPDATE lists SET status='archived' WHERE id={row['purposeListId']}",
        lambda row: f"UPDATE subscribers SET email='replacement@example.test' WHERE id={row['subscriberId']}",
        lambda row: f"""BEGIN; INSERT INTO bounces(subscriber_id,type,source) VALUES({row['subscriberId']},'hard','ses');
            UPDATE subscribers SET status='blocklisted' WHERE id={row['subscriberId']}; COMMIT""",
        lambda row: f"""BEGIN; INSERT INTO bounces(subscriber_id,type,source) VALUES({row['subscriberId']},'complaint','ses');
            UPDATE subscribers SET status='blocklisted' WHERE id={row['subscriberId']}; COMMIT""",
    ]
    for index, action in enumerate(actions, start=1):
        record = seed(fixture, index)
        fixture.sql(action(record))
        check_event(fixture, record)
        fixture.sql(f"UPDATE warpdrive_crm_consent_grants SET revoked_at=clock_timestamp() WHERE grant_uuid='{record['grantUuid']}'")
        assert_equal(api(fixture, "/revocations"), [], "later writes cannot emit the grant twice")

    detached = seed(fixture, 20)
    api(fixture, f"/bindings/{detached['bindingUuid']}/revoke", {})
    check_event(fixture, detached)
    erased = seed(fixture, 21)
    erasure = {"id": str(uuid4()), "bindingId": erased["bindingUuid"]}
    api(fixture, "/erasures", erasure)
    event = check_event(fixture, erased)
    assert_equal(fixture.sql(f"SELECT count(*) FROM warpdrive_crm_consent_grants WHERE grant_uuid='{erased['grantUuid']}'"), "0", "erased raw grant")
    tombstone = fixture.sql(f"SELECT row_to_json(event) FROM warpdrive_crm_consent_events event WHERE event_uuid='{event['id']}'")
    assert erased["email"] not in tombstone and erased["subscriberUuid"] not in tombstone, "erasure retained raw identity"

    historical = seed(fixture, 22)
    fixture.sql(f"""
      DROP TRIGGER warpdrive_crm_record_revocation ON warpdrive_crm_consent_grants;
      UPDATE warpdrive_crm_consent_grants SET revoked_at='2026-11-01T12:00:00Z' WHERE grant_uuid='{historical['grantUuid']}';
    """)
    restart(fixture)
    historical_event = api(fixture, "/revocations")
    assert_equal(len(historical_event), 1, "075 upgrade backfill")
    assert_equal(datetime.fromisoformat(historical_event[0]["occurredAt"]), datetime(2026, 11, 1, 12, tzinfo=timezone.utc), "original revocation occurrence")
    restart(fixture)
    assert_equal(api(fixture, "/revocations"), historical_event, "restart backfill is idempotent")
    check_event(fixture, historical)
    restart(fixture)
    assert_equal(api(fixture, "/revocations"), [], "ack survives restart")
    print("Consent event proof passed: exact-grant revocation, source paths, tombstones, replay, backfill and restart.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, default=Path("/opt/homebrew/opt/postgresql@18/bin"))
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="lm-consent-events-", dir="/tmp") as folder:
        fixture = Fixture(Path(folder), args.engine.resolve(), args.pg_bin)
        try:
            fixture.start()
            prove(fixture)
        finally:
            fixture.stop()
