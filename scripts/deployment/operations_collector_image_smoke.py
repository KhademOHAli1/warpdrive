"""Qualify the exact standalone Operations Collector image on disposable local Docker."""

import argparse
import base64
import json
from pathlib import Path
import secrets
import sys
import uuid

from image_smoke import (
    COMPONENTS, OWNER_LABEL, Docker, ImageSmoke, SmokeError, image_metadata, utc_now, validate_reference,
    validate_revision,
)


CONFIG_PATH = "/run/warpdrive-operations-config.json"
SOCKET_DIRECTORY = "/run/warpdrive-operations"
SOCKET_PATH = SOCKET_DIRECTORY + "/collector.sock"
COMMAND = ["bun", "--no-env-file", "dist/operations-collector.mjs", CONFIG_PATH]
ROLE = "smoke_operations_collector"

SEED = r"""
import { chmodSync, chownSync, mkdirSync, writeFileSync } from 'node:fs';
const raw = await Bun.stdin.bytes();
if (process.getuid() !== 0 || raw.length === 0 || raw.length > 8192) throw Error('Invalid fixture staging');
mkdirSync('/fixture-config/warpdrive-operations', {mode:0o755});
writeFileSync('/fixture-config/warpdrive-operations-config.json', raw, {mode:0o400,flag:'wx'});
chownSync('/fixture-config/warpdrive-operations-config.json',1000,1000);
chmodSync('/fixture-config',0o755);
chmodSync('/fixture-socket',0o700);
chownSync('/fixture-socket',1000,1000);
"""

PACKAGING = r"""
import { existsSync, lstatSync, readdirSync } from 'node:fs';
if (process.getuid() !== 1000 || process.getgid() !== 1000 || process.cwd() !== '/app') throw Error('Invalid collector UID or working directory');
for (const path of ['src','.next','drizzle','scripts','next.config.ts','next.config.mjs','.env','.env.local','.env.production','.env.production.local','node_modules/@ui-sdk']) {
  if (existsSync('/app/'+path)) throw Error('Unwanted source, build or environment in final collector');
}
if (readdirSync('/app/dist').join(',') !== 'operations-collector.mjs') throw Error('Unexpected collector outputs');
const config = lstatSync('/run/warpdrive-operations-config.json');
const socket = lstatSync('/run/warpdrive-operations/collector.sock');
const directory = lstatSync('/run/warpdrive-operations');
if (!config.isFile() || config.uid !== 1000 || config.nlink !== 1 || (config.mode & 0o7777) !== 0o400 ||
    !socket.isSocket() || socket.uid !== 1000 || (socket.mode & 0o7777) !== 0o600 ||
    !directory.isDirectory() || directory.uid !== 1000 || (directory.mode & 0o7777) !== 0o700)
  throw Error('Invalid private fixture transport');
for (const name of ['DATABASE_URL','MIGRATION_DATABASE_URL','POSTGRES_PASSWORD','AUTH_SECRET','TOKEN_ENCRYPTION_KEY'])
  if (process.env[name]) throw Error('Private runtime environment was not isolated');
console.log(JSON.stringify({uid:1000,gid:1000,isolatedPackaging:true,privateSocket:true}));
"""

WAIT_SOCKET = r"""
const info = require('node:fs').lstatSync('/run/warpdrive-operations/collector.sock');
if (!info.isSocket() || info.uid !== 1000 || (info.mode & 0o7777) !== 0o600) process.exit(1);
"""

SOCKET_ABSENT = r"""
import { lstatSync, readdirSync } from 'node:fs';
const path = '/run/warpdrive-operations';
const directory = lstatSync(path);
if (process.getuid() !== 1000 || !directory.isDirectory() || directory.uid !== 1000 ||
    (directory.mode & 0o7777) !== 0o700 || readdirSync(path).length !== 0)
  throw Error('Private socket directory was not cleared');
"""

SIGNED_SOCKET = r"""
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
const config = JSON.parse(readFileSync('/run/warpdrive-operations-config.json','utf8'));
const {binding,signingKey} = config.sources[0];
const target = '/api/internal/operations/observations';
const mode = process.argv[1];
const batch = (sequence,state,reason) => ({schemaVersion:2,generationId:binding.generationId,sequence,
  observedAtMs:Date.now(),observations:[{kind:'observer',observer:'host_collector',state,reason}]});
function send(body, bad = false) {
  return new Promise((resolve,reject) => {
    const stamp = String(Date.now());
    const prefix = ['warpdrive.operations.collector.v1','POST',target,binding.installationId,binding.sourceId,
                    binding.generationId,stamp,''].join('\n');
    const digest = bad ? '0'.repeat(64) : createHmac('sha256',Buffer.from(signingKey,'base64url'))
      .update(prefix).update(body).digest('hex');
    const head = [`POST ${target} HTTP/1.1`,'Host: warpdrive-operations.local','Connection: close',
                  'Content-Type: application/json',`Content-Length: ${Buffer.byteLength(body)}`,
                  `X-Warpdrive-Collector-Source: ${binding.sourceId}`,`X-Warpdrive-Collector-Timestamp: ${stamp}`,
                  `X-Warpdrive-Collector-Signature: v1=${digest}`,'',''].join('\r\n');
    const socket = createConnection(config.socketPath);
    socket.setTimeout(6000,() => socket.destroy(new Error('Fixture collector response timed out')));
    let reply = '';
    socket.setEncoding('utf8');
    socket.once('connect',() => socket.write(head+body));
    socket.on('data',chunk => {
      reply += chunk;
      if (reply.length > 8192) socket.destroy(new Error('Fixture collector response too large'));
    });
    socket.once('error',reject);
    socket.once('close',() => resolve(Number(/^HTTP\/1\.1 ([0-9]{3})\b/u.exec(reply)?.[1])));
  });
}
if (mode === 'initial') {
  const first = batch(1,'failed','check_failed');
  const body = JSON.stringify(first);
  assert.equal(await send(body,true),404);
  assert.equal(await send(body),204);
  assert.equal(await send(body),204);
  assert.equal(await send(JSON.stringify({...first,observations:batch(1,'healthy','ok').observations})),409);
  console.log(JSON.stringify({badSignatureDenied:true,accepted:true,replayAccepted:true,conflictDenied:true,body}));
} else if (mode === 'restarted') {
  const prior = await Bun.stdin.text();
  assert(prior.length > 0 && prior.length <= 1024);
  assert.equal(await send(prior),204);
  assert.equal(await send(JSON.stringify(batch(2,'healthy','ok'))),204);
  console.log(JSON.stringify({replayAfterRestart:true,recoveryAccepted:true}));
} else throw Error('Unexpected collector fixture phase');
"""


class OperationsCollectorImageSmoke(ImageSmoke):
    def __init__(self, docker, images, collector_image, output_dir, revision):
        super().__init__(docker, images, output_dir, revision)
        self.collector_image = validate_reference(collector_image)
        self.collector_password = secrets.token_hex(24)
        self.signing_key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
        self.binding = {key: str(uuid.uuid4()) for key in ("installationId", "sourceId", "generationId")}
        self.report["kind"] = "warpdrive-optional-operations-collector-final-image-smoke"
        self.report["limitations"] = [
            "Disposable fresh PostgreSQL and synthetic source enrollment on isolated Docker.",
            "Fixture Docker volumes model the private config and socket mounts without using installed host paths.",
            "No installed collector, external alerts, provider sampling or recovery custody acceptance.",
        ]

    def inspect_images(self):
        result = super().inspect_images()
        raw = self.docker.json(["image", "inspect", self.collector_image])
        image = image_metadata(raw, self.expected_revision)
        config = raw[0]["Config"]
        if (raw[0].get("Os"), raw[0].get("Architecture"), image["user"], config.get("Cmd")) != (
                "linux", "amd64", "1000:1000", COMMAND) or any(config.get(key) for key in ("ExposedPorts", "Volumes")):
            raise SmokeError("Collector final image has an unexpected native command or exposure profile")
        if image["id"] in {component["id"] for component in self.report["images"].values()}:
            raise SmokeError("Collector final image must be distinct from the fixture component images")
        self.report["collectorImage"] = image
        return {**result, "collector": image}

    def database(self):
        binding = self.binding
        statements = (
            "BEGIN; REVOKE CREATE ON SCHEMA public FROM PUBLIC; "
            f"CREATE ROLE {ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT "
            f"PASSWORD '{self.collector_password}'; GRANT USAGE ON SCHEMA public TO {ROLE}; "
            f"GRANT SELECT ON operations_installation TO {ROLE}; "
            "GRANT SELECT,INSERT,UPDATE,DELETE ON operations_current,operations_incidents,operations_receipts,"
            f"operations_sources,operations_transitions TO {ROLE}; "
            f"INSERT INTO operations_installation(installation_id) VALUES('{binding['installationId']}'); "
            "INSERT INTO operations_sources(id,installation_id,current_generation_id,role) "
            f"VALUES('{binding['sourceId']}','{binding['installationId']}','{binding['generationId']}','host_collector'); COMMIT;"
        )
        self.docker.run(["exec", "-i", self.containers["postgres"], "psql", "-X", "-q", "-U", "smoke", "-d",
                         "warpdrive_image_smoke", "-v", "ON_ERROR_STOP=1", "-f", "-"], input_bytes=statements.encode())
        return {"restrictedRole": ROLE, "sourceRole": "host_collector", "syntheticEnrollment": True}

    def sql(self, statement):
        return self.docker.run(["exec", self.containers["postgres"], "psql", "-X", "-Atq", "-U", "smoke", "-d",
                                "warpdrive_image_smoke", "-v", "ON_ERROR_STOP=1", "-c", statement]).stdout.strip()

    def signed_probe(self, name, mode, *, previous=None):
        if previous is None:
            return self.probe(name, SIGNED_SOCKET, "--", mode, timeout=25)
        if not isinstance(previous, bytes) or not 0 < len(previous) <= 1024:
            raise SmokeError("Exact first signed batch bytes required for restart replay")
        output = self.docker.run(["exec", "-i", name, "bun", "--no-env-file", "-e", SIGNED_SOCKET, "--", mode],
                                 input_bytes=previous, timeout=15)
        try:
            return json.loads(output.stdout)
        except (TypeError, ValueError) as error:
            raise SmokeError("Restarted collector probe result unavailable") from error

    def volume(self, label):
        name = f"{self.prefix}-{label}"
        self.resources.append(("volume", name))
        self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", name])
        return name

    @staticmethod
    def mount(name, target, *, readonly=False):
        return f"type=volume,source={name},target={target},volume-nocopy" + (",readonly" if readonly else "")

    def seed(self, label, socket_volume, url):
        config = self.volume(label)
        name = f"{self.prefix}-seed-{label}"
        self.resources.append(("container", name))
        data = {"databaseUrl": url, "socketPath": SOCKET_PATH,
                "sources": [{"binding": self.binding, "signingKey": self.signing_key}]}
        self.docker.run([
            "run", "--interactive", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.prefix}",
            "--network", "none", "--read-only", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "CHOWN",
            "--security-opt", "no-new-privileges", "--memory", "128m", "--memory-swap", "128m", "--pids-limit", "32",
            "--mount", self.mount(config, "/fixture-config"), "--mount", self.mount(socket_volume, "/fixture-socket"),
            self.report["collectorImage"]["id"], "bun", "--no-env-file", "-e", SEED,
        ], input_bytes=json.dumps(data, separators=(",", ":")).encode(), timeout=30)
        self.finished(name, 10)
        return config

    def start_collector(self, label, config_volume, socket_volume):
        name = f"{self.prefix}-{label}"
        self.resources.append(("container", name))
        self.containers[label] = name
        self.docker.run([
            "run", "--detach", "--init", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.prefix}",
            "--network", self.report["resources"]["network"], "--read-only", "--cap-drop", "ALL", "--security-opt",
            "no-new-privileges", "--memory", "384m", "--memory-swap", "384m", "--cpus", "1", "--pids-limit", "96",
            "--mount", self.mount(config_volume, "/run", readonly=True),
            "--mount", self.mount(socket_volume, SOCKET_DIRECTORY), self.report["collectorImage"]["id"],
        ], timeout=30)
        return name

    def verify_runtime(self, name, config_volume, socket_volume):
        raw = self.docker.json(["container", "inspect", name])
        if not isinstance(raw, list) or len(raw) != 1:
            raise SmokeError("Collector runtime identity unavailable")
        row = raw[0]
        host = row["HostConfig"]
        mounts = {(mount.get("Name"), mount.get("Destination"), mount.get("RW"), mount.get("Type"))
                  for mount in row["Mounts"]}
        if (row["Image"] != self.report["collectorImage"]["id"] or row["Config"]["Cmd"] != COMMAND
                or row["Config"]["User"] != "1000:1000" or row["Config"]["Labels"].get(OWNER_LABEL) != self.prefix
                or host.get("ReadonlyRootfs") is not True or host.get("Init") is not True
                or host.get("CapDrop") != ["ALL"] or host.get("PublishAllPorts") is not False or host.get("PortBindings")
                or host.get("Privileged") is not False
                or host.get("SecurityOpt") not in (["no-new-privileges"], ["no-new-privileges:true"], ["no-new-privileges=true"])
                or set(row["NetworkSettings"]["Networks"]) != {self.report["resources"]["network"]}
                or row["NetworkSettings"].get("Ports") or len(row["Mounts"]) != 2
                or mounts != {(config_volume, "/run", False, "volume"), (socket_volume, SOCKET_DIRECTORY, True, "volume")}):
            raise SmokeError("Collector runtime differs from the exact private final-image profile")

    def wait_socket(self, name):
        self.wait_for(lambda: self.docker.run(["exec", name, "bun", "--no-env-file", "-e", WAIT_SOCKET], check=False,
                                             timeout=5).returncode == 0, "private collector socket", 35, name)

    def stop_collector(self, name):
        self.docker.run(["stop", "--time", "30", name], timeout=35)
        state = self.state(name)
        if state["Running"] or state.get("OOMKilled") or state.get("ExitCode") != 0:
            raise SmokeError("Collector did not drain successfully")

    def require_socket_absent(self, label, socket_volume):
        name = self.start_container(label, self.report["collectorImage"]["id"], ["bun", "--no-env-file", "-e", SOCKET_ABSENT],
                                    environment={}, network="none", readonly=True, memory="128m",
                                    mount=self.mount(socket_volume, SOCKET_DIRECTORY, readonly=True))
        self.finished(name, 10)

    def collector(self):
        socket_volume = self.volume("collector-socket")
        owner_socket = self.volume("owner-socket")
        owner_config = self.seed("collector-owner", owner_socket, self.migration_url)
        rejected = self.start_collector("collector-owner", owner_config, owner_socket)
        code = self.docker.run(["wait", rejected], timeout=25).stdout.strip()
        state = self.state(rejected)
        if code != "1" or state["Running"] or state.get("OOMKilled") or state.get("ExitCode") != 1:
            raise SmokeError("Collector did not reject the owner credential before startup")
        self.require_socket_absent("owner-socket-absent", owner_socket)

        url = f"postgres://{ROLE}:{self.collector_password}@postgres:5432/warpdrive_image_smoke"
        config = self.seed("collector-restricted", socket_volume, url)
        name = self.start_collector("collector", config, socket_volume)
        self.verify_runtime(name, config, socket_volume)
        self.wait_socket(name)
        packaging = self.probe(name, PACKAGING, timeout=10)
        if packaging != {"uid": 1000, "gid": 1000, "isolatedPackaging": True, "privateSocket": True}:
            raise SmokeError("Final collector packaging proof differs")
        initial = self.signed_probe(name, "initial")
        previous = initial.pop("body", None) if type(initial) is dict else None
        if initial != {"badSignatureDenied": True, "accepted": True, "replayAccepted": True, "conflictDenied": True}:
            raise SmokeError("Signed collector acceptance, replay or denial proof differs")
        if not isinstance(previous, str) or not 0 < len(previous.encode()) <= 1024:
            raise SmokeError("Exact first signed collector batch proof is unavailable")
        source = self.binding["sourceId"]
        rows = f"FROM operations_receipts WHERE source_id='{source}'"
        if self.sql(f"SELECT count(*) || ':' || max(sequence) {rows};") != "1:1":
            raise SmokeError("Rejected or replayed collector batch changed durable receipts")
        self.stop_collector(name)
        self.require_socket_absent("collector-initial-socket-absent", socket_volume)
        self.docker.run(["start", name], timeout=15)
        self.verify_runtime(name, config, socket_volume)
        self.wait_socket(name)
        restarted = self.signed_probe(name, "restarted", previous=previous.encode())
        if restarted != {"replayAfterRestart": True, "recoveryAccepted": True}:
            raise SmokeError("Signed collector replay or recovery after restart differs")
        self.stop_collector(name)
        self.require_socket_absent("collector-socket-absent", socket_volume)
        if self.sql(f"SELECT count(*) || ':' || max(sequence) {rows}; "
                    f"SELECT count(*) FROM operations_incidents WHERE source_id='{source}' AND recovered_at IS NOT NULL; "
                    f"SELECT observation->>'state' FROM operations_current WHERE source_id='{source}' "
                    "AND observation_key='observer:host_collector';") != "2:2\n1\nhealthy":
            raise SmokeError("Collector durable recovery projection differs after graceful shutdown")
        return {**packaging, **initial, **restarted, "ownerRejected": True, "receiptCount": 2,
                "recoveredIncidentCount": 1, "gracefulStops": 2, "socketRemoved": True}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("exact-final-image-identities", self.inspect_images)
            self.check("disposable-isolation", self.create_environment)
            self.check("canonical-fresh-and-repeat-migration", self.migrations)
            self.check("restricted-collector-enrollment", self.database)
            self.check("private-signed-collector-restart-and-drain", self.collector)
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            # Setup includes private configuration bytes. Do not persist raw container output.
            errors = self.cleanup()
            self.report.update(success=self.report["failure"] is None and not errors, finishedAt=utc_now(),
                               cleanup={"success": not errors, "errors": errors})
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for component in (*COMPONENTS, "collector"):
        parser.add_argument(f"--{component}-image", required=True, type=validate_reference)
    parser.add_argument("--expected-revision", required=True, type=validate_revision)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    images = {component: getattr(args, f"{component}_image") for component in COMPONENTS}
    try:
        return 0 if OperationsCollectorImageSmoke(Docker(), images, args.collector_image, args.output_dir,
                                                   args.expected_revision).run() else 1
    except (OSError, ValueError, SmokeError) as error:
        print(f"Operations Collector image smoke admission failed ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
