#!/usr/bin/env python3
"""Qualify a persistent native-UI tab across an owned realtime-only restart.

Requires preinstalled locked application/browser dependencies and Chromium. It
never installs, builds, publishes, mounts application source or contacts providers.
"""
from __future__ import annotations

import argparse
from collections import deque
import json
import os
from pathlib import Path
import queue
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid

# Keep the source-bound harness from manufacturing ignored files during imports.
# Earlier fixture invocations on the hosted runner use PYTHONDONTWRITEBYTECODE too.
sys.dont_write_bytecode = True

try:
    from .bundle import load_bundle
    from .component_inputs import content_hash as input_receipt_hash, load_receipt as load_input_receipt, verify_current as verify_current_inputs
    from .image_smoke import ImageSmoke, SmokeError, COMPONENTS, OWNER_LABEL, HEALTH_PROBE, sanitized_log, utc_now, validate_revision
    from .loopback_forwarder import owned_bridge_forwarder
    from .registry_smoke import IsolatedDocker
except ImportError:
    from bundle import load_bundle
    from component_inputs import content_hash as input_receipt_hash, load_receipt as load_input_receipt, verify_current as verify_current_inputs
    from image_smoke import ImageSmoke, SmokeError, COMPONENTS, OWNER_LABEL, HEALTH_PROBE, sanitized_log, utc_now, validate_revision
    from loopback_forwarder import owned_bridge_forwarder
    from registry_smoke import IsolatedDocker

LISTENER_PROBE = """import {connect} from 'node:net';await new Promise((resolve,reject)=>{const s=connect({host:'127.0.0.1',port:8080});const timer=setTimeout(()=>{s.destroy();reject(Error('Listener timeout'));},3000);s.once('connect',()=>{clearTimeout(timer);s.destroy();resolve();});s.once('error',e=>{clearTimeout(timer);reject(e);});});"""

ROOT = Path(__file__).resolve().parents[2]
SOURCE_HARNESS = ("scripts/deployment/browser_realtime_smoke.py", "scripts/deployment/test_browser_realtime_smoke.py",
                  "scripts/browser-realtime.mjs", "scripts/browser-realtime-fixture.mjs", "scripts/browser-operations.mjs")
PHASES = {
    "initial-ready": {"nativeLogin": True, "realTicket": True, "realAuth": True, "userAndPipelineSubscribed": True, "unread": 0, "persistentMounts": True},
    "offline-refetch-settled": {"disconnectObserved": True, "bothNotificationQueriesCompleted": True, "inflight": 0},
    "offline-notice-hidden": {"unread": 0, "producedAfterDisconnectRefetch": True},
    "missed-notice-recovered": {"freshRealTicket": True, "realReauth": True, "userAndPipelineResubscribed": True, "unread": 1, "ackRefetchCompleted": True, "persistentMounts": True},
    "realtime-ready-for-operations": {"persistentMounts": True, "liveRelayResumed": True},
    "operations-ready": {"nativeAdminLogin": True, "nativeAdminMfa": True, "realFactsRendered": True, "staleAndUnknown": True, "nullAgeNotZero": True, "recoveredIncident": True, "metadataOnlyReceipts": True},
    "operations-denied": {"api403Both": True, "allPrivateSectionsHidden": True, "mountedDocuments": True},
    "operations-restored": {"explicitRefreshBoth": True, "currentAdminReads": True, "noAutomaticRestoration": True, "boardRetained": True},
    "complete": {"nativePasswordLogin": True, "persistentMounts": True, "missedNoticeRecovered": True, "liveRelayResumed": True, "unread": 2, "maxActiveSockets": 1, "pageErrors": 0, "operationsQualified": True},
}
OPERATIONS_FLAGS = {"nativeAdminPasswordLogin", "nativeAdminMfa", "realRepositoryFacts", "maintenanceFields", "staleAndUnknown",
                    "sourceEnrollmentDistinction", "nullAgeNotZero", "recoveredIncident", "metadataOnlyReceipts",
                    "mounted403HiddenBoth", "explicitRefreshRestoredBoth", "noAutomaticRestoration", "boardRetained"}
LIMITATIONS = [
    "One synthetic nonadmin persistent browser tab on exact final images; no production deployment acceptance.",
    "Native password and synthetic administrator TOTP enrollment/verification are exercised; installed SSO/MFA, public TLS/ingress, recovery-code storage and external providers are not qualified.",
    "Same-image realtime recovery only; old/new API compatibility, host failover and data recovery remain separate gates.",
    "Source-bound actual notification producer uses an owned database relay; no provider/email worker is started.",
    "Separate synthetic native administrator tabs exercise real Operations reads; fenced test-only role mutations do not qualify administrator-management UI or installed monitoring.",
]


class BrowserRealtimeError(SmokeError):
    pass


def admit_source(host, revision):
    if host(["git", "rev-parse", "HEAD"]).strip() != revision:
        raise BrowserRealtimeError("Source notification producer differs from exact final-image revision")
    host(["git", "diff", "--quiet", "HEAD", "--"])
    for path in SOURCE_HARNESS:
        host(["git", "cat-file", "-e", revision + ":" + path])
    if (host(["git", "status", "--porcelain", "--untracked-files=all"]).strip()
            or host(["git", "ls-files", "--others", "--", "src", "scripts", "patches", "deploy", "public"]).strip()):
        raise BrowserRealtimeError("Uncommitted fixture source cannot establish exact revision binding")


def admit_bundle_source(root, directory, candidate, revision):
    # The producer imports application code too. A quiet Git diff or harness-only
    # check cannot prove those bytes when index optimization flags hide changes.
    if candidate.get("schemaVersion") != 2:
        raise BrowserRealtimeError("Current browser journeys require a Version2 source-input bundle")
    receipt = load_input_receipt(Path(directory) / "component-inputs.json")
    provenance = candidate.get("inputProvenance")
    if (not isinstance(provenance, dict) or provenance.get("state") != "current-source-inputs-bound"
            or provenance.get("receiptSha256") != input_receipt_hash(receipt)
            or provenance.get("inputPolicySha256") != receipt.get("inputPolicySha256")):
        raise BrowserRealtimeError("Browser input receipt differs from the retained candidate")
    verify_current_inputs(root, receipt, expected_revision=revision)
    return {"freshInputReceipt": True, "rawHeadBlobBinding": True}


def admit_message(value):
    if not isinstance(value, dict) or value.get("phase") not in PHASES:
        raise BrowserRealtimeError("Unknown browser realtime control proof")
    expected = PHASES[value["phase"]]
    if set(value) != {"phase", *expected} or any(type(value[key]) is not type(wanted) or value[key] != wanted for key, wanted in expected.items()):
        raise BrowserRealtimeError("Incomplete or unsafe browser realtime control proof")
    return value


def admit_profile(profile, environment):
    try:
        origin = urlsplit(profile["baseUrl"])
        database = urlsplit(environment["DATABASE_URL"])
        valid = (origin.scheme == "https" and origin.hostname == "127.0.0.1" and origin.port
                 and not origin.username and not origin.password and origin.path in {"", "/"} and not origin.query and not origin.fragment
                 and database.scheme == "postgres" and database.hostname == "127.0.0.1" and database.port == profile["databasePort"]
                 and database.username == "smoke" and database.path == "/warpdrive_image_smoke" and not database.query and not database.fragment)
    except (KeyError, TypeError, ValueError):
        valid = False
    required = {"NODE_ENV": "production", "BUN_OPTIONS": "--no-env-file", "AUTH_GOOGLE_ENABLED": "false",
                "NEWSLETTER_DELIVERY_ENABLED": "false", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
                "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true", "AUTH_SMTP_HOST": "127.0.0.1", "AUTH_SMTP_PORT": "9"}
    if (not valid or any(environment.get(key) != value for key, value in required.items()) or environment.get("DATABASE_URL_FILE")
            or not re.fullmatch(r"[a-f0-9]{40}", str(profile.get("revision", "")))
            or any(not isinstance(profile.get(key), str) or not profile[key].endswith("@example.invalid") for key in ("email", "adminEmail"))
            or profile["email"] == profile["adminEmail"]
            or any(not isinstance(profile.get(key), str) or len(profile[key]) < 20 for key in ("password", "adminPassword"))
            or any(not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", str(profile.get(key, ""))) for key in ("actorId", "adminId", "pipelineId", "permissionId"))
            or len({profile[key] for key in ("actorId", "adminId", "pipelineId", "permissionId")}) != 4):
        raise BrowserRealtimeError("Persistent browser/source fixture profile was not admitted")


def admit_fixture_result(value, action, revision):
    facts = {
        "seed": {"nativePasswordIdentity": True, "nativeAdminPasswordIdentity": True, "forgedSession": False},
        "offline": {"actualProducer": True, "notificationCount": 1, "emailEnabled": False},
        "online": {"actualProducer": True, "notificationCount": 2, "emailEnabled": False},
        "operations-seed": {"actualOperationsRepository": True, "enrolledSources": 2, "receipts": 4, "currentObservations": 4, "recoveredIncidents": 1},
        "operations-revoke": {"committedAuthorityChange": True, "nativeMfaSession": True, "admin": False, "fixtureMutationOnly": True},
        "operations-regrant": {"committedAuthorityChange": True, "nativeMfaSession": True, "admin": True, "fixtureMutationOnly": True},
    }
    expected = {"ok": True, "action": action, "sourceRevision": revision, **facts.get(action, {})}
    if action not in facts or not isinstance(value, dict) or set(value) != set(expected) or any(type(value[key]) is not type(wanted) or value[key] != wanted for key, wanted in expected.items()):
        raise BrowserRealtimeError("Complete secret-free source fixture result is required")
    return value


def admit_result(value, revision):
    keys = {"schemaVersion", "success", "revision", "nativePasswordLogin", "persistentDocumentAndMounts", "freshRealTicketAndAuth",
            "missedNoticeRecoveredAfterAckRefetch", "resumedRealNotificationFrame", "unread", "maxActiveSockets", "metrics", "notificationFrameCount", "limitations", "operations"}
    flags = ("success", "nativePasswordLogin", "persistentDocumentAndMounts", "freshRealTicketAndAuth", "missedNoticeRecoveredAfterAckRefetch", "resumedRealNotificationFrame")
    metrics = value.get("metrics") if isinstance(value, dict) else None
    metric_names = {"pageErrors", "blockedRequests", "blockedWebSockets", "loginResponses", "ticketRequests", "ticketResponses", "mainNavigations", "notificationRequests"}
    operations = value.get("operations") if isinstance(value, dict) else None
    if (not isinstance(value, dict) or set(value) != keys or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1 or value.get("revision") != revision
            or any(value.get(key) is not True for key in flags) or type(value.get("unread")) is not int or value["unread"] != 2
            or type(value.get("maxActiveSockets")) is not int or value["maxActiveSockets"] != 1
            or type(value.get("notificationFrameCount")) is not int or value["notificationFrameCount"] < 1
            or not isinstance(metrics, dict) or set(metrics) != metric_names or any(type(number) is not int or number < 0 for number in metrics.values())
            or any(metrics[key] for key in ("pageErrors", "blockedRequests", "blockedWebSockets"))
            or metrics["loginResponses"] < 1 or metrics["ticketResponses"] < 2
            or not isinstance(operations, dict) or set(operations) != OPERATIONS_FLAGS | {"forbiddenResponses", "readResponses", "regrantIdleWindowMs"}
            or any(operations[key] is not True for key in OPERATIONS_FLAGS)
            or type(operations["forbiddenResponses"]) is not int or operations["forbiddenResponses"] < 4
            or type(operations["readResponses"]) is not int or operations["readResponses"] < 8
            or type(operations["regrantIdleWindowMs"]) is not int or not 65000 <= operations["regrantIdleWindowMs"] <= 75000
            or not isinstance(value.get("limitations"), list) or not value["limitations"]):
        raise BrowserRealtimeError("Complete secret-free persistent browser recovery result is required")
    return value


class BrowserProcess:
    def __init__(self, environment, runner=subprocess.Popen):
        self.messages, self.errors = queue.Queue(maxsize=8), deque(maxlen=80)
        self.invalid = False
        self.process = runner(["bun", "--no-env-file", str(ROOT / "scripts/browser-realtime.mjs")], cwd=ROOT,
                              env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, bufsize=1, start_new_session=True)
        self.readers = [threading.Thread(target=self._read, args=(self.process.stdout, True), daemon=True),
                        threading.Thread(target=self._read, args=(self.process.stderr, False), daemon=True)]
        for reader in self.readers:
            reader.start()

    def _read(self, stream, protocol):
        while True:
            line = stream.readline(8193)
            if not line:
                return
            if len(line) > 8192:
                self.invalid = True
                return
            if not protocol:
                self.errors.append(line)
                continue
            try:
                self.messages.put_nowait(admit_message(json.loads(line)))
            except (ValueError, BrowserRealtimeError, queue.Full):
                self.invalid = True
                return

    def wait(self, phase, timeout=60):
        deadline = time.monotonic() + timeout
        while True:
            if self.invalid:
                raise BrowserRealtimeError("Browser emitted invalid or unsafe control evidence")
            try:
                message = self.messages.get(timeout=0.1)
                if message["phase"] != phase:
                    raise BrowserRealtimeError("Browser realtime phase order changed")
                return message
            except queue.Empty:
                if self.process.poll() is not None:
                    raise BrowserRealtimeError("Persistent browser exited before required realtime proof")
                if time.monotonic() >= deadline:
                    raise BrowserRealtimeError("Persistent browser did not complete its bounded phase")

    def send(self, command):
        if command not in {"offline", "offline-produced", "restart", "online-produced", "operations-seeded", "operations-revoked", "operations-regranted"}:
            raise BrowserRealtimeError("Invalid browser coordination command")
        try:
            self.process.stdin.write(json.dumps({"command": command}) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError) as error:
            raise BrowserRealtimeError("Persistent browser coordination pipe closed") from error

    def finished(self):
        try:
            code = self.process.wait(timeout=15)
        except subprocess.TimeoutExpired as error:
            raise BrowserRealtimeError("Persistent browser did not finish cleanly") from error
        if code != 0 or self.invalid:
            raise BrowserRealtimeError("Persistent browser did not exit successfully")

    def close(self):
        errors = []
        if self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                errors.append("owned browser required forced termination")
                try:
                    os.killpg(self.process.pid, signal.SIGTERM)
                    self.process.wait(timeout=5)
                except ProcessLookupError:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(timeout=5)
        for reader in self.readers:
            reader.join(2)
            if reader.is_alive():
                errors.append("owned browser output reader did not stop")
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()
        return errors


class BrowserRealtimeSmoke:
    def __init__(self, docker, bundle_dir, revision, output_dir):
        self.docker, self.bundle_dir, self.output_dir = docker, Path(bundle_dir), Path(output_dir)
        self.revision = validate_revision(revision)
        self.fixture = self.browser = None
        self.forwarders = []
        self.private = None
        self.report = {"schemaVersion": 1, "kind": "warpdrive-persistent-browser-realtime-smoke", "success": False,
                       "revision": revision, "startedAt": utc_now(), "checks": [], "limitations": LIMITATIONS,
                       "failure": None, "diagnostics": {}, "cleanup": {"success": False, "errors": []}}

    def check(self, name, operation):
        try:
            detail = operation()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed"})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def host(self, args, *, environment=None, timeout=30):
        try:
            result = subprocess.run(args, cwd=ROOT, env=environment or self.host_env, capture_output=True, text=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise BrowserRealtimeError("Owned host fixture command did not complete") from error
        if result.returncode != 0:
            raise BrowserRealtimeError("Owned host fixture command failed; source/dependency/runtime gate remains open")
        return result.stdout

    def load(self):
        if sys.platform != "linux":
            raise BrowserRealtimeError("Persistent final-image browser fixture requires native Linux")
        self.host_env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH") if key in os.environ}
        self.host_env.update(BUN_OPTIONS="--no-env-file", BUN_RUNTIME_TRANSPILER_CACHE_PATH=str(self.private / "bun-cache"))
        admit_source(self.host, self.revision)
        for path in (ROOT / "node_modules/better-auth/package.json", ROOT / "tools/browser-smoke/node_modules/playwright/index.mjs"):
            if not path.is_file():
                raise BrowserRealtimeError("Locked root application and browser dependencies must already be installed")
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        self.candidate = loaded["candidate"]
        self.verify_source_inputs()
        images = {name: loaded["candidate"]["components"][name]["imageId"] for name in COMPONENTS}
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.output_dir / "fixture", self.revision)
        self.fixture.inspect_images()
        self.report["images"] = self.fixture.report["images"]
        return {"sourceRevisionBound": True, "exactFinalImages": True, "archiveSha256": loaded["provenance"]["archiveSha256"], "rebuilds": 0}

    def verify_source_inputs(self):
        return admit_bundle_source(ROOT, self.bundle_dir, self.candidate, self.revision)

    def setup(self):
        isolation = self.fixture.create_environment()
        self.fixture.migrations()
        network = self.fixture.report["resources"]["network"]
        tls = self.private / "tls"
        # The enclosing TemporaryDirectory is 0700. The read-only bind's root/files
        # must be readable by capability-dropped Caddy even when runner UID differs.
        tls.mkdir(mode=0o755)
        if "," in str(tls):
            raise BrowserRealtimeError("Owned TLS fixture path cannot contain mount separators")
        self.host(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                   "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", str(tls / "key.pem"), "-out", str(tls / "cert.pem")])
        (tls / "key.pem").chmod(0o444)
        (tls / "cert.pem").chmod(0o444)
        web_name = self.fixture.prefix + "-web"
        config = "{\n admin off\n auto_https off\n}\nhttps://:8443 {\n tls /fixture/cert.pem /fixture/key.pem\n @realtime path /_ws\n reverse_proxy @realtime realtime:8080\n reverse_proxy " + web_name + ":3000\n}\n"
        (tls / "Caddyfile").write_text(config)
        (tls / "Caddyfile").chmod(0o444)
        proxy = self.fixture.start_container("browser-proxy", "caddy:2-alpine", ["caddy", "run", "--config", "/fixture/Caddyfile", "--adapter", "caddyfile"],
            environment={}, pull="missing", memory="256m", readonly=True,
            mount=f"type=bind,source={tls},target=/fixture,readonly", tmpfs=("/data:rw,noexec,nosuid,size=16m", "/config:rw,noexec,nosuid,size=16m", "/tmp:rw,noexec,nosuid,size=16m"))
        web_forwarder = owned_bridge_forwarder(self.docker, owner_label=OWNER_LABEL, owner=self.fixture.prefix,
            network_name=network, container_name=proxy, port=8443, max_connections=8).start()
        self.forwarders.append(web_forwarder)
        pg_forwarder = owned_bridge_forwarder(self.docker, owner_label=OWNER_LABEL, owner=self.fixture.prefix,
            network_name=network, container_name=self.fixture.containers["postgres"], port=5432, max_connections=4).start()
        self.forwarders.append(pg_forwarder)
        base = "https://" + web_forwarder.authority
        self.fixture.env["BASE_URL"] = base
        self.fixture.env["AUTH_TRUSTED_PROXY_HEADER"] = "x-real-ip"
        self.realtime = self.fixture.start_container("realtime", self.fixture.report["images"]["realtime"]["id"], ["bun", "dist/ws.mjs"])
        self.web = self.fixture.start_container("web", self.fixture.report["images"]["web"]["id"], ["bun", "--bun", "next", "start"], memory="1536m")
        self.fixture.wait_for(lambda: self.docker.run(["exec", self.realtime, "bun", "--no-env-file", "-e", LISTENER_PROBE], timeout=5, check=False).returncode == 0,
                              "realtime browser fixture listener", 45, self.realtime)
        self.fixture.wait_for(lambda: self.docker.run(["exec", self.web, "bun", "--no-env-file", "-e", HEALTH_PROBE], timeout=10, check=False).returncode == 0,
                              "native browser Web HTTP readiness", 90, self.web)
        from_image = self.fixture.env["DATABASE_URL"]
        source_db = urlsplit(from_image)
        database_port = int(pg_forwarder.authority.split(":")[1])
        self.source_env = {**self.host_env, **self.fixture.env,
            "DATABASE_URL": f"postgres://smoke:{source_db.password}@127.0.0.1:{database_port}/warpdrive_image_smoke"}
        browser_dir = self.output_dir / "browser"
        browser_dir.mkdir(mode=0o700)
        self.profile = {"revision": self.revision, "baseUrl": base, "databasePort": database_port,
            "actorId": str(uuid.uuid4()), "pipelineId": str(uuid.uuid4()), "permissionId": str(uuid.uuid4()),
            "adminId": str(uuid.uuid4()), "adminEmail": "operations-" + secrets.token_hex(8) + "@example.invalid", "adminPassword": secrets.token_urlsafe(32),
            "email": "realtime-" + secrets.token_hex(8) + "@example.invalid", "password": secrets.token_urlsafe(32),
            "pipelineName": "Browser Realtime Pipeline", "offlineTitle": "Realtime offline " + secrets.token_hex(6),
            "onlineTitle": "Realtime online " + secrets.token_hex(6), "outputDir": str(browser_dir.resolve())}
        admit_profile(self.profile, self.source_env)
        self.profile_path = self.private / "browser-profile.json"
        self.profile_path.write_text(json.dumps(self.profile), encoding="utf8")
        self.profile_path.chmod(0o600)
        self.source_env["BROWSER_REALTIME_PROFILE"] = str(self.profile_path)
        return {"isolation": isolation, "tls": "generated-self-signed-loopback", "appSourceMounts": 0,
                "workersStarted": 0, "dockerPublishedPorts": 0, "sameOriginRealtime": True}

    def produce(self, action):
        if action not in {"seed", "offline", "online", "operations-seed", "operations-revoke", "operations-regrant"}:
            raise BrowserRealtimeError("Unknown source fixture action")
        raw = self.host(["bun", "--no-env-file", str(ROOT / "scripts/browser-realtime-fixture.mjs"), action], environment=self.source_env, timeout=40)
        try:
            result = json.loads(raw)
        except ValueError as error:
            raise BrowserRealtimeError("Source fixture emitted invalid safe result") from error
        return admit_fixture_result(result, action, self.revision)

    def seed(self):
        result = self.produce("seed")
        if result.get("forgedSession") is not False or result.get("nativePasswordIdentity") is not True:
            raise BrowserRealtimeError("Native password identity seed was not proven")
        return {"sourceBoundNativePasswordIdentity": True, "sourceBoundNativeAdminPasswordIdentity": True, "forgedSession": False}

    def journey(self):
        environment = {**self.host_env, "BROWSER_REALTIME_PROFILE": str(self.profile_path)}
        self.browser = BrowserProcess(environment)
        self.browser.wait("initial-ready", 90)
        self.fixture.assert_running(self.web)
        self.docker.run(["kill", "--signal", "TERM", self.realtime], timeout=10)
        deadline = time.monotonic() + 25
        while True:
            state = self.fixture.state(self.realtime)
            if not state["Running"]:
                if state.get("ExitCode") != 0 or state.get("OOMKilled"):
                    raise BrowserRealtimeError("Owned realtime service did not stop gracefully")
                break
            if time.monotonic() >= deadline:
                raise BrowserRealtimeError("Owned realtime service stop exceeded its bound")
            time.sleep(0.1)
        self.browser.send("offline")
        self.browser.wait("offline-refetch-settled", 30)
        self.produce("offline")
        self.browser.send("offline-produced")
        self.browser.wait("offline-notice-hidden", 20)
        self.docker.run(["start", self.realtime])
        self.fixture.wait_for(lambda: self.docker.run(["exec", self.realtime, "bun", "--no-env-file", "-e", LISTENER_PROBE], timeout=5, check=False).returncode == 0,
                              "restarted realtime listener", 15, self.realtime)
        self.browser.send("restart")
        self.browser.wait("missed-notice-recovered", 90)
        self.produce("online")
        self.browser.send("online-produced")
        self.browser.wait("realtime-ready-for-operations", 60)
        self.operations_journey()
        self.browser.wait("complete", 60)
        self.browser.finished()
        result = admit_result(json.loads((self.output_dir / "browser/browser.json").read_text()), self.revision)
        for name in ("web", "realtime"):
            observed = self.docker.run(["container", "inspect", self.fixture.containers[name], "--format", "{{.Image}}"], timeout=5).stdout.strip()
            if observed != self.fixture.report["images"][name]["id"]:
                raise BrowserRealtimeError("Browser journey changed an exact tested component image")
            self.fixture.assert_running(self.fixture.containers[name])
        return {"persistentNativeUiTab": True, "freshRealTicketAndAuth": True, "missedNoticeResynced": True,
                "liveStreamResumed": True, "unread": result["unread"], "maxActiveSockets": result["maxActiveSockets"], "pageErrors": 0,
                "nativeOperationsAdminUi": True, "nativeAdminMfa": True, "mountedApi403Both": True,
                "explicitRefreshRestoredBoth": True, "noAutomaticRestoration": True}

    def operations_journey(self):
        self.produce("operations-seed")
        self.browser.send("operations-seeded")
        self.browser.wait("operations-ready", 60)
        self.produce("operations-revoke")
        self.browser.send("operations-revoked")
        self.browser.wait("operations-denied", 30)
        self.produce("operations-regrant")
        self.browser.send("operations-regranted")
        self.browser.wait("operations-restored", 100)

    def cleanup(self):
        errors = []
        if self.browser is not None:
            errors.extend(self.browser.close())
        for forwarder in reversed(self.forwarders):
            try:
                forwarder.close()
            except Exception:
                errors.append("owned browser/database relay cleanup failed")
        if self.fixture is not None:
            errors.extend(self.fixture.cleanup())
        return errors

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
        with tempfile.TemporaryDirectory(prefix="wd-browser-realtime-") as directory:
            self.private = Path(directory)
            try:
                self.check("exact-final-images-and-source-producer-binding", self.load)
                self.check("isolated-tls-browser-and-database-profile", self.setup)
                self.check("native-password-identity-no-forged-session", self.seed)
                self.check("persistent-tab-reconnect-resync-and-live-notification", self.journey)
                self.check("source-inputs-unchanged-after-browser", self.verify_source_inputs)
            except Exception as error:
                self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
                secrets_to_mask = list(self.fixture.env.values()) if self.fixture is not None else []
                if hasattr(self, "profile"):
                    secrets_to_mask += [self.profile["password"], self.profile["adminPassword"], self.source_env["DATABASE_URL"]]
                self.report["diagnostics"] = {"containers": self.fixture.failure_diagnostics() if self.fixture is not None else [],
                    "browserStderr": sanitized_log("".join(self.browser.errors), secrets_to_mask) if self.browser is not None else None}
            finally:
                errors = self.cleanup()
                self.report["cleanup"] = {"success": not errors, "errors": errors}
                self.report["finishedAt"] = utc_now()
                self.report["success"] = self.report["failure"] is None and not errors
                (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--expected-revision", type=validate_revision, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(arguments)
    try:
        with tempfile.TemporaryDirectory(prefix="wd-browser-auth-") as directory:
            passed = BrowserRealtimeSmoke(IsolatedDocker(Path(directory) / "docker"), args.bundle_dir,
                                           args.expected_revision, args.output_dir).run()
    except (SmokeError, ValueError, OSError) as error:
        print(f"Persistent browser realtime smoke rejected: {error}", file=sys.stderr)
        return 1
    print(f"Persistent browser realtime smoke {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
