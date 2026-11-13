"""Rehearse one final Core image across two Web generations on native Linux."""

import argparse
import json
from pathlib import Path
import platform
import re
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request

from caddy_core_config import CORE_PROBE_HEADER, CORE_READ_PATH, CORE_RESPONSE_HEADER, CORE_RESPONSE_MARKER, core_api_routes
from image_smoke import ImageSmoke, image_metadata, utc_now, validate_revision
from registry_smoke import IsolatedDocker
from web_mixed_image_smoke import HEADER, MixedWebSmoke
from web_switch import HASH, IMAGE, canonical, content_hash
from web_switch_smoke import MAX_HTTP_BYTES, MIB, require, runtime_config


CORE_MEMORY_MIB = 768
CORE_COMMAND = ["bun", "--no-env-file", "dist/core-api.mjs"]
PRODUCER_SQL = """SELECT coalesce(json_agg(row_to_json(witness) ORDER BY id),'[]'::json) FROM (
 SELECT id,pid,started_on,supervise,schedule,migrate,workers FROM pgboss.instance
 WHERE application_name='warpdrive-core-producer' AND stopped_on IS NULL LIMIT 2
) witness;"""
CORE_READY = "if (!(await fetch('http://127.0.0.1:3010/readyz',{signal:AbortSignal.timeout(2000)})).ok) process.exit(1)"


# The driver sends only generated fixture inputs on stdin. The session stays in
# controller memory, and the report retains only finite HTTP and database facts.
CORE_RPC_PROBE = r"""
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import {Client} from 'pg';
const {phase, active, retained, session, probeHeader, probeMarker, responseHeader, readPath, webGenerationHeader} = JSON.parse(await Bun.stdin.text());
const base = new URL(process.env.CORE_WEB_ORIGIN);
assert.match(base.href, /^http:\/\/wd-image-smoke-[a-f0-9]{12}-caddy:8080\/$/u);
const origin = new URL(process.env.BASE_URL).origin;
const db = new URL(process.env.DATABASE_URL);
assert.equal(db.hostname, 'postgres');
assert.equal(db.pathname, '/warpdrive_image_smoke');
assert.equal(db.username, 'smoke_runtime');
const request = (path, options={}) => fetch(new URL(path, base), {
  ...options, redirect:'manual', signal:AbortSignal.timeout(5000),
  headers:{'cache-control':'no-cache', origin, 'sec-fetch-site':'same-origin', ...options.headers},
});
const identity = await request('/api/runtime/web-identity');
assert.equal(identity.status, 200);
const meta = await identity.json();
assert.equal(meta.sourceRevision, active.slice(3));
assert.equal(meta.component, 'web');
const denied = await request(readPath, {headers:{[probeHeader]:probeMarker}});
assert.equal(denied.status, 401);
assert.equal(denied.headers.get(responseHeader), probeMarker);
assert.equal((await denied.json()).error.json.data.code, 'UNAUTHORIZED');
const sql = new Client({connectionString:db.href, connectionTimeoutMillis:3000, statement_timeout:3000});
await sql.connect();
try {
  let actor = session;
  if (actor === null) {
    assert.equal(phase, 'baseline');
    const id = randomUUID();
    const email = `${id}@example.invalid`;
    const password = randomBytes(32).toString('base64url');
    await sql.query('BEGIN');
    await sql.query("INSERT INTO users(id,email,name,is_admin,is_active) VALUES($1,$2,'Core mixed fixture',false,true)",[id,email]);
    await sql.query("INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,'Core mixed fixture',true,false)",[id,email]);
    await sql.query("INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",[id,id,await hashPassword(password)]);
    await sql.query('COMMIT');
    const login = await request('/api/auth/sign-in/email', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email,password}),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get(webGenerationHeader), active);
    const cookies = login.headers.getSetCookie().filter(value => value.startsWith('wd_sid='));
    assert.equal(cookies.length, 1);
    actor = {id, cookie:cookies[0].split(';',1)[0], csrf:randomBytes(32).toString('base64url')};
  }
  const cookie = `${actor.cookie}; wd_csrf=${actor.csrf}`;
  const version = await request(readPath, {headers:{cookie}});
  assert.equal(version.status, 200);
  assert.equal((await version.json()).result.data.json.current, meta.version);
  assert.equal(version.headers.get(webGenerationHeader), null);
  for (const generation of [active, retained]) {
    const ticket = await request('/api/trpc/realtime.ticket', {method:'POST',
      headers:{cookie,'content-type':'application/json','x-deployment-id':generation}, body:JSON.stringify({json:null})});
    assert.equal(ticket.status, 200);
    assert.equal(ticket.headers.get(webGenerationHeader), null);
    assert.match((await ticket.json()).result.data.json.ticket, /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/u);
  }
  const definition = {version:1,from:'2026-01-01',to:'2026-01-31',currency:'EUR',pipelineId:null,ownerScope:{kind:'me'}};
  const name = index => `Core mixed ${phase} ${index} ${actor.id}`;
  const path = '/api/trpc/stats.savedPerformance.create';
  const write = (generation, csrfToken, index) => request(path, {method:'POST',
    headers:{cookie,'content-type':'application/json','x-deployment-id':generation},
    body:JSON.stringify({json:{name:name(index),definition,csrfToken}}),
  });
  const reports = async () => (await sql.query(
    "SELECT name,owner_id FROM saved_filters WHERE target_entity='stats-performance-report' AND name=ANY($1) ORDER BY name",
    [[name(1), name(2), name(3), name(4)]],
  )).rows;
  assert.deepEqual(await reports(), []);
  const csrf = await write(active, null, 3);
  assert.equal(csrf.status, 403);
  assert.equal((await csrf.json()).error.json.data.code, 'FORBIDDEN');
  const unknown = ['0','1','2'].map(c => `wd-${c.repeat(40)}`).find(value => ![active, retained].includes(value));
  const stamp = await write(unknown, actor.csrf, 4);
  assert.equal(stamp.status, 409);
  assert.equal(stamp.headers.get('x-warpdrive-web-rejection'), 'before-forward');
  assert.deepEqual(await reports(), []);
  for (const [offset, generation] of [active, retained].entries()) {
    const response = await write(generation, actor.csrf, offset+1);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get(webGenerationHeader), null);
    assert.equal((await response.json()).result.data.json.state, 'created');
  }
  assert.deepEqual(await reports(), [1,2].map(index => ({name:name(index),owner_id:actor.id})));
  console.log(JSON.stringify({session:actor, sourceRevision:meta.sourceRevision, version:meta.version,
    anonymousDenied:true, csrfDenied:true, unknownStampRejected:true, realtimeTickets:2, durableOwnedReports:2}));
} finally {
  await sql.end();
}
"""


class CoreMixedImageSmoke(MixedWebSmoke):
    def __init__(self, docker, args, private):
        super().__init__(docker, args, private)
        require(not args.browser and not self.repeat, "Core mixed RPC fixture requires the original baseline and owned HTTP ingress")
        self.core_image, self.core_revision = args.core_image_id, args.core_revision
        self.baseline_preloaded = args.baseline_preloaded
        self.core = None
        self.session = None
        self.report.update(kind="warpdrive-native-mixed-core-image-smoke", limitations=[
            "Native Linux final images on a fresh owned PostgreSQL fixture and one internal bridge.",
            "Exercises Caddy/Web/retained backend and authenticated Core RPC without a browser, collector or Compose runtime.",
            "Caddy uses an ephemeral fixture config. Installed routing, deployment and populated upgrades remain outside this proof.",
        ])

    def load(self):
        assembly = super().load()
        self.assembly = {**assembly, "coreImage": self.report["coreImage"],
                         "baselineImageSource": "preloaded" if self.baseline_preloaded else "archive-load"}
        self.report["images"] = self.assembly
        return self.assembly

    def prepare_baseline_images(self, loaded, images):
        pins = (*images.values(), self.args.new_web_image_id, self.core_image)
        require(all(isinstance(pin, str) and IMAGE.fullmatch(pin) for pin in pins) and len(set(pins)) == len(pins),
                "Distinct immutable Core, Web and retained backend images required")
        rows = self.docker.json(["image", "inspect", self.core_image], timeout=10)
        identity = image_metadata(rows, self.core_revision)
        image, config = rows[0], rows[0]["Config"]
        require(identity["id"] == self.core_image and image.get("Os") == "linux" and image.get("Architecture") == "amd64"
                and config.get("Cmd") == CORE_COMMAND and config.get("ExposedPorts") == {"3010/tcp": {}}
                and not config.get("Volumes"), "Exact distinct native final Core image required")
        if not self.baseline_preloaded:
            self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.private / "fixture", expected_revision=self.revision)
        for component, pin in images.items():
            local = self.docker.json(["image", "inspect", pin], timeout=10)
            baseline = image_metadata(local, self.revision)
            require(baseline["id"] == pin and local[0].get("Os") == "linux" and local[0].get("Architecture") == "amd64"
                    and baseline["user"] == loaded["candidate"]["components"][component]["runtimeUser"],
                    "Local baseline image metadata differs from the pinned native bundle")
            self.fixture.report["images"][component] = baseline
        self.report["coreImage"] = identity

    def runtime_memory_limit(self):
        return super().runtime_memory_limit() + CORE_MEMORY_MIB * MIB

    def compile_documents(self, adapted, before, after):
        documents = super().compile_documents(adapted, before, after)
        core_alias = self.fixture.prefix + "-core"
        for current, retained in ((before, after), (after, before)):
            document = documents[current.deployment_id]
            server, = document["apps"]["http"]["servers"].values()
            slots = [handler for route in server["routes"] for handler in route["handle"]
                     if handler.get("handler") == "subroute"]
            require(len(slots) == 1, "One compiled mixed Web fallback is required")
            slots[0]["routes"][0:0] = core_api_routes(core_alias, current, retained)
            require(len(canonical(document)) <= MAX_HTTP_BYTES, "Compiled Core fixture configuration exceeds its byte bound")
        return documents

    def _database(self, sql):
        name = self.fixture.containers["postgres"]
        self.owned(name)
        result = self.docker.run(["exec", name, "psql", "-XqAt", "-U", "smoke", "-d", "warpdrive_image_smoke",
                                  "-v", "ON_ERROR_STOP=1", "-c", sql], timeout=10).stdout.strip()
        require(0 < len(result.encode()) <= 8192, "Core database witness exceeds its byte bound")
        return json.loads(result)

    def _producer(self):
        rows = self._database(PRODUCER_SQL)
        require(type(rows) is list and len(rows) <= 1, "Only one Core producer generation is permitted")
        if not rows:
            return None
        producer = rows[0]
        require(type(producer) is dict and set(producer) == {"id", "pid", "started_on", "supervise", "schedule", "migrate", "workers"}
                and type(producer["pid"]) is int and producer["pid"] > 0 and isinstance(producer["started_on"], str)
                and re.fullmatch(r"[0-9a-f-]{36}", producer["id"]) and producer["workers"] == []
                and all(producer[key] is False for key in ("supervise", "schedule", "migrate")),
                "Core producer must keep its identity and never consume, supervise, schedule or migrate")
        return producer

    def _core_runtime(self):
        row = self.owned(self.core)
        state, host = row["State"], row["HostConfig"]
        network = self.fixture.report["resources"]["network"]
        require(row["Image"] == self.core_image and row["Config"]["Cmd"] == CORE_COMMAND
                and state["Running"] is True and not state["OOMKilled"] and not state["Paused"]
                and type(state["Pid"]) is int and state["Pid"] > 0 and row["RestartCount"] == 0
                and host["ReadonlyRootfs"] is True and host["CapDrop"] == ["ALL"] and not host.get("PortBindings")
                and set(row["NetworkSettings"]["Networks"]) == {network} and not row["Mounts"],
                "Core runtime differs from the private exact final image")
        return {"runtimeId": row["Id"], "imageId": row["Image"], "pid": state["Pid"], "startedAt": self.started(row),
                "configSha256": content_hash(runtime_config(row))}

    def protected_runtimes(self):
        protected = super().protected_runtimes()
        if self.core is not None:
            protected["core"] = self._core_runtime()
        return protected

    def setup_runtimes(self):
        evidence = super().setup_runtimes()
        original = self.protected
        self.core = self.fixture.start_container("core", self.core_image, [], environment={
            **self.fixture.env, "CORE_WEB_ORIGIN": f"http://{self.caddy}:8080", "RUNTIME_COMPONENT": "core-api",
            "CORE_HOST": "0.0.0.0", "CORE_PORT": "3010",
        }, memory=f"{CORE_MEMORY_MIB}m", readonly=True)
        self.fixture.wait_for(lambda: self.docker.run(["exec", self.core, "bun", "--no-env-file", "-e", CORE_READY],
            check=False, timeout=5).returncode == 0, "exact Core readiness through the Web metadata relay", 60, self.core)
        self.fixture.wait_for(lambda: self._producer() is not None, "one Core producer registration", 15, self.core)
        self.producer = self._producer()
        self.protected = self.protected_runtimes()
        require(self.producer is not None and self.schema() == self.schema_sha
                and {name: self.protected[name] for name in original} == original,
                "Starting Core changed the retained backend or database schema")
        return {**evidence, "coreRuntime": self.protected["core"], "coreProducer": self.producer}

    def rpc(self, phase, active, retained):
        require(self.protected_runtimes() == self.protected and self._producer() == self.producer
                and self.target.read_route()[0] == self.target.slots[active]["route"],
                "Protected Core or accepted ingress changed before RPC proof")
        payload = canonical({"phase": phase, "active": active, "retained": retained, "session": self.session,
                             "probeHeader": CORE_PROBE_HEADER, "probeMarker": CORE_RESPONSE_MARKER,
                             "responseHeader": CORE_RESPONSE_HEADER, "readPath": CORE_READ_PATH, "webGenerationHeader": HEADER})
        raw = self.docker.run(["exec", "--interactive", self.core, "bun", "--no-env-file", "-e", CORE_RPC_PROBE],
                              input_bytes=payload, timeout=65).stdout
        require(0 < len(raw) <= 8192, "Bounded mixed Core RPC evidence required")
        result = json.loads(raw)
        require(type(result) is dict and set(result) == {"session", "sourceRevision", "version", "anonymousDenied", "csrfDenied",
                                                        "unknownStampRejected", "realtimeTickets", "durableOwnedReports"},
                "Exact mixed Core RPC evidence required")
        actor = result.pop("session")
        expected = self.direct_readback[active]["identity"]
        require(type(actor) is dict and set(actor) == {"id", "cookie", "csrf"}
                and all(isinstance(value, str) for value in actor.values())
                and re.fullmatch(r"[0-9a-f-]{36}", actor["id"]) and re.fullmatch(r"wd_sid=[A-Za-z0-9._%~+/-]{1,512}={0,2}", actor["cookie"])
                and re.fullmatch(r"[A-Za-z0-9_-]{43}", actor["csrf"])
                and (self.session is None or actor == self.session)
                and result["sourceRevision"] == expected["sourceRevision"] and result["version"] == expected["version"]
                and result["anonymousDenied"] is True and result["csrfDenied"] is True and result["unknownStampRejected"] is True
                and all(type(result[key]) is int and result[key] == 2 for key in ("realtimeTickets", "durableOwnedReports")),
                "Core RPC proof does not match the admitted Web pair and original native session")
        self.session = actor
        require(self.protected_runtimes() == self.protected and self._producer() == self.producer and self.schema() == self.schema_sha
                and self.target.read_route()[0] == self.target.slots[active]["route"],
                "Protected runtime, producer, ingress or database schema changed during RPC proof")
        return result

    def drain_core(self, active):
        self.docker.run(["stop", "--time", "75", self.core], timeout=80)
        state = self.fixture.state(self.core)
        require(not state["Running"] and not state["OOMKilled"] and state["ExitCode"] == 0,
                "Exact optional Core did not drain successfully")
        require(self._database("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                               "AND application_name IN ('warpdrive-core-api','warpdrive-core-producer');") == 0,
                "Core retained database connections after drain")
        outage = Request(self.traffic.origin + CORE_READ_PATH, headers={CORE_PROBE_HEADER: CORE_RESPONSE_MARKER,
                         "Cache-Control": "no-cache", "Connection": "close", "Accept-Encoding": "identity"})
        try:
            response = self.traffic.opener.open(outage, timeout=6)
        except HTTPError as error:
            response = error
        with response:
            require(response.status == 502 and response.headers.get_all(CORE_RESPONSE_HEADER, []) == [],
                    "Unavailable Core did not fail closed at the exact Caddy route")
        slot = self.target.slots[active]
        require(self.target.read_route()[0] == slot["route"] and self.target.observe_health(slot, proxied=True)["healthy"]
                and self.schema() == self.schema_sha
                and super().protected_runtimes() == {key: value for key, value in self.protected.items() if key != "core"},
                "Core drain changed active Web or the retained backend")
        return {"drained": True, "openCoreDatabaseConnections": 0, "coreRouteStatus": 502, "webHealthy": True}

    def run(self):
        self.output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
        try:
            self.check("authenticated-baseline-and-final-image-identities", self.load)
            self.check("retained-backend-two-webs-and-core", self.setup_runtimes)
            self.check("initial-caddy-route-and-web-assets", self.setup_caddy)
            old, new = self.generations
            self.check("baseline-native-session-and-core-rpc", lambda: self.rpc("baseline", old, new))
            for phase, before, after in (("forward", old, new), ("reverse", new, old), ("reapply", old, new)):
                self.check(phase + "-caddy-route", lambda: self.transition(phase, before, after, initialize=phase == "forward"))
                self.check(phase + "-authenticated-core-rpc", lambda: self.rpc(phase, after, before))
            self.check("core-drain-and-retained-web-health", lambda: self.drain_core(new))
        except Exception as error:
            self.report["failure"] = {"check": self.report["checks"][-1]["name"], "type": type(error).__name__}
        finally:
            self.session = None
            self.report["cleanup"] = self.cleanup()
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and self.report["cleanup"]["success"]
            with (self.output_dir / "report.json").open("x", encoding="utf-8") as report:
                json.dump(self.report, report, indent=2, allow_nan=False)
                report.write("\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--baseline-manifest-sha256", required=True)
    parser.add_argument("--baseline-preloaded", action="store_true",
                        help="verify the baseline bundle and already loaded immutable images without loading the archive again")
    for component in ("baseline", "new-web", "core"):
        parser.add_argument(f"--{component}-revision", required=True, type=validate_revision)
    for component in ("new-web", "core"):
        parser.add_argument(f"--{component}-image-id", required=True)
    parser.set_defaults(browser=False)
    args = parser.parse_args(arguments)
    if not HASH.fullmatch(args.baseline_manifest_sha256) or not all(IMAGE.fullmatch(pin) for pin in (args.new_web_image_id, args.core_image_id)):
        parser.error("Exact baseline manifest SHA-256 and immutable Core and Web image IDs are required")
    if args.new_web_image_id == args.core_image_id or args.new_web_revision == args.baseline_revision:
        parser.error("Distinct Core and candidate image IDs and distinct Web revisions are required")
    try:
        require(platform.system() == "Linux" and platform.machine() in {"x86_64", "amd64"}, "Native Linux AMD64 host required")
        with TemporaryDirectory(prefix="wd-core-mixed-") as directory:
            private = Path(directory).resolve()
            passed = CoreMixedImageSmoke(IsolatedDocker(private / "docker"), args, private).run()
    except Exception as error:
        print(f"Native isolated mixed Core rehearsal could not complete ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(f"Native isolated mixed Core rehearsal {'passed' if passed else 'failed'}. See report.json.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
