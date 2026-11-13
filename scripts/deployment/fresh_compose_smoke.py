"""Qualify an opt-in, isolated native fresh Compose installation and Web rollback."""

import argparse
from copy import deepcopy
from hashlib import sha256
from http.client import HTTPSConnection, HTTPException
import json
import os
from pathlib import Path
import platform
import re
import secrets
import signal
import ssl
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import uuid

from component_inputs import decode
from fresh_compose_admission import COMPOSE, IMAGES, ROOT, VOLUME_MOUNTS, _pinned_images, _validate
from image_smoke import Docker, ImageSmoke, SmokeError, WS_PROBE, image_metadata
from installed_web_chain import _directory
from loopback_forwarder import ForwarderError, owned_bridge_forwarder
from web_switch import SwitchConflict, canonical, content_hash, require


OWNER = "com.docker.compose.project"
SERVICE = "com.docker.compose.service"
SERVICE_PORT = 8443
TOTAL_SECONDS = 600
EXACT_ID = re.compile(r"[a-f0-9]{64}\Z")
LONG_RUNNING = {"postgres", "minio", "app", "ws", "worker", "newsletter-engine", "caddy"}
TLS = """{
 admin off
 auto_https off
}
https://:8443 {
 tls /fixture/cert.pem /fixture/key.pem
 @realtime path /_ws*
 reverse_proxy @realtime ws:8080
 reverse_proxy app:3000 {
  header_up X-Real-IP {remote_host}
 }
}
"""
RUNTIME_GRANTS = """REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, pgboss TO smoke_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss TO smoke_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, pgboss TO smoke_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, pgboss TO smoke_runtime;
"""
WORKER_PROBE = r"""
import { PgBoss } from 'pg-boss';
const boss = new PgBoss({connectionString:process.env.DATABASE_URL,max:1,migrate:false,createSchema:false,
  schedule:false,supervise:false,reindex:false,registerInstance:false,application_name:'fresh-compose-probe'});
let failed = false;
boss.on('error', () => {failed = true;});
try {
  await boss.start();
  const deadline = Date.now()+35000;
  while (!(await boss.getQueue('file.reaper'))) {
    if (failed || Date.now()>=deadline) throw Error('Worker registration missing');
    await Bun.sleep(250);
  }
  const id = await boss.send('file.reaper', {freshComposeSmoke:true}, {retryLimit:0});
  if (!id) throw Error('Worker job identity missing');
  while (true) {
    const [job] = await boss.findJobs('file.reaper', {id,limit:1});
    if (job?.state === 'completed') {console.log(JSON.stringify({completed:true}));break;}
    if (failed || ['failed','cancelled'].includes(job?.state) || Date.now()>=deadline) throw Error('Worker job incomplete');
    await Bun.sleep(250);
  }
} finally {await boss.stop({graceful:false,timeout:1000});}
"""
APP_PEER_PROBE = r"""
if (process.env.MIGRATION_DATABASE_URL || process.env.MIGRATION_DATABASE_URL_FILE) throw Error('Owner credential reached Web');
const deadline = Date.now()+12000;
while (true) {
  let healthy = false;
  try {
    const engine = await fetch('http://newsletter-engine:9000/health', {redirect:'error',signal:AbortSignal.timeout(1500)});
    healthy = engine.ok;
    await engine.body?.cancel();
  } catch {}
  if (healthy) break;
  if (Date.now()>=deadline) throw Error('Passive engine unavailable');
  await Bun.sleep(250);
}
const object = await fetch('http://minio:9000/warpdrive-fresh/fixture.txt', {redirect:'error',signal:AbortSignal.timeout(4000)});
if (object.status !== 403) throw Error('Anonymous fixture object was not denied');
const reader = object.body.getReader();
const data = [];
let bytes = 0;
while (true) {
  const {value,done} = await reader.read();
  if (done) break;
  bytes += value.length;
  if (bytes>4096) {await reader.cancel();throw Error('Anonymous response exceeded bound');}
  data.push(Buffer.from(value));
}
if (!Buffer.concat(data).includes('<Code>AccessDenied</Code>')) throw Error('Wrong anonymous storage response');
console.log(JSON.stringify({anonymousObjectDenied:true,passiveEngineHealthy:true}));
"""


def _deadline_expired(_number, _frame):
    raise SwitchConflict("Fresh Compose native smoke exceeded its overall deadline")


def _same_except_web(before, after):
    require(before["services"]["app"]["image"].rsplit("@", 1)[1] != after["services"]["app"]["image"].rsplit("@", 1)[1],
            "Select a distinct candidate Web content digest")
    normalized = deepcopy(after)
    normalized["services"]["app"]["image"] = before["services"]["app"]["image"]
    require(canonical(normalized) == canonical(before), "Fresh smoke candidate changes another effective Compose setting")


def _validate_fixture_model(model, *, project, directory, images):
    stock_shape = deepcopy(model)
    network = stock_shape["networks"]["default"]
    require(network.pop("internal", None) is True, "Fresh smoke requires an isolated internal network")
    caddy = stock_shape["services"]["caddy"]
    require(not caddy.get("ports"), "Fresh smoke must have no Docker-published port")
    caddy["ports"] = [{"target": port, "published": str(port)} for port in (80, 443)]
    binds = caddy["volumes"]
    fixture = [mount for mount in binds if mount["target"] == "/fixture"]
    require(len(fixture) == 1 and fixture[0]["type"] == "bind" and fixture[0]["read_only"] is True
            and fixture[0]["source"] == str(directory / "tls"), "Fresh smoke requires its own read-only TLS mount")
    binds.remove(fixture[0])
    _validate(stock_shape, project, directory, images)


def _native_host():
    require(platform.system() == "Linux" and platform.machine() in ("x86_64", "amd64"),
            "Native fresh Compose requires a Linux AMD64 host")


def _write_env(path, values):
    require(all(isinstance(value, str) and "\n" not in value and "\r" not in value for value in values.values()),
            "Synthetic Compose values must each occupy one line")
    _directory(path.parent)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.path.samestat(os.fstat(directory), path.parent.lstat()), "Private fixture directory changed")
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            info = os.fstat(output.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                    and stat.S_IMODE(info.st_mode) == 0o600, "Private single-link fixture environment required")
            raw = "".join(f"{key}={value}\n" for key, value in sorted(values.items()))
            require(output.write(raw) == len(raw), "Incomplete fixture environment write")
            output.flush()
            os.fsync(output.fileno())
            require(os.path.samestat(info, path.lstat()) and os.fstat(output.fileno()).st_nlink == 1
                    and os.path.samestat(os.fstat(directory), path.parent.lstat()), "Private fixture environment changed")
        os.fsync(directory)
    finally:
        os.close(directory)


class FreshSmoke:
    def __init__(self, docker, directory, baseline, candidate):
        self.docker, self.directory = docker, directory
        self.project = "wd-fresh-" + secrets.token_hex(8)
        self.network = self.project + "_default"
        self.volume_names = {f"{self.project}_{name}" for mounts in VOLUME_MOUNTS.values() for name in mounts}
        self.refs = {"baseline": baseline, "candidate": candidate}
        self.images, self.revisions = {}, {}
        self.overlay = directory / "fixture.yml"
        self.compose_files = tuple(ROOT / name for name in COMPOSE)
        self.configuration_pins = {}
        self.seed = str(uuid.uuid4())
        self.object_bytes = ("fresh compose object " + self.seed).encode()
        self.tls = directory / "tls"
        self.receipt = {"schemaVersion": 1, "kind": "warpdrive-native-fresh-compose-smoke", "project": self.project,
                        "success": False, "deploymentAuthorized": False, "checks": {}, "cleanupSuccess": False}

    def _preloaded(self):
        require(self.docker.run(["info", "--format", "{{.OSType}} {{.Architecture}}"], timeout=10).stdout.strip()
                in {"linux x86_64", "linux amd64"}, "Native fresh Compose requires a Linux AMD64 Docker daemon")
        for phase, references in self.refs.items():
            self.images[phase] = {}
            for service, reference in references.items():
                rows = self.docker.json(["image", "inspect", reference], timeout=10)
                require(len(rows) == 1 and reference in (rows[0].get("RepoDigests") or [])
                        and rows[0].get("Os") == "linux" and rows[0].get("Architecture") == "amd64"
                        and re.fullmatch(r"sha256:[a-f0-9]{64}", rows[0]["Id"]), "Exact local digest-pinned AMD64 fixture image required")
                self.images[phase][service] = rows[0]["Id"]
                if service == "app":
                    self.revisions[phase] = image_metadata(rows, None)["revision"]
        require(self.images["baseline"]["app"] != self.images["candidate"]["app"]
                and self.revisions["baseline"] != self.revisions["candidate"], "Two distinct source-bound Web images required")

    def compose(self, phase, *arguments, timeout=45):
        self._verify_configuration()
        argv = ["compose", "--project-name", self.project, "--project-directory", str(self.directory),
                "--env-file", str(self.directory / f"{phase}.env")]
        for source in (*self.compose_files, self.overlay):
            argv += ["--file", str(source)]
        return self.docker.run([*argv, *arguments], timeout=timeout).stdout

    def _verify_configuration(self):
        for path, expected in self.configuration_pins.items():
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                    and not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) and path.resolve(strict=True) == path
                    and info.st_size <= 512 * 1024 and sha256(path.read_bytes()).hexdigest() == expected,
                    "Prepared fresh Compose configuration changed")

    def prepare(self):
        fixture = ImageSmoke(self.docker, {"web": self.refs["baseline"]["app"], "worker": self.refs["baseline"]["worker"],
            "realtime": self.refs["baseline"]["ws"], "migrator": self.refs["baseline"]["migrate"]}, self.directory)
        self.runtime_password = fixture.runtime_password
        self.newsletter_password = secrets.token_hex(24)
        self.bucket = "warpdrive-fresh"
        storage_credentials = {"MINIO_ACCESS_KEY": fixture.env["MINIO_ACCESS_KEY"], "MINIO_SECRET_KEY": fixture.env["MINIO_SECRET_KEY"]}
        self.storage_env = self.directory / "storage-fixture.env"
        _write_env(self.storage_env, {**storage_credentials, "MINIO_BUCKET": self.bucket, "FIXTURE_OBJECT": self.object_bytes.decode()})
        _write_env(self.directory / ".env", {**fixture.env, "BASE_URL": "https://127.0.0.1", "WS_PUBLIC_URL": "ws://ws:8080",
            "MINIO_ENDPOINT": "http://minio:9000", "MINIO_BUCKET": self.bucket, "MIGRATION_DATABASE_URL": fixture.migration_url})
        for phase, references in self.refs.items():
            _write_env(self.directory / f"{phase}.env", {**fixture.pg_env, "APP_DOMAIN": "127.0.0.1", "ACME_EMAIL": "fresh@example.invalid",
                "BASE_URL": "https://127.0.0.1", "NEWSLETTER_PUBLIC_DOMAIN": "news.example.invalid",
                "NEWSLETTER_POSTGRES_PASSWORD": self.newsletter_password, "MINIO_ACCESS_KEY": fixture.env["MINIO_ACCESS_KEY"],
                "MINIO_SECRET_KEY": fixture.env["MINIO_SECRET_KEY"], "MINIO_BUCKET": self.bucket,
                **{name: references[services[0]] for name, services in IMAGES.items()}})
        self.tls.mkdir(mode=0o755)
        key, cert = self.tls / "key.pem", self.tls / "cert.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                        "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", str(key), "-out", str(cert)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=True)
        key.chmod(0o444)
        cert.chmod(0o444)
        (self.directory / "Caddyfile").write_text(TLS, encoding="utf-8")
        (self.directory / "deploy/newsletters").mkdir(parents=True)
        (self.directory / "deploy/newsletters/Caddyfile").write_text("import /etc/caddy/Caddyfile\n", encoding="utf-8")
        self.overlay.write_text("services:\n  caddy:\n    ports: !reset []\n    volumes:\n      - "
                                + json.dumps(str(self.tls) + ":/fixture:ro") + "\nnetworks:\n  default:\n    internal: true\n", encoding="utf-8")
        source = {name: (ROOT / name).read_bytes() for name in COMPOSE}
        frozen = self.directory / "compose-inputs"
        frozen.mkdir(mode=0o700)
        self.compose_files = tuple(frozen / f"{index}.yml" for index in range(len(COMPOSE)))
        for path, raw in zip(self.compose_files, source.values(), strict=True):
            path.write_bytes(raw)
            path.chmod(0o600)
        require(all((ROOT / name).read_bytes() == raw for name, raw in source.items()),
                "Fresh Compose source changed during snapshot")
        files = (*self.compose_files, self.overlay, self.directory / ".env", self.directory / "baseline.env",
                 self.directory / "candidate.env", self.storage_env, key, cert, self.directory / "Caddyfile",
                 self.directory / "deploy/newsletters/Caddyfile")
        self.configuration_pins = {path: sha256(path.read_bytes()).hexdigest() for path in files}
        models = {phase: decode(self.compose(phase, "--profile", "newsletter-migrations", "config", "--format", "json").encode())
                  for phase in self.refs}
        for phase, model in models.items():
            _validate_fixture_model(model, project=self.project, directory=self.directory, images=self.refs[phase])
        _same_except_web(models["baseline"], models["candidate"])
        self.receipt["checks"]["model"] = {phase: content_hash(model) for phase, model in models.items()}
        self.receipt["checks"]["configurationSha256"] = content_hash({
            str(path.relative_to(self.directory)): pin for path, pin in self.configuration_pins.items()
        })

    def _ids(self):
        return self.docker.run(["ps", "-a", "--no-trunc", "--filter", f"label={OWNER}={self.project}", "--format", "{{.ID}}"], timeout=10).stdout.splitlines()

    def _rows(self):
        self._verify_configuration()
        ids = self._ids()
        require(len(ids) <= 16 and all(EXACT_ID.fullmatch(value) for value in ids), "Exact bounded fixture containers required")
        if not ids:
            return {}
        rows = self.docker.json(["container", "inspect", *ids], timeout=12)
        result = {}
        for row in rows:
            labels = row["Config"]["Labels"]
            name = labels[SERVICE]
            require(labels[OWNER] == self.project and name in self.refs["baseline"] and name not in result
                    and row["Id"] in ids and not row["HostConfig"].get("PortBindings")
                    and row["Image"] in {phase[name] for phase in self.images.values()}, "Foreign or publicly exposed fixture container")
            result[name] = row
        return result

    def _resources(self, kind):
        return self.docker.run([kind, "ls", "--filter", f"label={OWNER}={self.project}", "--format", "{{.Name}}"], timeout=10).stdout.splitlines()

    def _require_empty(self):
        require(not self._ids() and not self._resources("network") and not self._resources("volume"), "Fresh smoke project already has resources")
        for kind, names in (("network", {self.network}), ("volume", self.volume_names)):
            present = self.docker.run([kind, "ls", "--format", "{{.Name}}"], timeout=10).stdout.splitlines()
            require(not names.intersection(present), "Fresh smoke resource name is already in use")

    def _sql(self, statement, *, database="warpdrive_image_smoke", user="smoke", check=True):
        postgres = self._rows()["postgres"]["Id"]
        return self.docker.run(["exec", "-i", postgres, "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database],
                               timeout=15, check=check, input_bytes=statement.encode())

    def _provision(self):
        self.compose("baseline", "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "40", "postgres", "minio")
        postgres = self._rows()["postgres"]["Id"]
        deadline = time.monotonic() + 15
        while self.docker.run(["exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "smoke", "-d", "warpdrive_image_smoke"],
                              timeout=4, check=False).returncode != 0:
            require(time.monotonic() < deadline, "Owned PostgreSQL TCP readiness unavailable")
            time.sleep(0.5)
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "migrate")
        self._completed("migrate", 150)
        self._sql(f"CREATE ROLE smoke_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '{self.runtime_password}';\n"
                  + RUNTIME_GRANTS + f"CREATE ROLE warpdrive_newsletters LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{self.newsletter_password}';\n"
                  "CREATE DATABASE warpdrive_newsletters OWNER warpdrive_newsletters;\nREVOKE CONNECT ON DATABASE warpdrive_newsletters FROM PUBLIC;\n")
        denied = self._sql("CREATE TABLE public.fresh_ddl_must_fail(id int);", user="smoke_runtime", check=False)
        require(denied.returncode == 3 and b"permission denied" in denied.stderr, "Runtime fixture role unexpectedly has DDL authority")
        self.compose("baseline", "--profile", "newsletter-migrations", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "newsletter-engine-migrate")
        self._completed("newsletter-engine-migrate", 100)
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "createbuckets")
        self._completed("createbuckets", 45)
        require(self._sql("SELECT count(*) FROM pipelines;").stdout == b"0\n", "Synthetic seed needs a fresh CRM database")
        self._sql(f"BEGIN;\nINSERT INTO pipelines(id,name) VALUES('{self.seed}','Fresh Compose qualification');\n"
                  f"INSERT INTO stages(pipeline_id,name) VALUES('{self.seed}','Qualified');\nCOMMIT;\n", user="smoke_runtime")
        self._object("seed")
        self.compose("baseline", "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app", "ws", "worker", "newsletter-engine", "caddy")

    def _completed(self, service, timeout):
        row = self._rows()[service]
        result = self.docker.run(["wait", row["Id"]], timeout=timeout).stdout.strip()
        seen = self._rows()[service]
        require(result == "0" and row["Id"] == seen["Id"] and seen["State"]["Status"] == "exited"
                and seen["State"]["ExitCode"] == 0, "Fresh Compose one-shot service did not complete")

    def _object(self, mode):
        # Use the already provisioned owned object store, without pulling or a public port.
        self._verify_configuration()
        require(self._rows()["minio"]["Image"] == self.images["baseline"]["minio"], "Exact owned object store required")
        seed = "printf %s \"$FIXTURE_OBJECT\" | mc pipe \"local/$MINIO_BUCKET/fixture.txt\" >/dev/null; " if mode == "seed" else ""
        script = ('mc alias set local http://minio:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null; '
                  + seed + 'mc cat "local/$MINIO_BUCKET/fixture.txt"')
        options = ["run", "--rm", "--pull", "never", "--network", self.network, "--label", f"{OWNER}={self.project}",
                   "--label", f"{SERVICE}=createbuckets", "--entrypoint", "/bin/sh", "--env-file", str(self.storage_env)]
        result = self.docker.run([*options, self.images["baseline"]["createbuckets"], "-ec", script], timeout=15)
        require(result.stdout == self.object_bytes.decode(), "Owned private fixture object did not round trip")

    def _public_response(self, port, path):
        context = ssl.create_default_context(cafile=str(self.tls / "cert.pem"))
        connection = HTTPSConnection("127.0.0.1", port, timeout=4, context=context)
        try:
            connection.request("GET", path, headers={"Accept": "application/json", "Connection": "close"})
            response = connection.getresponse()
            raw = response.read(2049)
            require(len(raw) <= 2048, "Fresh Compose ingress response exceeded its bound")
            return response.status, raw
        finally:
            connection.close()

    def _public(self, port, path):
        status, raw = self._public_response(port, path)
        require(status == 200, "Fresh Compose health or Web identity unavailable")
        return decode(raw)

    def _ready_rows(self, phase):
        deadline = time.monotonic() + 60
        while True:
            rows = self._rows()
            require(set(rows) == self.refs[phase].keys(), "Fresh Compose runtime inventory differs")
            for name, row in rows.items():
                state = row["State"]
                require(row["Image"] == self.images[phase][name] and state["Running"] is (name in LONG_RUNNING)
                        and row["RestartCount"] == 0 and (name in LONG_RUNNING or (state["Status"], state["ExitCode"]) == ("exited", 0)),
                        "Fresh Compose service identity or state differs")
            statuses = [rows[name]["State"].get("Health", {}).get("Status") for name in ("postgres", "app", "ws")]
            require(all(status in {"starting", "healthy"} for status in statuses), "Fresh Compose required healthcheck is absent or unhealthy")
            if all(status == "healthy" for status in statuses):
                return rows
            require(time.monotonic() < deadline, "Fresh Compose startup healthchecks did not become healthy")
            time.sleep(0.5)

    def _bun_probe(self, row, script, timeout):
        result = self.docker.run(["exec", row["Id"], "bun", "--no-env-file", "-e", script], timeout=timeout)
        return decode(result.stdout.encode())

    @staticmethod
    def _witness(rows):
        return {name: (row["Id"], row["Image"], row["State"]["StartedAt"], row["RestartCount"]) for name, row in rows.items()}

    def _observe(self, relay, phase):
        port = int(relay.authority.rsplit(":", 1)[1])
        deadline = time.monotonic() + 50
        while True:
            try:
                health = self._public(port, "/api/health")
                identity = self._public(port, "/api/runtime/web-identity")
                require(health == {"ok": True} and identity["sourceRevision"] == self.revisions[phase]
                        and identity["contract"] == "warpdrive.web.identity.v1" and identity["component"] == "web",
                        "Fresh public Web generation differs")
                break
            except (OSError, HTTPException, ValueError, KeyError, SwitchConflict):
                require(time.monotonic() < deadline, "Fresh Compose public Web did not become ready")
                time.sleep(0.5)
        rows = self._ready_rows(phase)
        caddy = rows["caddy"]
        mounts = {mount["Destination"]: (mount["Source"], mount["RW"]) for mount in caddy["Mounts"] if mount["Type"] == "bind"}
        require(caddy["Config"]["Cmd"] == ["caddy", "run", "--config", "/etc/caddy/warpdrive-newsletters", "--adapter", "caddyfile"]
                and mounts == {"/etc/caddy/Caddyfile": (str(self.directory / "Caddyfile"), False),
                               "/etc/caddy/warpdrive-newsletters": (str(self.directory / "deploy/newsletters/Caddyfile"), False),
                               "/fixture": (str(self.tls), False)}
                and (self.directory / "Caddyfile").read_text(encoding="utf-8") == TLS,
                "Owned Caddy startup config or mounts differ")
        require(self._bun_probe(rows["app"], APP_PEER_PROBE, 20) == {"anonymousObjectDenied": True, "passiveEngineHealthy": True},
                "Fresh Compose passive engine or private storage readback differs")
        stored = self._sql(f"SELECT name FROM pipelines WHERE id='{self.seed}';\nSELECT count(*) FROM stages WHERE pipeline_id='{self.seed}';\n"
                           "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id;").stdout.splitlines()
        require(len(stored) > 2 and stored[0:2] == [b"Fresh Compose qualification", b"1"]
                and all(re.fullmatch(rb"[a-f0-9]{64}", item) for item in stored[2:]),
                "Fresh Compose database witness differs")
        self._object("read")
        ledger = {"rows": len(stored) - 2, "sha256": sha256(b"\n".join(stored[2:])).hexdigest()}
        witness = self._witness(rows)
        require(self._witness(self._ready_rows(phase)) == witness, "Fresh Compose service changed during health or data readback")
        return witness, ledger

    def _baseline_readiness(self):
        rows = self._ready_rows("baseline")
        require(self._bun_probe(rows["ws"], WS_PROBE, 10) == {"unauthenticatedCloseCode": 4401},
                "Fresh Compose Realtime did not enforce unauthenticated WebSocket rejection")
        require(self._bun_probe(rows["worker"], WORKER_PROBE, 45) == {"completed": True},
                "Fresh Compose Worker did not consume its owned queue job")
        return {"realtimeCloseCode": 4401, "workerFileReaperCompleted": True}

    def _confirm_candidate_stopped(self, relay, admitted):
        require(self._witness(self._ready_rows("candidate")) == admitted,
                "Candidate or retained services changed before failure injection")
        self.docker.run(["stop", "--time", "20", admitted["app"][0]], timeout=30)
        rows = self._rows()
        require(set(rows) == set(admitted) and rows["app"]["State"]["Running"] is False
                and rows["app"]["State"]["Status"] == "exited" and self._witness(rows) == admitted,
                "Stopped candidate or retained service identity is unresolved")
        port = int(relay.authority.rsplit(":", 1)[1])
        status, _ = self._public_response(port, "/api/runtime/web-identity")
        after = self._rows()
        require(status == 502 and self._witness(after) == admitted and after["app"]["State"]["Status"] == "exited"
                and all(after[name]["State"]["Running"] is True for name in LONG_RUNNING - {"app"}),
                "Fresh Compose candidate failure is not proven through the retained ingress")
        return {"candidateStopped": True, "ingressStatus": status}

    def exercise(self):
        self._provision()
        name = self._rows()["caddy"]["Name"].removeprefix("/")
        with owned_bridge_forwarder(self.docker, owner_label=OWNER, owner=self.project, network_name=self.network,
                                    container_name=name, port=SERVICE_PORT, max_connections=4) as relay:
            readiness = self._baseline_readiness()
            initial, ledger = self._observe(relay, "baseline")
            self.receipt["checks"]["baseline"] = {"revision": self.revisions["baseline"], "migrationLedger": ledger, **readiness}
            current = initial
            for phase in ("candidate", "baseline"):
                if phase == "baseline":
                    self.receipt["checks"]["injectedFailure"] = self._confirm_candidate_stopped(relay, current)
                self.compose(phase, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "app")
                observed, confirmed = self._observe(relay, phase)
                require(confirmed == ledger and observed["app"][0] != current["app"][0]
                        and {**observed, "app": initial["app"]} == initial,
                        "Web selection changed a retained service, migration ledger or startup identity")
                self.receipt["checks"]["candidate" if phase == "candidate" else "rollback"] = {
                    "revision": self.revisions[phase], "retainedServicesUnchanged": True, "databaseAndObjectContinuity": True}
                current = observed

    def cleanup(self):
        # Only remove inspected IDs and verified project-owned local volumes.
        ids = self._ids()
        require(len(ids) <= 16 and len(ids) == len(set(ids)) and all(EXACT_ID.fullmatch(item) for item in ids),
                "Fresh smoke cleanup could not select exact IDs")
        rows = self.docker.json(["container", "inspect", *ids], timeout=10) if ids else []
        require({row["Id"] for row in rows} == set(ids) and len(rows) == len(ids) and all(row["Config"]["Labels"][OWNER] == self.project
                and row["Config"]["Labels"].get(SERVICE) in self.refs["baseline"] and row["Id"] in ids
                and row["Image"] in {phase[row["Config"]["Labels"][SERVICE]] for phase in self.images.values()} for row in rows),
                "Fresh smoke cleanup found unowned containers")
        network, volumes = self._resources("network"), self._resources("volume")
        require(set(network) <= {self.network} and set(volumes) <= self.volume_names, "Fresh smoke cleanup found unowned storage")
        network_id = None
        if network:
            selected, = self.docker.json(["network", "inspect", self.network], timeout=10)
            require(selected["Labels"][OWNER] == self.project and selected["Name"] == self.network and selected["Internal"] is True
                    and EXACT_ID.fullmatch(selected["Id"]) and set(selected.get("Containers") or {}) <= set(ids),
                    "Fresh smoke network has foreign references")
            network_id = selected["Id"]
        for name in volumes:
            self._verify_volume(name, allowed=set(ids))
        for row in rows:
            if row["State"]["Running"]:
                self.docker.run(["stop", "--time", "20", row["Id"]], timeout=30)
            self.docker.run(["container", "rm", row["Id"]], timeout=10)
        if network_id is not None:
            self.docker.run(["network", "rm", network_id], timeout=10)
        for name in volumes:
            self._verify_volume(name, allowed=set())
            self.docker.run(["volume", "rm", name], timeout=10)
        require(not self._ids() and not self._resources("network") and not self._resources("volume"), "Fresh smoke cleanup is incomplete")

    def _verify_volume(self, name, *, allowed):
        row, = self.docker.json(["volume", "inspect", name], timeout=10)
        require(row["Name"] == name and row["Labels"][OWNER] == self.project and row["Driver"] == "local" and not row.get("Options"),
                "Fresh smoke volume ownership differs")
        holders = self.docker.run(["ps", "-a", "--no-trunc", "--filter", f"volume={name}", "--format", "{{.ID}}"], timeout=10).stdout.splitlines()
        require(set(holders) <= allowed, "Fresh smoke volume has foreign references")


def run(baseline, candidate):
    _native_host()
    _same_except_web({"services": {name: {"image": ref} for name, ref in baseline.items()}},
                     {"services": {name: {"image": ref} for name, ref in candidate.items()}})
    previous_handler = signal.signal(signal.SIGALRM, _deadline_expired)
    signal.alarm(TOTAL_SECONDS)
    try:
        with TemporaryDirectory(prefix="wd-fresh-compose-") as scratch:
            fixture = FreshSmoke(Docker(), Path(scratch).resolve(), baseline, candidate)
            fixture._preloaded()
            fixture.prepare()
            fixture._require_empty()
            try:
                fixture.exercise()
                fixture.receipt["success"] = True
            except (OSError, KeyError, ValueError, TypeError, SwitchConflict, SmokeError, ForwarderError) as error:
                fixture.receipt["failure"] = type(error).__name__
            finally:
                signal.alarm(120)
                try:
                    fixture.cleanup()
                    fixture.receipt["cleanupSuccess"] = True
                except (OSError, KeyError, ValueError, TypeError, SwitchConflict, SmokeError) as error:
                    fixture.receipt["cleanupFailure"] = type(error).__name__
                    fixture.receipt["success"] = False
            return fixture.receipt
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", action="store_true", required=True)
    for phase in ("baseline", "candidate"):
        parser.add_argument(f"--{phase}-env", required=True, type=Path)
        parser.add_argument(f"--{phase}-env-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(_pinned_images(args.baseline_env, args.baseline_env_sha256),
                     _pinned_images(args.candidate_env, args.candidate_env_sha256))
    except (OSError, KeyError, TypeError, ValueError, SwitchConflict, SmokeError, subprocess.SubprocessError) as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
