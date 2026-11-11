#!/usr/bin/env python3
"""Qualify ordinary campaign links, analytics, archive preview, clone and selected deletion."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import runpy
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request

smoke = runpy.run_path(str(Path(__file__).with_name("engine-smoke.py")))
DUMMY_UUID = "00000000-0000-0000-0000-000000000000"
TARGET = "https://example.test/campaign-parity"
SUBJECT = "Synthetic campaign parity"
RECIPIENT = "campaign-parity-recipient"
ARCHIVE_READER = "Synthetic archive reader"


class URLs(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.values = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag not in ("a", "img"):
            return
        self.values.extend(value for name, value in attrs if name in ("src", "href") and value)


def local_path(url, origin):
    parsed = urlsplit(url)
    assert f"{parsed.scheme}://{parsed.netloc}" == origin
    return urlunsplit(("", "", parsed.path, parsed.query, ""))


def one_route(html, origin, matches):
    candidates = [url for url in URLs(html).values if matches(urlsplit(url).path)]
    assert len(candidates) == 1, "Expected exactly one captured route"
    return local_path(candidates[0], origin)


def click(origin, path):
    try:
        with smoke["LOCAL_HTTP"].open(Request(origin + path), timeout=5):
            raise AssertionError("Tracked click did not return a redirect")
    except HTTPError as error:
        assert error.code == 307, "Unexpected tracked click status"
        assert error.headers.get("Location") == TARGET, "Tracked click lost its destination"
        error.close()


def analytics(origin, token, campaign_id):
    now = datetime.now(timezone.utc)
    query = urlencode({"id": campaign_id, "from": (now - timedelta(days=1)).isoformat(timespec="seconds"),
                       "to": (now + timedelta(days=1)).isoformat(timespec="seconds")})
    api = smoke["engine_api"]
    return {kind: api(origin, token, f"/api/campaigns/analytics/{kind}?{query}") or []
            for kind in ("views", "clicks", "links")}


def deliver(sql, origin, token, pit):
    api = smoke["engine_api"]
    http = smoke["http"]
    list_id, _ = smoke["create_list"](sql, "Synthetic campaign parity list")
    subscriber_id, subscriber_uuid, address = smoke["subscriber"](
        sql, RECIPIENT, "enabled", [(list_id, "confirmed")],
    )
    draft = api(origin, token, "/api/campaigns", "POST", {
        "name": SUBJECT, "subject": SUBJECT, "type": "regular", "content_type": "html",
        "body": '<p>Hello {{ .Subscriber.Name }}</p>' + f'<p><a href="{TARGET}@TrackLink">Fixture link</a></p>',
        "lists": [list_id],
        "headers": [{"Reply-To": "reply-capture@example.test"}],
    })
    campaign_id = draft["id"]
    path = f"/api/campaigns/{campaign_id}"
    assert analytics(origin, token, campaign_id) == {"views": [], "clicks": [], "links": []}
    api(origin, token, path + "/status", "PUT", {
        "status": "running", "expected_updated_at": draft["updated_at"],
    })

    def captured():
        _, raw = http(pit, "/api/v1/messages")
        return [message for message in json.loads(raw)["messages"] if message["Subject"] == SUBJECT]

    messages = smoke["wait_for"]("synthetic campaign SMTP capture", captured, timeout=45)
    smoke["wait_for"]("ordinary campaign completion",
                      lambda: api(origin, token, path)["status"] == "finished", timeout=45)
    assert len(messages) == 1 and len(captured()) == 1, "Expected one synthetic message"
    assert [recipient["Address"] for recipient in messages[0]["To"]] == [address]
    _, raw = http(pit, f"/api/v1/message/{messages[0]['ID']}/raw")
    sent = BytesParser(policy=policy.default).parsebytes(raw)
    assert sent.get_all("Reply-To") == ["reply-capture@example.test"]
    html = sent.get_body(preferencelist=("html",)).get_content()
    campaign_uuid = draft["uuid"]
    browser_path = one_route(html, origin, lambda value: value == f"/campaign/{campaign_uuid}/{subscriber_uuid}")
    _, browser = http(origin, browser_path)
    assert b"Fixture link" in browser and RECIPIENT.encode() in browser
    open_path = one_route(html, origin, lambda value: value.startswith(f"/campaign/{campaign_uuid}/") and value.endswith("/px.png"))
    _, pixel = http(origin, open_path)
    assert pixel.startswith(b"\x89PNG\r\n\x1a\n"), "Mailed tracking pixel did not resolve"
    click_path = one_route(html, origin, lambda value: value.startswith("/link/") and f"/{campaign_uuid}/" in value)
    click(origin, click_path)
    populated = analytics(origin, token, campaign_id)
    for kind in ("views", "clicks"):
        rows = populated[kind]
        assert len(rows) == 1 and rows[0]["campaign_id"] == campaign_id and rows[0]["count"] == 1
        assert rows[0]["timestamp"]
    assert populated["links"] == [{"url": TARGET, "count": 1}]
    assert sent["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    unsubscribe, = re.findall(r"<(http[^>]+)>", sent["List-Unsubscribe"] or "")
    unsubscribe_path = local_path(unsubscribe, origin)
    assert unsubscribe_path == f"/subscription/{campaign_uuid}/{subscriber_uuid}"
    http(origin, unsubscribe_path, "POST", form={"List-Unsubscribe": "One-Click"})
    smoke["assert_membership"](sql, subscriber_id, list_id, "unsubscribed")
    print("Captured mail links resolved, one view and one click populated analytics, and one-click unsubscribe persisted.")
    return api(origin, token, path), populated


def preview_archive(sql, origin, token, source, populated):
    api = smoke["engine_api"]
    http = smoke["http"]
    templates = api(origin, token, "/api/templates?no_body=true")
    template = next(item for item in templates if item["type"] == "campaign" and item["is_default"])
    campaign_id = source["id"]
    path = f"/api/campaigns/{campaign_id}"
    metadata = {"name": ARCHIVE_READER, "uuid": DUMMY_UUID}
    _, raw = http(origin, path + "/preview/archive", "POST", token=token,
                  form={"template_id": template["id"], "archive_meta": json.dumps(metadata)})
    html = raw.decode()
    assert ARCHIVE_READER in html and "Fixture link" in html and RECIPIENT not in html
    assert source["uuid"] not in html, "Archive preview exposed its real campaign tracking UUID"
    pixel = one_route(html, origin, lambda value: value == f"/campaign/{DUMMY_UUID}/{DUMMY_UUID}/px.png")
    tracked = one_route(html, origin, lambda value: value.startswith("/link/") and value.endswith(f"/{DUMMY_UUID}/{DUMMY_UUID}"))
    before = sql("SELECT (SELECT count(*) FROM campaign_views) || ':' || (SELECT count(*) FROM link_clicks)")
    _, content = http(origin, pixel)
    assert content.startswith(b"\x89PNG\r\n\x1a\n")
    click(origin, tracked)
    after = sql("SELECT (SELECT count(*) FROM campaign_views) || ':' || (SELECT count(*) FROM link_clicks)")
    assert before == after == "1:1", "Dummy preview interactions wrote analytics rows"
    assert analytics(origin, token, campaign_id) == populated
    slug = "synthetic-campaign-parity"
    api(origin, token, path + "/archive", "PUT", {
        "archive": True, "archive_slug": slug, "archive_template_id": template["id"], "archive_meta": metadata,
    })
    _, published = http(origin, f"/archive/{slug}")
    assert ARCHIVE_READER.encode() in published and b"Fixture link" in published
    print("Archive preview used dummy tracking, preview interactions added zero analytics rows, and the archive rendered.")


def clone(origin, token, source, name):
    api = smoke["engine_api"]
    assert api(origin, token, f"/api/warpdrive/audiences/{source['id']}") is None
    copy_fields = ("subject", "from_email", "messenger", "body", "body_source", "content_type",
                   "altbody", "template_id", "tags", "headers", "attribs")
    payload = {key: source.get(key) for key in copy_fields}
    payload.update({"name": name, "type": "regular",
                    "lists": [item["id"] for item in source["lists"] if item["id"] is not None],
                    "media": [item["id"] for item in source["media"] or [] if item["id"] is not None]})
    created = api(origin, token, "/api/campaigns", "POST", payload)
    assert created["id"] != source["id"] and created["name"] == name
    assert created["status"] == "draft" and created["sent"] == 0
    assert not created.get("started_at") and not created.get("send_at") and not created.get("archive")
    assert all(created.get(key) == source.get(key) for key in copy_fields)
    assert created["lists"] == source["lists"]
    assert api(origin, token, f"/api/warpdrive/audiences/{created['id']}") is None
    return created["id"]


def bulk_delete(origin, token, ids, expected=(200,)):
    query = urlencode([("id", campaign_id) for campaign_id in ids])
    return smoke["engine_api"](origin, token, f"/api/campaigns?{query}", "DELETE", expected=expected)


def verify_bulk(sql, origin, token, source):
    api = smoke["engine_api"]
    a = clone(origin, token, source, "Synthetic clone A")
    b = clone(origin, token, source, "Synthetic clone B")
    bulk_delete(origin, token, [a, source["id"]], expected=(409,))
    assert api(origin, token, f"/api/campaigns/{a}")["status"] == "draft"
    assert api(origin, token, f"/api/campaigns/{source['id']}")["status"] == "finished"
    assert bulk_delete(origin, token, [a, b, b]) is True
    assert sql(f"SELECT count(*) FROM campaigns WHERE id IN ({a},{b})") == "0"

    a = clone(origin, token, source, "Synthetic unaffected draft")
    b = clone(origin, token, source, "Synthetic concurrently advancing draft")
    assert api(origin, token, f"/api/campaigns/{b}")["status"] == "draft"
    with ThreadPoolExecutor(max_workers=2) as pool:
        advance = pool.submit(sql, f"BEGIN; UPDATE campaigns SET started_at=clock_timestamp(), status='paused' WHERE id={b}; SELECT pg_sleep(3); COMMIT;")
        smoke["wait_for"]("competing campaign update holds its row lock", lambda: sql("""SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
          AND wait_event='PgSleep' AND query LIKE '%SET started_at=clock_timestamp()%')""") == "t", timeout=3)
        delete = pool.submit(bulk_delete, origin, token, [a, b], (409,))
        smoke["wait_for"]("selected bulk delete waits on the advancing row", lambda: sql("""SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND query LIKE '%DELETE FROM campaigns c%')""") == "t", timeout=3)
        advance.result(timeout=6)
        delete.result(timeout=6)
    assert api(origin, token, f"/api/campaigns/{a}")["status"] == "draft"
    assert api(origin, token, f"/api/campaigns/{b}")["status"] == "paused"
    print("Ordinary cloning preserved authored content, and selected bulk delete rolled back on sent and racing campaigns.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--mailpit", type=Path, required=True)
    parser.add_argument("--postgres-bin", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-campaign-parity-") as directory, ExitStack() as stack:
        sql, origin, token, pit = smoke["smtp_fixture"](
            args.engine.resolve(), args.mailpit.resolve(), args.postgres_bin.resolve(), Path(directory), stack,
        )
        source, populated = deliver(sql, origin, token, pit)
        preview_archive(sql, origin, token, source, populated)
        verify_bulk(sql, origin, token, source)


if __name__ == "__main__":
    main()
