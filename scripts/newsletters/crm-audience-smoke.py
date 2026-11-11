#!/usr/bin/env python3
"""Verify that a sealed CRM audience never expands after approval."""

import argparse
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import runpy
import tempfile
from uuid import uuid4

smoke = runpy.run_path(str(Path(__file__).with_name("engine-smoke.py")))


def insert_grant(sql, subscriber, uid, address, list_id):
    grant = str(uuid4())
    sql(
        "INSERT INTO warpdrive_crm_consent_grants "
        "(grant_uuid,binding_uuid,subscriber_id,subscriber_uuid,email,purpose_list_id,granted_at) "
        f"VALUES ('{grant}','{uuid4()}',{subscriber},'{uid}','{address}',{list_id},clock_timestamp())"
    )
    return grant


def exercise(sql, origin, token, pit):
    api = smoke["engine_api"]
    selected, _ = smoke["create_list"](sql, "Approved CRM purpose")
    other, _ = smoke["create_list"](sql, "Other newsletter purpose")
    eligible, eligible_uid, eligible_address = smoke["subscriber"](
        sql, "verified", "enabled", [(selected, "confirmed")]
    )
    revoked, revoked_uid, revoked_address = smoke["subscriber"](
        sql, "new-grant", "enabled", [(selected, "confirmed")]
    )
    smoke["subscriber"](sql, "regular-member", "enabled", [(selected, "confirmed")])
    eligible_grant = insert_grant(sql, eligible, eligible_uid, eligible_address, selected)
    revoked_grant = insert_grant(sql, revoked, revoked_uid, revoked_address, selected)

    subject = "Synthetic approved CRM audience"
    draft = api(origin, token, "/api/campaigns", "POST", {
        "name": subject, "subject": subject, "type": "regular",
        "body": "<p>Synthetic approved audience</p>", "content_type": "html",
        "lists": [other],
    })
    campaign_path = f"/api/campaigns/{draft['id']}"
    seal_path = f"/api/warpdrive/audiences/{draft['id']}"
    assert api(origin, token, seal_path) is None
    intent = {
        "manifest_uuid": str(uuid4()),
        "purpose_list_id": selected,
        "scope_digest": sha256(b"synthetic review").hexdigest(),
        "expected_updated_at": draft["updated_at"],
        "members": [
            {"subscriber_uuid": eligible_uid, "grant_uuid": eligible_grant},
            {"subscriber_uuid": revoked_uid, "grant_uuid": revoked_grant},
        ],
    }
    api(origin, token, seal_path, "PUT", {
        **intent, "members": [{"subscriber_uuid": eligible_uid, "grant_uuid": str(uuid4())}],
    }, expected=(409,))
    assert api(origin, token, seal_path) is None, "Incomplete seal left a manifest"
    sealed = api(origin, token, seal_path, "PUT", intent)
    assert sealed["size"] == 2
    assert api(origin, token, seal_path, "PUT", intent) == sealed
    current = api(origin, token, campaign_path)
    assert [row["id"] for row in current["lists"]] == [selected]
    api(origin, token, campaign_path, "PUT", {
        "expected_updated_at": current["updated_at"], "lists": [selected, other],
        "subject": subject, "name": subject,
    }, expected=(409,))

    sql(f"UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id={revoked} AND list_id={selected}")
    assert sql(
        f"SELECT revoked_at IS NOT NULL FROM warpdrive_crm_consent_grants WHERE grant_uuid='{revoked_grant}'"
    ) == "t", "Opt-out did not revoke the approved grant"
    sql(f"UPDATE subscriber_lists SET status='confirmed' WHERE subscriber_id={revoked} AND list_id={selected}")
    insert_grant(sql, revoked, revoked_uid, revoked_address, selected)

    due = (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()
    current = api(origin, token, campaign_path, "PUT", {
        "expected_updated_at": current["updated_at"],
        "name": subject, "subject": subject, "lists": [selected], "send_at": due,
    })
    api(origin, token, campaign_path + "/status", "PUT", {
        "status": "scheduled", "expected_updated_at": current["updated_at"],
    })

    smoke["wait_for"](
        "approved campaign completion",
        lambda: api(origin, token, campaign_path)["status"] == "finished",
        timeout=65,
    )
    _, raw = smoke["http"](pit, "/api/v1/messages")
    messages = [m for m in json.loads(raw)["messages"] if m["Subject"] == subject]
    assert len(messages) == 1
    assert [row["Address"] for row in messages[0]["To"]] == [eligible_address]
    print("Sealing was atomic and idempotent; only the original current grant reached SMTP")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--mailpit", type=Path, required=True)
    parser.add_argument("--postgres-bin", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-crm-audience-") as directory, ExitStack() as stack:
        fixture = smoke["smtp_fixture"](
            args.engine.resolve(), args.mailpit.resolve(), args.postgres_bin.resolve(), Path(directory), stack
        )
        exercise(*fixture)


if __name__ == "__main__":
    main()
