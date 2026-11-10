#!/usr/bin/env python3
"""Run a derived Listmonk engine against a private PostgreSQL cluster and Mailpit."""
import argparse
import base64
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

DOMAIN = "example.test"
ENGINE_DB = "newsletter_fixture"
ENGINE_ROLE = "newsletter_fixture"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


LOCAL_HTTP = build_opener(ProxyHandler({}), NoRedirect())


def available_ports(count):
    with ExitStack() as stack:
        ports = []
        for _ in range(count):
            listener = stack.enter_context(socket.socket())
            listener.bind(("127.0.0.1", 0))
            ports.append(listener.getsockname()[1])
        return ports


def clean_env():
    return {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "TZ", "HOME", "TMPDIR")}


def command(args, env, directory, timeout=30, input=None):
    result = subprocess.run(
        [str(a) for a in args], cwd=directory, env=env, input=input, text=True,
        capture_output=True, timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed with exit code {result.returncode}")
    return result


def stop(process):
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def start(stack, args, env, directory, name):
    log = stack.enter_context((directory / f"{name}.log").open("w"))
    process = subprocess.Popen(
        [str(a) for a in args], cwd=directory, env=env, stdin=subprocess.DEVNULL,
        stdout=log, stderr=log, start_new_session=True,
    )
    stack.callback(stop, process)
    return process


def wait_for(description, probe, timeout=35):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            result = probe()
            if result:
                return result
        except (URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.2)
    raise AssertionError(f"Timed out: {description}")


def http(origin, path, method="GET", body=None, token=None, form=None, expected=(200,)):
    assert urlsplit(origin).hostname == "127.0.0.1"
    assert path.startswith("/") and not path.startswith("//")
    headers = {}
    payload = None
    if body is not None:
        payload = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if form is not None:
        payload = urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token is not None:
        headers["Authorization"] = "Basic " + base64.b64encode(f"fixture_api:{token}".encode()).decode()
    req = Request(origin + path, data=payload, headers=headers, method=method)
    try:
        with LOCAL_HTTP.open(req, timeout=5) as result:
            status, data = result.status, result.read()
    except HTTPError as error:
        status, data = error.code, error.read()
    if status not in expected:
        raise AssertionError(f"{method} {urlsplit(path).path} returned HTTP {status}; expected {expected}")
    return status, data


def engine_api(origin, token, path, method="GET", body=None, expected=(200,)):
    status, raw = http(origin, path, method, body, token, expected=expected)
    return json.loads(raw).get("data") if status == 200 else None


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def setting(key, value):
    return f"UPDATE settings SET value={literal(json.dumps(value))}::jsonb WHERE key={literal(key)};"


def create_list(sql, name, state="active"):
    uid = str(uuid4())
    list_id = sql(
        f"INSERT INTO lists(uuid,name,type,optin,status) VALUES "
        f"('{uid}','{name}','public','double','{state}') RETURNING id;"
    )
    return int(list_id), uid


def subscriber(sql, label, status, lists):
    uid = str(uuid4())
    address = f"{label}@{DOMAIN}"
    subscriber_id = int(sql(
        f"INSERT INTO subscribers(uuid,email,name,status) "
        f"VALUES ('{uid}','{address}','{label}','{status}') RETURNING id;"
    ))
    for list_id, membership in lists:
        sql(
            f"INSERT INTO subscriber_lists(subscriber_id,list_id,status) "
            f"VALUES ({subscriber_id},{list_id},'{membership}');"
        )
    return subscriber_id, uid, address


def assert_membership(sql, sub_id, list_id, status):
    actual = sql(f"SELECT status FROM subscriber_lists WHERE subscriber_id={sub_id} AND list_id={list_id};")
    assert actual == status, f"Expected {status} membership, got {actual}"


def smtp_fixture(engine, mailpit, postgres_bin, directory, stack):
    pg_port, smtp_port, pit_port, app_port = available_ports(4)
    environment = clean_env()
    db = directory / "db"
    command([postgres_bin / "initdb", "-D", db, "-A", "trust", "-U", "fixture_admin",
             "--no-locale", "--encoding=UTF8"], environment, directory)
    start(stack, [postgres_bin / "postgres", "-D", db, "-h", "127.0.0.1",
                  "-p", pg_port, "-k", directory], environment, directory, "postgres")
    pg = {**environment, "PGHOST": "127.0.0.1", "PGPORT": str(pg_port),
          "PGUSER": "fixture_admin", "PGDATABASE": "postgres", "PGCONNECT_TIMEOUT": "3"}
    wait_for("private PostgreSQL", lambda: subprocess.run(
        [str(postgres_bin / "pg_isready")], env=pg, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=3,
    ).returncode == 0)
    psql = postgres_bin / "psql"
    command([psql, "-XqAt", "-v", "ON_ERROR_STOP=1", "-c",
             f"CREATE ROLE {ENGINE_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE"], pg, directory)
    command([postgres_bin / "createdb", "-O", ENGINE_ROLE, ENGINE_DB], pg, directory)
    pg.update(PGUSER=ENGINE_ROLE, PGDATABASE=ENGINE_DB)

    def sql(source):
        return command([psql, "-XqAt", "-v", "ON_ERROR_STOP=1", "-c", source], pg, directory).stdout.strip()

    config = directory / "config.toml"
    config.write_text(
        f'[app]\naddress = "127.0.0.1:{app_port}"\n\n'
        f'[db]\nhost = "127.0.0.1"\nport = {pg_port}\nuser = "{ENGINE_ROLE}"\n'
        f'password = ""\ndatabase = "{ENGINE_DB}"\nssl_mode = "disable"\n'
        'max_open = 6\nmax_idle = 3\nmax_lifetime = "300s"\n'
    )
    install_env = {**environment, "LISTMONK_ADMIN_USER": "fixture_admin",
                   "LISTMONK_ADMIN_PASSWORD": secrets.token_urlsafe(24),
                   "LISTMONK_ADMIN_API_USER": "fixture_api"}
    install = command([engine, "--install", "--idempotent", "--yes", "--config", config],
                      install_env, directory)
    match = re.search(r'LISTMONK_ADMIN_API_TOKEN="([^"]+)"', install.stderr)
    if match is None:
        raise RuntimeError("Fixture API credential was not emitted by engine setup")
    token = match.group(1)
    origin = f"http://127.0.0.1:{app_port}"
    pit = f"http://127.0.0.1:{pit_port}"
    smtp = [{"name": "fixture", "enabled": True, "host": "127.0.0.1", "port": smtp_port,
             "auth_protocol": "none", "username": "", "password": "", "hello_hostname": "",
             "max_conns": 1, "idle_timeout": "15s", "wait_timeout": "5s", "max_msg_retries": 0,
             "msg_retry_delay": "10ms", "tls_type": "none", "tls_skip_verify": False,
             "email_headers": [], "from_addresses": []}]
    sql("".join(setting(k, v) for k, v in (
        ("app.root_url", origin), ("smtp", smtp), ("app.from_email", f"Fixture <sender@{DOMAIN}>"),
        ("app.notify_emails", []), ("app.show_optin_page", False),
        ("privacy.unsubscribe_header", True), ("app.concurrency", 1), ("app.batch_size", 20),
        ("app.message_rate", 2),
    )))
    start(stack, [mailpit, "--listen", f"127.0.0.1:{pit_port}", "--smtp", f"127.0.0.1:{smtp_port}",
                  "--smtp-allowed-recipients", r"^[^@]+@example\.test$"],
          environment, directory, "mailpit")
    wait_for("Mailpit", lambda: http(pit, "/readyz")[0] == 200)
    start(stack, [engine, "--config", config], {
        **environment, "NEWSLETTER_TEST_RECIPIENTS": f"approved@{DOMAIN}",
    }, directory, "engine")
    wait_for("engine", lambda: http(origin, "/health")[0] == 200)
    capabilities = engine_api(origin, token, "/api/warpdrive-capabilities")
    assert capabilities == {
        "consent": 2,
        "dispatch": 1,
        "listConsentMode": 1,
        "publicSubscriberUpdate": 1,
        "campaignRevision": 1,
    }, "The derived engine contract is required"
    return sql, origin, token, pit


def exercise(sql, origin, token, pit):
    active, active_uuid = create_list(sql, "Qualified audience")
    archive_later, archive_uuid = create_list(sql, "Archive before due")
    eligible, eligible_uuid, eligible_email = subscriber(
        sql, "eligible", "enabled", [(active, "unconfirmed"), (archive_later, "unsubscribed")]
    )
    suppressed, suppressed_uuid, _ = subscriber(
        sql, "blocked", "blocklisted", [(active, "unconfirmed")]
    )
    subscriber(sql, "disabled", "disabled", [(active, "confirmed")])
    subscriber(sql, "pending", "enabled", [(active, "unconfirmed")])
    subscriber(sql, "unsubscribed", "enabled", [(active, "unsubscribed")])
    subscriber(sql, "archived", "enabled", [(archive_later, "confirmed")])
    confirmation = [("confirm", "true"), ("l", active_uuid), ("l", archive_uuid)]
    eligible_path = f"/subscription/optin/{eligible_uuid}"
    prefetch = eligible_path + "?" + urlencode(confirmation)
    http(origin, prefetch)
    http(origin, prefetch, method="HEAD")
    assert_membership(sql, eligible, active, "unconfirmed")
    http(origin, eligible_path, method="POST", form=confirmation)
    assert_membership(sql, eligible, active, "confirmed")
    assert_membership(sql, eligible, archive_later, "unsubscribed")
    http(origin, f"/subscription/optin/{suppressed_uuid}", method="POST", form=confirmation)
    assert_membership(sql, suppressed, active, "unconfirmed")
    print("Link prefetch did not confirm; mixed-list POST preserved opt-out and suppression")

    subject = "Warpdrive scheduled consent qualification"
    due = (datetime.now(timezone.utc) + timedelta(seconds=12)).isoformat()
    campaign = engine_api(origin, token, "/api/campaigns", "POST", {
        "name": subject, "subject": subject, "type": "regular", "body": "<p>Fixture</p>",
        "content_type": "html", "lists": [active, archive_later], "send_at": due,
    })
    campaign_id = campaign["id"]
    campaign_path = f"/api/campaigns/{campaign_id}"
    engine_api(origin, token, campaign_path + "/status", "PUT", {
        "status": "scheduled", "expected_updated_at": "2000-01-01T00:00:00Z",
    }, expected=(409,))
    engine_api(origin, token, campaign_path + "/status", "PUT", {
        "status": "scheduled", "expected_updated_at": campaign["updated_at"],
    })
    assert engine_api(origin, token, campaign_path)["status"] == "scheduled"
    sql(f"UPDATE lists SET status='archived' WHERE id={archive_later};")

    def captured():
        _, raw = http(pit, "/api/v1/messages")
        return [x for x in json.loads(raw)["messages"] if x["Subject"] == subject]

    assert not captured(), "Future campaign sent before due time"
    messages = wait_for("scheduled SMTP delivery", captured, timeout=55)
    wait_for("campaign finished",
             lambda: engine_api(origin, token, campaign_path)["status"] == "finished")
    assert len(messages) == 1 and len(captured()) == 1, "Expected exactly one fixture message"
    message = messages[0]
    assert [x["Address"] for x in message["To"]] == [eligible_email], "Ineligible recipient got mail"
    _, raw = http(pit, f"/api/v1/message/{message['ID']}/raw")
    sent = BytesParser(policy=policy.default).parsebytes(raw)
    assert sent["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    links = re.findall(r"<([^>]+)>", sent["List-Unsubscribe"] or "")
    unsubscribe = next(urlsplit(link) for link in links if urlsplit(link).scheme == "http")
    assert f"{unsubscribe.scheme}://{unsubscribe.netloc}" == origin
    http(origin, unsubscribe.path, "POST", form={"List-Unsubscribe": "One-Click"})
    assert_membership(sql, eligible, active, "unsubscribed")
    print("Due-time dispatch selected one eligible recipient; mailed one-click link worked")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--mailpit", type=Path, required=True)
    parser.add_argument("--postgres-bin", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-newsletter-smoke-") as name, ExitStack() as stack:
        fixture = smtp_fixture(
            args.engine.resolve(), args.mailpit.resolve(), args.postgres_bin.resolve(), Path(name), stack
        )
        exercise(*fixture)


if __name__ == "__main__":
    main()
