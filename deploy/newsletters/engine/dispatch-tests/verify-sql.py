#!/usr/bin/env python3
"""Exercise the patched named SQL on disposable fixtures rolled back in one connection."""
import argparse
import re
import subprocess
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("engine", type=Path, help="Pinned Listmonk checkout with Warpdrive patches applied")
parser.add_argument("--psql", default="psql")
args = parser.parse_args()

schema_name = "dispatch_test_" + uuid.uuid4().hex
schema = (args.engine / "schema.sql").read_text()
# Start with an empty transaction-owned schema. Omit upstream destructive reset statements.
schema = re.sub(r"\bDROP (?:TYPE|TABLE|INDEX|MATERIALIZED VIEW) IF EXISTS [^;]*;", "", schema)
schema = re.sub(r"CREATE EXTENSION IF NOT EXISTS [^;]*;", "", schema)
queries = {}
for file in ("campaigns", "lists", "subscribers"):
    sql = (args.engine / "queries" / f"{file}.sql").read_text()
    parts = re.split(r"^-- name: ([\w-]+)\s*$", sql, flags=re.MULTILINE)
    queries.update(zip(parts[1::2], parts[2::2]))

prepared = {
    "claim": "next-campaigns",
    "running": "get-running-campaign",
    "batch": "next-campaign-subscribers",
    "eligible": "campaign-recipient-eligible",
    "test_eligible": "campaign-test-recipient-eligible",
    "edit": "update-campaign",
    "change_status": "update-campaign-status-if-current",
    "delete_one": "delete-campaign",
    "delete_many": "delete-campaigns",
    "lock_lists": "lock-lists-for-deletion",
    "has_references": "campaign-references-lists",
    "unsubscribe": "unsubscribe-by-campaign",
}

sql = f"""
BEGIN;
SET LOCAL statement_timeout = '10s';
CREATE SCHEMA {schema_name};
SET LOCAL search_path TO {schema_name}, pg_catalog;
{schema}
"""
sql += "\n".join(f"PREPARE {key} AS {queries[name]}" for key, name in prepared.items())
sql += r"""
CREATE FUNCTION require(condition BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%', message; END IF;
END
$$;
INSERT INTO lists (id, uuid, name, type, optin)
VALUES (1, gen_random_uuid(), 'Active double', 'private', 'double'),
       (2, gen_random_uuid(), 'Archive before due', 'private', 'single'),
       (3, gen_random_uuid(), 'Active single', 'private', 'single'),
       (4, gen_random_uuid(), 'Unreferenced', 'private', 'single');

INSERT INTO subscribers (id, uuid, email, name, status)
SELECT id, gen_random_uuid(), 'fixture-' || id || '@example.test', 'Synthetic', status::subscriber_status
FROM (VALUES (1,'enabled'), (2,'enabled'), (3,'disabled'), (4,'blocklisted'),
             (5,'enabled'), (6,'enabled'), (7,'enabled')) s(id,status);

INSERT INTO subscriber_lists (subscriber_id, list_id, status)
VALUES (1,1,'confirmed'), (2,1,'unconfirmed'), (3,1,'confirmed'),
       (4,1,'confirmed'), (5,3,'unsubscribed'), (6,2,'confirmed'), (7,3,'unconfirmed');

INSERT INTO campaigns (id, uuid, name, subject, from_email, body, messenger, status, send_at, type)
VALUES (1, gen_random_uuid(), 'Due', 'Due', 'sender@example.test', 'Body', 'email', 'scheduled', NOW() - interval '1 minute', 'regular'),
       (2, gen_random_uuid(), 'Optin', 'Optin', 'sender@example.test', 'Body', 'email', 'scheduled', NOW() - interval '1 minute', 'optin'),
       (3, gen_random_uuid(), 'Future', 'Future', 'sender@example.test', 'Body', 'email', 'scheduled', NOW() + interval '1 hour', 'regular'),
       (4, gen_random_uuid(), 'Draft', 'Draft', 'sender@example.test', 'Body', 'email', 'draft', NULL, 'regular');
INSERT INTO campaign_lists (campaign_id, list_id, list_name)
SELECT c.id, l.id, l.name FROM campaigns c CROSS JOIN lists l WHERE c.id IN (1,2,3) AND l.id IN (1,2,3);

UPDATE lists SET status='archived' WHERE id=2;
EXECUTE claim('{}','{}');
SELECT require((SELECT to_send=2 AND max_subscriber_id=7 AND started_at IS NOT NULL AND status='running' FROM campaigns WHERE id=1), 'scheduled claim must count only active, enabled, consented recipients');
SELECT require((SELECT to_send=1 AND max_subscriber_id=2 AND status='running' FROM campaigns WHERE id=2), 'opt-in campaign must select only active double opt-in pending recipients');
SELECT require((SELECT status='scheduled' AND started_at IS NULL FROM campaigns WHERE id=3), 'future scheduled campaign started before due time');

EXECUTE running(1);
EXECUTE batch(1,'regular',0,7,ARRAY[1,2,3],1);
SELECT require((SELECT last_subscriber_id=1 FROM campaigns WHERE id=1), 'first eligible recipient checkpoint incorrect');
UPDATE subscriber_lists SET status='unsubscribed' WHERE subscriber_id=1 AND list_id=1;
SELECT uuid AS recipient_uuid, email AS recipient_email FROM subscribers WHERE id=1 \gset
EXECUTE eligible(1,1,:'recipient_email',:'recipient_uuid') \gset
SELECT require(NOT :'exists'::BOOLEAN, 'revoked consent after batching was admitted');

EXECUTE batch(1,'regular',1,7,ARRAY[1,2,3],25);
SELECT require((SELECT last_subscriber_id=7 FROM campaigns WHERE id=1), 'second eligible recipient checkpoint incorrect');
SELECT uuid AS recipient_uuid, email AS recipient_email FROM subscribers WHERE id=7 \gset
EXECUTE eligible(1,7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(:'exists'::BOOLEAN, 'active single-opt-in recipient was denied');
UPDATE subscribers SET email='replacement@example.test' WHERE id=7;
EXECUTE eligible(1,7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(NOT :'exists'::BOOLEAN, 'stale queued address was admitted');
EXECUTE test_eligible(7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(NOT :'exists'::BOOLEAN, 'test admitted stale queued address');
UPDATE subscribers SET email=:'recipient_email' WHERE id=7;
EXECUTE test_eligible(7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(:'exists'::BOOLEAN, 'test denied live enabled recipient');
UPDATE subscribers SET status='disabled' WHERE id=7;
EXECUTE test_eligible(7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(NOT :'exists'::BOOLEAN, 'test admitted disabled recipient');
UPDATE subscribers SET status='enabled' WHERE id=7;

SELECT updated_at AS previous_version FROM campaigns WHERE id=1 \gset
UPDATE campaigns SET updated_at=NOW() + interval '1 second' WHERE id=1;
EXECUTE change_status(1,'paused','running',:'previous_version',false);
SELECT require((SELECT status='running' FROM campaigns WHERE id=1), 'explicit stale stop revision changed live campaign');
EXECUTE change_status(1,'paused','running',:'previous_version',true);
SELECT require((SELECT status='paused' FROM campaigns WHERE id=1), 'unversioned emergency pause lost to batch progress');
EXECUTE change_status(1,'cancelled','running',:'previous_version',true);
SELECT require((SELECT status='paused' FROM campaigns WHERE id=1), 'unversioned emergency stop bypassed current status');
EXECUTE eligible(1,7,:'recipient_email',:'recipient_uuid') \gset
SELECT require(NOT :'exists'::BOOLEAN, 'paused campaign recipient was admitted');

SELECT updated_at AS reviewed_version FROM campaigns WHERE id=1 \gset
UPDATE campaigns SET updated_at=NOW() + interval '2 seconds' WHERE id=1;
EXECUTE change_status(1,'running','paused',:'reviewed_version',false);
SELECT require((SELECT status='paused' FROM campaigns WHERE id=1), 'stale reviewed revision launched a newer campaign');
EXECUTE edit(1,'Stale content edit','Subject','sender@example.test','Body',NULL,'html',NULL,'[]','{}','{}','email',NULL,ARRAY[3,2,1],false,NULL,NULL,'{}','{}',NULL,:'reviewed_version');
SELECT require((SELECT name='Due' FROM campaigns WHERE id=1), 'stale reviewed revision overwrote a newer campaign');
SELECT updated_at AS current_version FROM campaigns WHERE id=1 \gset
EXECUTE edit(1,'Changed audience','Subject','sender@example.test','Body',NULL,'html',NULL,'[]','{}','{}','email',NULL,ARRAY[3],false,NULL,NULL,'{}','{}',NULL,:'current_version');
SELECT require((SELECT name='Due' FROM campaigns WHERE id=1), 'post-dispatch audience change was accepted');
EXECUTE edit(1,'Allowed content edit','Subject','sender@example.test','New body',NULL,'html',NULL,'[]','{}','{}','email',NULL,ARRAY[3,2,1],false,NULL,NULL,'{}','{}',NULL,:'current_version');
SELECT require((SELECT name='Allowed content edit' FROM campaigns WHERE id=1), 'equivalent retained audience blocked paused content edit');
SELECT require((SELECT ARRAY_AGG(list_id ORDER BY list_id)=ARRAY[1,2,3] FROM campaign_lists WHERE campaign_id=1), 'historical audience associations changed');
EXECUTE delete_one(1);
EXECUTE delete_many(ARRAY[1,3,4], '', true, '{}');
SELECT require(EXISTS(SELECT 1 FROM campaigns WHERE id=1), 'started campaign was deleted');
SELECT require(EXISTS(SELECT 1 FROM campaigns WHERE id=3), 'pending scheduled campaign was deleted');
SELECT require(NOT EXISTS(SELECT 1 FROM campaigns WHERE id=4), 'unused draft was not deleted');

EXECUTE lock_lists(ARRAY[1], '', true, '{}');
EXECUTE has_references(ARRAY[1]) \gset
SELECT require(:'exists'::BOOLEAN, 'referenced-list guard missed original list');
EXECUTE has_references(ARRAY[4]) \gset
SELECT require(NOT :'exists'::BOOLEAN, 'referenced-list guard blocked unreferenced list');
SELECT uuid AS mailed_campaign_uuid FROM campaigns WHERE id=1 \gset
EXECUTE unsubscribe(:'mailed_campaign_uuid', :'recipient_uuid', false);
SELECT require((SELECT status='unsubscribed' FROM subscriber_lists WHERE subscriber_id=7 AND list_id=3), 'historical campaign link no longer unsubscribes original membership');
ROLLBACK;
"""
subprocess.run(
    [args.psql, "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
    input=sql, text=True, stdout=subprocess.DEVNULL, timeout=30, check=True,
)
print("Passed consent selection, final admission, test address identity, stale status, and historical-link retention")
