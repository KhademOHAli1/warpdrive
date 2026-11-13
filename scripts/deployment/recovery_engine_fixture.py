"""Run the derived newsletter Engine on the native recovery fixture's PostgreSQL."""

from collections import Counter
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import os
from pathlib import Path
import re
import runpy
import signal
import socket
import socketserver
import subprocess
import threading
import time
from urllib.error import URLError

from test_recovery import put


ENGINE_DB = "newsletter_recovery_fixture"
ENGINE_ROLE = "newsletter_recovery_runtime"
SCAN_WINDOW = 6.0  # The patched Engine scans for campaigns every five seconds.


class RelayHandler(socketserver.StreamRequestHandler):
    """Record bounded SMTP commands without accepting any message transaction."""

    def handle(self):
        self.connection.settimeout(1)
        self.wfile.write(b"220 recovery.fixture ESMTP\r\n")
        for _ in range(16):
            try:
                line = self.rfile.readline(513)
                if not line or len(line) > 512:
                    return
                word = line.split(maxsplit=1)[0].upper() if line.strip() else b""
                response = {
                    b"EHLO": b"250-recovery.fixture\r\n250 AUTH PLAIN\r\n",
                    b"HELO": b"250 recovery.fixture\r\n",
                    b"AUTH": b"235 fixture credentials accepted\r\n",
                    b"NOOP": b"250 fixture ready\r\n",
                    b"QUIT": b"221 fixture closed\r\n",
                }.get(word, b"550 message transactions forbidden in recovery fixture\r\n")
                with self.server.lock:
                    self.server.commands[word if word in {b"EHLO", b"HELO", b"AUTH", b"NOOP", b"QUIT",
                                                          b"MAIL", b"RCPT", b"DATA"} else b"other"] += 1
                self.wfile.write(response)
                if word in {b"QUIT", b"MAIL", b"RCPT", b"DATA"}:
                    return
            except OSError:
                return


class Relay(socketserver.ThreadingTCPServer):
    def __init__(self):
        self.commands = Counter()
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", 0), RelayHandler)


class NewsletterRecoveryFixture:
    def __init__(self, fixture, postgres_bin, engine, loopback_port):
        self.fixture = fixture
        self.postgres_bin = postgres_bin
        self.engine = engine
        self.loopback_port = loopback_port
        self.environment = {**fixture.command, "HOME": str(fixture.root), "GOMAXPROCS": "2",
                            "GOMEMLIMIT": "192MiB", "NEWSLETTER_DELIVERY_ENABLED": "true",
                            "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false", "NEWSLETTER_SES_FEEDBACK_ENABLED": "false"}
        self.smoke = runpy.run_path(str(Path(__file__).resolve().parents[1] / "newsletters" / "restore-smoke.py"))
        self.http = self.smoke["smoke"]["http"]
        self.api = self.smoke["smoke"]["engine_api"]
        self.setting = self.smoke["smoke"]["setting"]

    def sql(self, port, config, statement, database=ENGINE_DB):
        result = subprocess.run(
            [self.postgres_bin / "psql", "-XAtqw", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
             "-p", str(port), "-U", "recovery_owner", "-d", database, "-f", "-"],
            env={**self.fixture.command, "PGPASSWORD": config["ownerPassword"], "PGCONNECT_TIMEOUT": "3"},
            input=statement, capture_output=True, text=True, timeout=12, check=False,
        )
        self.fixture.assertEqual(result.returncode, 0, "Owned newsletter Engine fixture SQL failed")
        return result.stdout.strip()

    def config(self, directory, postgres_port, http_port, password, *, owner=False):
        config = directory / ("owner.toml" if owner else "engine.toml")
        user = "recovery_owner" if owner else ENGINE_ROLE
        self.fixture.assertRegex(password, r"^[a-f0-9]{64}$")
        put(config, (
            f'[app]\naddress="127.0.0.1:{http_port}"\n[db]\nhost="127.0.0.1"\nport={postgres_port}\n'
            f'user="{user}"\npassword="{password}"\ndatabase="{ENGINE_DB}"\nssl_mode="disable"\n'
            'params=""\nmax_open=4\nmax_idle=2\n'
        ).encode())
        return config

    def closed(self, port):
        with socket.socket() as probe:
            probe.settimeout(0.5)
            self.fixture.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0, "An Engine fixture port remains open")

    @contextmanager
    def relay(self):
        with Relay() as relay:
            thread = threading.Thread(target=relay.serve_forever, args=(0.05,))
            thread.start()
            port = relay.server_address[1]
            try:
                yield relay, port
            finally:
                relay.shutdown()
                thread.join(timeout=2)
                self.fixture.assertFalse(thread.is_alive(), "Owned recovery relay did not stop")
        self.closed(port)

    def set_media_and_relay(self, pg_port, config, media, origin, smtp_port):
        smtp = [{"name": "recovery-fixture", "enabled": True, "host": "127.0.0.1", "port": smtp_port,
                 "auth_protocol": "plain", "username": "fixture", "password": "synthetic-fixture",
                 "tls_type": "none", "max_conns": 1, "idle_timeout": "2s", "wait_timeout": "1s",
                 "max_msg_retries": 0, "msg_retry_delay": "10ms"}]
        self.sql(pg_port, config, "".join(self.setting(key, value) for key, value in (
            ("app.root_url", origin), ("upload.filesystem.upload_path", str(media)),
            ("upload.filesystem.upload_uri", "/uploads"), ("smtp", smtp),
        )))

    @contextmanager
    def running(self, directory, engine_config, http_port, *, passive):
        command = [str(self.engine), "--config", str(engine_config)]
        if passive:
            command.append("--passive")
        origin = f"http://127.0.0.1:{http_port}"
        log = directory / "engine.log"
        put(log, b"")
        with log.open("ab") as output:
            process = subprocess.Popen(command, cwd=directory, env=self.environment, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=output)
            try:
                deadline = time.monotonic() + 12
                while True:
                    self.fixture.assertIsNone(process.poll(), "Owned newsletter Engine exited during startup")
                    self.fixture.assertLess(time.monotonic(), deadline, "Owned newsletter Engine readiness deadline")
                    try:
                        if self.http(origin, "/health")[0] == 200:
                            break
                    except (OSError, URLError):
                        pass
                    time.sleep(0.05)
                self.fixture.assert_loopback_listeners(process, {f"127.0.0.1:{http_port}"},
                                                       {f"127.0.0.1:{http_port}"})
                yield origin
                self.fixture.assertIsNone(process.poll(), "Owned newsletter Engine exited while serving")
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGTERM)
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                        self.fixture.fail("Owned newsletter Engine did not stop on SIGTERM")
                # The upstream Engine handles SIGHUP for reload. SIGTERM may exit by signal.
                self.fixture.assertIn(process.returncode, (0, -signal.SIGTERM), "Unexpected newsletter Engine exit")
                self.closed(http_port)

    def campaign(self, origin, token, list_id, label, *, send_at=None):
        body = {"name": label, "subject": label, "type": "regular", "body": "<p>Fixture</p>",
                "content_type": "html", "lists": [list_id]}
        if send_at is not None:
            body["send_at"] = send_at.isoformat()
        return self.api(origin, token, "/api/campaigns", "POST", body)

    def seed(self, pg_port, media, config):
        directory = self.fixture.root / "engine-source"
        directory.mkdir(mode=0o700)
        with self.loopback_port() as http_port:
            pass
        self.sql(pg_port, config, f"CREATE DATABASE {ENGINE_DB}", "postgres")
        owner = self.config(directory, pg_port, http_port, config["ownerPassword"], owner=True)
        installed = subprocess.run([self.engine, "--config", owner, "--install", "--idempotent", "--yes"],
                                   cwd=directory, env={**self.environment, "LISTMONK_ADMIN_USER": "fixture_admin",
                                                       "LISTMONK_ADMIN_PASSWORD": os.urandom(32).hex(),
                                                       "LISTMONK_ADMIN_API_USER": "fixture_api"},
                                   stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25, check=False)
        self.fixture.assertEqual(installed.returncode, 0, "Owned newsletter Engine installer failed")
        token = re.search(r'LISTMONK_ADMIN_API_TOKEN="([^"\n]+)"', installed.stderr)
        self.fixture.assertIsNotNone(token, "Owned newsletter Engine installer emitted no fixture API token")
        owner.unlink()
        self.fixture.assertRegex(config["enginePassword"], r"^[a-f0-9]{64}$")
        self.sql(pg_port, config, f"""
            CREATE ROLE {ENGINE_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
                PASSWORD '{config["enginePassword"]}';
            REVOKE CREATE ON DATABASE {ENGINE_DB} FROM PUBLIC;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            GRANT CONNECT ON DATABASE {ENGINE_DB} TO {ENGINE_ROLE};
            GRANT USAGE ON SCHEMA public TO {ENGINE_ROLE};
            GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {ENGINE_ROLE};
            GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO {ENGINE_ROLE};
            GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {ENGINE_ROLE};
        """)
        self.fixture.assertEqual(self.sql(pg_port, config, f"""
            SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit
                OR has_schema_privilege(r.rolname, 'public', 'CREATE'))
            FROM pg_roles r WHERE r.rolname='{ENGINE_ROLE}'
        """), "t")
        self.sql(pg_port, config, "".join(self.setting(key, value) for key, value in (
            ("app.check_updates", False), ("app.notify_emails", []), ("app.concurrency", 1),
            ("app.from_email", "Fixture <sender@example.test>"), ("app.message_rate", 2), ("app.batch_size", 20),
        )))
        runtime_config = self.config(directory, pg_port, http_port, config["enginePassword"])
        api_token = token[1]

        def sql(statement):
            return self.sql(pg_port, config, statement)

        with self.relay() as (relay, smtp_port):
            self.set_media_and_relay(pg_port, config, media, f"http://127.0.0.1:{http_port}", smtp_port)
            with self.running(directory, runtime_config, http_port, passive=False) as origin:
                list_id, _ = self.smoke["smoke"]["create_list"](sql, "Coordinated recovery")
                subscriber = self.smoke["smoke"]["subscriber"]
                blocked, _, _ = subscriber(sql, "recovery-blocked", "blocklisted", [(list_id, "unsubscribed")])
                eligible, _, _ = subscriber(sql, "recovery-eligible", "enabled", [(list_id, "confirmed")])
                image = self.smoke["upload"](origin, api_token)
                filename = image["filename"]
                self.fixture.assertRegex(filename, r"^[a-zA-Z0-9_-]+\.png$")
                original = self.smoke["PNG"]
                self.fixture.assertEqual((media / filename).read_bytes(), original)
                self.fixture.assertEqual(self.http(origin, f"/uploads/{filename}")[1], original)
                campaign = self.campaign(origin, api_token, list_id, "Coordinated recovery",
                                         send_at=datetime.now(UTC) + timedelta(minutes=5))
                campaign_path = f"/api/campaigns/{campaign['id']}"
                self.api(origin, api_token, campaign_path + "/status", "PUT", {
                    "status": "scheduled", "expected_updated_at": campaign["updated_at"],
                })
                self.fixture.assertEqual(self.api(origin, api_token, campaign_path)["status"], "scheduled")
                held_id = int(self.campaign(origin, api_token, list_id, "Prior uncertain submission")["id"])
                sql(f"""
                    UPDATE campaigns SET status='paused' WHERE id={held_id};
                    INSERT INTO warpdrive_delivery_runs(campaign_id) VALUES ({held_id});
                    INSERT INTO warpdrive_delivery_recipients
                        (campaign_id,subscriber_id,subscriber_uuid,address_digest,state,message_id,attempts)
                    SELECT {held_id},id,uuid,sha256(convert_to(email,'UTF8')),'unknown',
                        '<recovery-uncertain@example.test>',1 FROM subscribers WHERE id={eligible};
                """)
                held = self.read_held(origin, api_token, held_id)
            self.assert_no_delivery(relay)
        runtime_config.unlink()
        return {"blocked": blocked, "eligible": eligible, "listId": list_id, "campaignId": campaign["id"],
                "heldCampaignId": held_id, "heldReceipt": held, "sourcePort": http_port,
                "filename": filename, "sha256": sha256(original).hexdigest()}, api_token

    def assert_no_delivery(self, relay):
        with relay.lock:
            self.fixture.assertFalse({b"MAIL", b"RCPT", b"DATA"}.intersection(relay.commands),
                                     "Newsletter Engine attempted an SMTP message transaction")

    def read_held(self, origin, token, campaign):
        self.fixture.assertEqual(self.api(origin, token, f"/api/campaigns/{campaign}")["status"], "paused")
        delivery = self.api(origin, token, f"/api/warpdrive-delivery/{campaign}")
        self.fixture.assertEqual(delivery["counts"], {"unknown": 1})
        self.fixture.assertEqual(len(delivery["review"]), 1)
        receipt = delivery["review"][0]
        self.fixture.assertEqual(receipt["message_id"], "<recovery-uncertain@example.test>")
        self.fixture.assertEqual(receipt["attempts"], 1)
        return receipt

    def verify(self, pg_port, media, config, state):
        directory = self.fixture.root / "engine-restored"
        directory.mkdir(mode=0o700)
        with self.loopback_port() as http_port:
            pass
        self.fixture.assertNotEqual(http_port, state["sourcePort"], "Restored Engine reused the source listener")
        campaign = int(state["campaignId"])
        blocked, eligible, list_id = map(int, (state["blocked"], state["eligible"], state["listId"]))
        filename = state["filename"]
        expected = state["sha256"]
        token = config["engineToken"]
        self.fixture.assertEqual(sha256((media / filename).read_bytes()).hexdigest(), expected)
        runtime_config = self.config(directory, pg_port, http_port, config["enginePassword"])
        with self.relay() as (relay, smtp_port):
            self.set_media_and_relay(pg_port, config, media, f"http://127.0.0.1:{http_port}", smtp_port)
            self.sql(pg_port, config, f"UPDATE campaigns SET send_at = clock_timestamp() - interval '1 minute' WHERE id={campaign}")
            self.fixture.assertEqual(self.sql(pg_port, config, f"""
                SELECT count(*) FROM subscriber_lists l JOIN subscribers s ON s.id=l.subscriber_id
                WHERE l.list_id={list_id} AND ((s.id={blocked} AND s.status='blocklisted' AND l.status='unsubscribed')
                    OR (s.id={eligible} AND s.status='enabled' AND l.status='confirmed'))
            """), "2")
            self.fixture.assertEqual(self.sql(pg_port, config, f"""
                SELECT count(*) FROM campaigns WHERE id={campaign} AND status='scheduled' AND send_at < clock_timestamp()
            """), "1")
            with self.running(directory, runtime_config, http_port, passive=True) as origin:
                readiness = self.api(origin, token, "/api/warpdrive/readiness")
                self.fixture.assertEqual(readiness["database"], {"status": "ready"})
                self.fixture.assertEqual(readiness["scheduler"], {"status": "passive", "lastScanAt": None})
                self.fixture.assertEqual(readiness["relay"]["status"], "ready")
                self.fixture.assertEqual(self.api(origin, token, f"/api/subscribers/{blocked}")["status"], "blocklisted")
                self.fixture.assertEqual(sha256(self.http(origin, f"/uploads/{filename}")[1]).hexdigest(), expected)
                deadline = time.monotonic() + SCAN_WINDOW
                while time.monotonic() < deadline:
                    self.fixture.assertEqual(self.api(origin, token, f"/api/campaigns/{campaign}")["status"], "scheduled")
                    time.sleep(0.25)
                self.fixture.assertEqual(self.api(origin, token, f"/api/campaigns/{campaign}")["status"], "scheduled")
                self.fixture.assertEqual(self.read_held(origin, token, state["heldCampaignId"]), state["heldReceipt"])
            with relay.lock:
                self.fixture.assertGreater(relay.commands[b"NOOP"], 0, "Restored Engine did not reach its loopback relay")
            self.assert_no_delivery(relay)
        runtime_config.unlink()
