"""Rehearse one final Core image across two Web generations on native Linux."""

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import platform
import queue
import re
import secrets
import subprocess
import sys
from tempfile import TemporaryDirectory
import uuid
from urllib.error import HTTPError
from urllib.request import Request

from caddy_core_config import CORE_PROBE_HEADER, CORE_READ_PATH, CORE_RESPONSE_HEADER, CORE_RESPONSE_MARKER, core_api_routes
from image_smoke import ImageSmoke, image_metadata, utc_now, validate_revision
from browser_realtime_smoke import BrowserProcess
from registry_smoke import IsolatedDocker
import web_mixed_image_smoke as mixed
from web_mixed_image_smoke import HEADER, MixedCaddyTarget, MixedWebSmoke, RolloutBrowser
from web_rollout import rollout_web
from web_switch import DefiniteRejected, HASH, IMAGE, SwitchUnknown, canonical, content_hash
from web_switch_smoke import MAX_HTTP_BYTES, MIB, require, runtime_config


CORE_MEMORY_MIB = 768
FAULT_MEMORY_MIB = 128
CORE_COMMAND = ["bun", "--no-env-file", "dist/core-api.mjs"]
CORE_BROWSER = "scripts/browser-core-mixed.mjs"
BROWSER_TRANSITIONS = ("forward", "reverse", "reapply", "before-fault", "automatic-rollback")
PRODUCER_SQL = """SELECT coalesce(json_agg(row_to_json(witness) ORDER BY id),'[]'::json) FROM (
 SELECT id,pid,started_on,supervise,schedule,migrate,workers FROM pgboss.instance
 WHERE application_name='warpdrive-core-producer' AND stopped_on IS NULL LIMIT 2
) witness;"""
CORE_READY = "if (!(await fetch('http://127.0.0.1:3010/readyz',{signal:AbortSignal.timeout(2000)})).ok) process.exit(1)"


def core_browser_message(value):
    phases = {"initial-ready": mixed.BROWSER_PHASES["initial-ready"], "complete": {
        **mixed.BROWSER_PHASES["complete"], "coreTicketsBeforeAndAfter": True, "exactCoreRoute": True,
        "freshStampedPage": True, "transitions": len(BROWSER_TRANSITIONS), "rollbackBrowserQualified": True,
        "primaryDraftUnsubmitted": True,
    }}
    for phase in BROWSER_TRANSITIONS:
        phases["before-" + phase] = {"oldSocketActive": True, "sameDocument": True, "sameSession": True, "persistentDraft": True}
        phases["after-" + phase] = {"freshCoreTicket": True, "resubscribed": True, "sameDocument": True,
                                   "sameSession": True, "persistentDraft": True, "activePresentation": True,
                                   "activeAndOldAssets": True, "exactCoreRoute": True, "oldActionPosts": 1}
    require(type(value) is dict and isinstance(value.get("phase"), str) and value["phase"] in phases,
            "Unexpected Core browser phase")
    expected = phases[value["phase"]]
    if value["phase"].startswith("after-"):
        require(isinstance(value.get("activeRevision"), str) and re.fullmatch(r"[a-f0-9]{40}", value["activeRevision"]),
                "Exact active browser revision required")
        expected = {**expected, "activeRevision": value["activeRevision"]}
    require(set(value) == {"phase", *expected} and all(type(value[key]) is type(wanted) and value[key] == wanted
            for key, wanted in expected.items()), "Incomplete Core browser proof")
    return value


class CoreBrowser(RolloutBrowser):
    def __init__(self, environment):
        def run(_command, **options):
            return subprocess.Popen(["bun", "--no-env-file", str(mixed.ROOT / CORE_BROWSER)], **options)
        BrowserProcess.__init__(self, environment, runner=run)

    def send(self, command):
        require(isinstance(command, str)
                and command in {*BROWSER_TRANSITIONS, *("pre-" + phase for phase in BROWSER_TRANSITIONS), "finish"},
                "Unknown Core browser barrier command")
        self.process.stdin.write(json.dumps({"command": command}) + "\n")
        self.process.stdin.flush()

    def _read(self, stream, protocol):
        if not protocol:
            return BrowserProcess._read(self, stream, protocol)
        try:
            while line := stream.readline(4097):
                require(len(line) <= 4096 and line.endswith("\n"), "Bounded Core browser control required")
                self.messages.put_nowait(core_browser_message(json.loads(line)))
        except (ValueError, RuntimeError, queue.Full):
            self.invalid = True

    def failure_stages(self):
        stages = []
        for line in self.errors:
            try:
                value = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if (type(value) is dict and set(value) == {"event", "stage"}
                    and value["event"] == "browser.core-mixed.failed" and isinstance(value["stage"], str)
                    and (value["stage"] in mixed.BROWSER_FAILURES or value["stage"] in {
                        "transition-preparation", "waiting-for-transition", "persistent-transition-reconnect",
                        "transition-presentation", "waiting-for-finish", "final-persistent-draft"})):
                stages.append(value["stage"])
        return stages


class CoreCaddyTarget(MixedCaddyTarget):
    """The fixed six-write scenario also drops one acknowledged PATCH response."""
    def __init__(self, *args):
        super().__init__(*args)
        self.lose_next_ack = False

    def compare_and_swap_route(self, expected, desired):
        current, etag = self.read_route()
        if current != expected:
            raise DefiniteRejected("Caddy route changed before this operation issued its PATCH")
        require(desired == self.slots[desired["generation"]]["route"] and len(self.patches) < 6,
                "Unexpected or repeated Core fixture route mutation")
        self.patches.append({"from": expected["generation"], "to": desired["generation"]})
        status, _, _ = self.smoke.admin.request("PATCH", value=self.documents[desired["generation"]], etag=etag)
        if status == 412:
            raise DefiniteRejected("Caddy rejected the original route ETag")
        require(status == 200, "Caddy route mutation has an unresolved outcome")
        if self.stop_after_switch == desired["generation"]:
            self.stop_after_switch = None
            self.smoke.stop_candidate(self.slots[desired["generation"]]["runtime"]["name"])
        if self.lose_next_ack:
            self.lose_next_ack = False
            raise SwitchUnknown("Injected loss after the real Caddy PATCH")


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


CORE_LOST_REPLY_PROBE = r"""
import assert from 'node:assert/strict';
const {session, active, operation, ingress} = JSON.parse(await Bun.stdin.text());
assert.match(operation, /^Core lost reply [a-f0-9-]{36}$/u);
assert.match(ingress, /^http:\/\/wd-image-smoke-[a-f0-9]{12}-caddy:8080$/u);
const response = await fetch(new URL('/api/trpc/stats.savedPerformance.create', ingress), {
  method:'POST', redirect:'manual', signal:AbortSignal.timeout(8000),
  headers:{origin:new URL(process.env.BASE_URL).origin, 'sec-fetch-site':'same-origin',
    cookie:`${session.cookie}; wd_csrf=${session.csrf}`, 'content-type':'application/json', 'x-deployment-id':active},
  body:JSON.stringify({json:{name:operation,csrfToken:session.csrf,definition:{version:1,from:'2026-01-01',
    to:'2026-01-31',currency:'EUR',pipelineId:null,ownerScope:{kind:'me'}}}}),
});
assert.equal(response.status,502);
assert.equal(response.headers.get('X-Warpdrive-Fixture-Web-Generation'),null);
console.log(JSON.stringify({status:502,webGenerationAbsent:true}));
"""

# A disposable transport fault, not an RPC implementation. It forwards the exact
# finite request to the real Core and drops only its successful response. No
# cookie, request body or response body is logged or retained in its metrics.
CORE_RESPONSE_DROP = r"""
import assert from 'node:assert/strict';
import http from 'node:http';
const upstream = process.env.CORE_FAULT_UPSTREAM;
const operation = process.env.CORE_FAULT_OPERATION;
assert.match(upstream,/^wd-image-smoke-[a-f0-9]{12}-core$/u);
assert.match(operation,/^Core lost reply [a-f0-9-]{36}$/u);
const metrics = {attempts:0,forwarded:0,dropped:0,upstreamSuccess:0,unexpected:0};
const sockets = new Set();
const proxy = http.createServer((request,response) => {
  metrics.attempts++;
  let bytes=0;
  const chunks=[];
  request.on('data',chunk => {
    bytes+=chunk.length;
    if(bytes>4096) request.destroy(); else chunks.push(chunk);
  });
  request.on('end',() => {
    const body=Buffer.concat(chunks);
    let valid=false;
    try { valid=request.method==='POST' && request.url==='/api/trpc/stats.savedPerformance.create'
      && JSON.parse(body.toString('utf8')).json.name===operation; } catch {}
    if(!valid || metrics.forwarded!==0) { metrics.unexpected++; response.writeHead(503).end(); return; }
    metrics.forwarded++;
    const forwarded=http.request({hostname:upstream,port:3010,path:request.url,method:request.method,
      headers:{...request.headers,connection:'close'},timeout:5000}, received => {
      let size=0;
      const replies=[];
      received.on('data',chunk => {
        size+=chunk.length;
        if(size>8192) received.destroy(); else replies.push(chunk);
      });
      received.on('end',() => {
        let accepted=false;
        try { accepted=received.statusCode===200 && JSON.parse(Buffer.concat(replies).toString('utf8'))
          .result.data.json.state==='created'; } catch {}
        if(accepted) { metrics.upstreamSuccess++; metrics.dropped++; }
        else metrics.unexpected++;
        request.socket.destroy();
      });
      received.on('error',() => { metrics.unexpected++; request.socket.destroy(); });
    });
    forwarded.on('timeout',() => forwarded.destroy());
    forwarded.on('error',() => { metrics.unexpected++; request.socket.destroy(); });
    forwarded.end(body);
  });
});
const monitor=http.createServer((request,response) => {
  if(request.method!=='GET' || request.url!=='/snapshot') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(metrics));
});
for(const server of [proxy,monitor]) {
  server.on('connection',socket => { sockets.add(socket); socket.once('close',() => sockets.delete(socket)); });
}
proxy.listen(3010,'0.0.0.0');
monitor.listen(3012,'127.0.0.1');
process.once('SIGTERM',() => { proxy.close(); monitor.close(); for(const socket of sockets) socket.destroy(); });
"""


class CoreMixedImageSmoke(MixedWebSmoke):
    def __init__(self, docker, args, private):
        super().__init__(docker, args, private)
        require(not self.repeat, "Core mixed fixture requires the original authenticated baseline")
        self.core_image, self.core_revision = args.core_image_id, args.core_revision
        self.baseline_preloaded = args.baseline_preloaded
        self.core = None
        self.session = None
        self.browser_transitions = []
        self.report.update(kind="warpdrive-native-mixed-core-image-smoke", limitations=[
            "Native Linux final images on a fresh owned PostgreSQL fixture and one internal bridge.",
            "Exercises exact Caddy/Web/retained Core images; collector, Compose runtime and installed acceptance are separate.",
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
        return super().runtime_memory_limit() + (CORE_MEMORY_MIB + FAULT_MEMORY_MIB) * MIB

    def forwarder(self, name, port, *, browser=False):
        if not browser:
            return super().forwarder(name, port)
        forwarding = mixed.owned_bridge_forwarder(self.docker, owner_label=mixed.OWNER_LABEL, owner=self.fixture.prefix,
            network_name=self.fixture.report["resources"]["network"], container_name=name, port=port,
            lifetime_seconds=600, idle_seconds=60, max_connections=16, total_bytes=128 * MIB,
            connection_bytes=16 * MIB).start()
        self.relays.append(forwarding)
        return forwarding.authority

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
            if self.args.browser:
                # Core's metadata reader and in-container RPC witness use this
                # private HTTP listener. Browser traffic still uses fixture TLS;
                # no certificate bypass or installed public listener is added.
                require("core_fixture_http" not in document["apps"]["http"]["servers"], "Competing fixture listener")
                document["apps"]["http"]["servers"]["core_fixture_http"] = {
                    "listen": [":8080"], "routes": deepcopy(server["routes"]),
                }
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

    def setup_caddy(self):
        evidence = super().setup_caddy()
        self.target = CoreCaddyTarget(self, self.target.slots, self.documents, self.qualification)
        return evidence

    def verify_browser_source(self, candidate=None):
        super().verify_browser_source(candidate)
        committed = self.host(["git", "cat-file", "blob", f"{self.revision}:{CORE_BROWSER}"], binary=True)
        require(mixed.regular_file(mixed.ROOT, CORE_BROWSER, 65536).read_bytes() == committed,
                "Core browser helper differs from the exact baseline source")

    @staticmethod
    def _private_json(path, value):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, allow_nan=False)

    def start_browser(self):
        self.verify_browser_source()
        require((self.seed_root / "node_modules/better-auth/package.json").is_file()
                and (mixed.ROOT / "tools/browser-smoke/node_modules/playwright/index.mjs").is_file(),
                "Locked browser and application dependencies required")
        database = self.forwarder(self.fixture.containers["postgres"], 5432)
        port = int(database.split(":")[-1])
        environment = mixed.source_runtime_environment(self.host_environment, self.fixture.env, port)
        seed = {"revision": self.revision, "baseUrl": self.traffic.origin, "databasePort": port,
                "actorId": str(uuid.uuid4()), "adminId": str(uuid.uuid4()), "pipelineId": str(uuid.uuid4()),
                "permissionId": str(uuid.uuid4()), "email": "web-" + secrets.token_hex(8) + "@example.invalid",
                "adminEmail": "admin-" + secrets.token_hex(8) + "@example.invalid",
                "password": secrets.token_urlsafe(32), "adminPassword": secrets.token_urlsafe(32),
                "pipelineName": "Core mixed browser fixture"}
        mixed.admit_profile(seed, environment)
        seed_path = self.private / "core-browser-seed.json"
        self._private_json(seed_path, seed)
        try:
            raw = self.host(["bun", "--no-env-file", str(self.seed_root / mixed.SEED_SCRIPT), "seed"],
                            environment={**environment, "BROWSER_REALTIME_PROFILE": str(seed_path)},
                            timeout=40, root=self.seed_root)
            mixed.admit_fixture_result(json.loads(raw), "seed", self.revision)
        finally:
            seed_path.unlink()
        self.browser_profile = {key: seed[key] for key in ("baseUrl", "actorId", "pipelineId", "pipelineName", "email", "password")}
        self.browser_profile.update(previousRevision=self.old_image["sourceRevision"], currentRevision=self.args.new_web_revision,
                                    activitySubject="Web rollout " + secrets.token_hex(12))
        if getattr(self.args, "topbar_gaps", None) is not None:
            self.browser_profile["topBarGaps"] = self.args.topbar_gaps
        self.browser_profile_path = self.private / "core-browser.json"
        self._private_json(self.browser_profile_path, self.browser_profile)
        self.browser = CoreBrowser({**self.host_environment, "BROWSER_WEB_ROLLOUT_PROFILE": str(self.browser_profile_path)})
        initial = self.browser.wait("initial-ready", timeout=90)
        require(self.browser_rows() == {"total": 0, "matching": 0, "owned": 0}, "Browser fixture has preexisting Activity rows")
        return {"freshBoundBaselineSeed": True, "forgedSession": False, "initial": initial, "matchingActivityRows": 0}

    def browser_rows(self):
        actor, subject = self.browser_profile["actorId"], self.browser_profile["activitySubject"]
        require(str(uuid.UUID(actor)) == actor and re.fullmatch(r"Web rollout [0-9a-f]{24}", subject),
                "Exact synthetic browser Activity locator required")
        return self._database("SELECT json_build_object('total',count(*),'matching',count(*) FILTER "
            f"(WHERE owner_id='{actor}'::uuid AND subject='{subject}'),'owned',count(*) FILTER "
            f"(WHERE owner_id='{actor}'::uuid)) FROM activities;")

    def browser_before(self, phase):
        if not self.args.browser:
            return None
        require(phase in BROWSER_TRANSITIONS and len(self.browser_transitions) < len(BROWSER_TRANSITIONS)
                and phase == BROWSER_TRANSITIONS[len(self.browser_transitions)],
                "Browser transition order changed")
        self.browser.send("pre-" + phase)
        return self.browser.wait("before-" + phase, timeout=45)

    def browser_after(self, phase, active, prepared):
        if not self.args.browser:
            return None
        self.browser.send(phase)
        completed = self.browser.wait("after-" + phase, timeout=100)
        require(completed["activeRevision"] == active[3:]
                and self.browser_rows() == {"total": 1, "matching": 1, "owned": 1},
                "Browser presentation is stale or its sole action leaked Activity rows")
        self.browser_transitions.append(phase)
        return {"before": prepared, "after": completed, "activityRows": 1, "unsubmittedDraftRows": 0}

    def transition(self, operation, before, after, *, initialize=False):
        prepared = self.browser_before(operation)
        result = super().transition(operation, before, after, initialize=initialize)
        browser = self.browser_after(operation, after, prepared)
        return {**result, **({"browser": browser} if browser is not None else {})}

    def automatic_rollback(self, before, after):
        prepared = self.browser_before("automatic-rollback")
        result = super().automatic_rollback(before, after)
        browser = self.browser_after("automatic-rollback", before, prepared)
        return {**result, **({"browser": browser} if browser is not None else {})}

    def finish_browser(self):
        require(self.browser_transitions == list(BROWSER_TRANSITIONS), "All browser upgrade/rollback barriers are required")
        self.browser.send("finish")
        # The shared finalizer also requires exactly one owned Activity, source
        # stability, terminal browser readers and no extra protocol records.
        self.browser_pre_switch = {"transitions": list(self.browser_transitions)}
        result = super().finish_browser()
        require(self.browser_rows() == {"total": 1, "matching": 1, "owned": 1},
                "Browser created additional or unsubmitted-draft Activity rows")
        self.report["browserRollbackQualified"] = True
        return {**result, "transitions": list(self.browser_transitions), "activityRows": 1, "unsubmittedDraftRows": 0}

    def lost_route_ack(self, before, after):
        prepared = self.browser_before("forward")
        plan = self.rollout_plan("forward", before, after)
        state_dir = self.private / "rollout-state"
        self.target.lose_next_ack = True
        count = len(self.target.patches)
        try:
            rollout_web(plan, state_dir=state_dir, target=self.target, initialize=True)
        except SwitchUnknown:
            pass
        else:
            require(False, "Lost route acknowledgement did not hold the original operation")
        require(self.target.patches[count:] == [{"from": before, "to": after}]
                and self.target.read_route()[0] == self.target.slots[after]["route"],
                "Lost acknowledgement does not match the one actual Caddy mutation")
        receipt = rollout_web(plan, state_dir=state_dir, target=self.target)
        require(receipt["state"] == "accepted" and receipt["acceptedGeneration"] == after
                and len(self.target.patches) == count + 1, "Acknowledgement recovery replayed the route mutation")
        require(rollout_web(plan, state_dir=state_dir, target=self.target) == receipt
                and len(self.target.patches) == count + 1, "Terminal route readback issued another mutation")
        browser = self.browser_after("forward", after, prepared)
        return {"receipt": receipt, "routeWrites": 1, "unknownHeld": True, "readbackWithoutReplay": True,
                "ingress": self.read_ingress(after), **({"browser": browser} if browser is not None else {})}

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

    def drain_core(self, active, *, expected_schema=None):
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
                and self.schema() == (expected_schema or self.schema_sha)
                and super().protected_runtimes() == {key: value for key, value in self.protected.items() if key != "core"},
                "Core drain changed active Web or the retained backend")
        return {"drained": True, "openCoreDatabaseConnections": 0, "coreRouteStatus": 502, "webHealthy": True}

    def _fixture_sql(self, statement):
        data = statement.encode()
        require(0 < len(data) <= 8192, "Bounded fixture-only audit SQL required")
        postgres = self.fixture.containers["postgres"]
        self.owned(postgres)
        self.docker.run(["exec", "-i", postgres, "psql", "-Xq", "-U", "smoke", "-d", "warpdrive_image_smoke",
                         "-v", "ON_ERROR_STOP=1", "-f", "-"], input_bytes=data, timeout=10)

    def _patch_fault_route(self, before, after):
        current, etag = self.admin.config()
        require(current == before, "Competing Caddy configuration during the owned response-drop fault")
        status, _, _ = self.admin.request("PATCH", value=after, etag=etag)
        require(status == 200 and self.admin.config()[0] == after,
                "Fixture transport-route acknowledgement is unresolved")

    def _lost_reply_request(self, active, operation):
        container = self.target.slots[active]["runtime"]["name"]
        self.owned(container)
        payload = canonical({"session": self.session, "active": active, "operation": operation,
                             "ingress": f"http://{self.caddy}:8080"})
        raw = self.docker.run(["exec", "-i", container, "bun", "--no-env-file", "-e", CORE_LOST_REPLY_PROBE],
                              input_bytes=payload, timeout=15).stdout
        require(0 < len(raw) <= 1024, "Bounded lost-reply client evidence required")
        result = json.loads(raw)
        require(result == {"status": 502, "webGenerationAbsent": True}, "Core failure reached a Web fallback")
        return result

    def lost_reply_and_outage(self, active):
        require(self.session is not None and self.schema() == self.schema_sha
                and self.protected_runtimes() == self.protected, "Exact healthy Core fixture required before fault")
        operation = "Core lost reply " + str(uuid.uuid4())
        require(self._database("SELECT json_build_object('exists',to_regclass('public.core_mixed_write_audit') IS NOT NULL);") == {"exists": False},
                "Competing fixture audit table")
        original = self.documents[active]
        fault = deepcopy(original)
        alias = self.fixture.prefix + "-core-response-drop"
        replacements = 0

        def replace(value):
            nonlocal replacements
            if isinstance(value, dict):
                if value.get("handler") == "reverse_proxy" and value.get("upstreams") == [{"dial": self.core + ":3010"}]:
                    value["upstreams"] = [{"dial": alias + ":3010"}]
                    replacements += 1
                for item in value.values():
                    replace(item)
            elif isinstance(value, list):
                for item in value:
                    replace(item)
        replace(fault)
        require(replacements == (4 if self.args.browser else 2), "Only the exact Core upstreams may receive the transport fault")
        audit_created = routed = False
        try:
            # These owner-created objects exist only in this fresh fixture. The
            # trigger distinguishes a real Core commit from replay or Web fallback,
            # even when the application would deduplicate a repeated report name.
            self._fixture_sql("BEGIN; CREATE TABLE core_mixed_write_audit(application_name text NOT NULL, owner_id uuid NOT NULL); "
                "GRANT INSERT ON core_mixed_write_audit TO smoke_runtime; "
                "CREATE FUNCTION core_mixed_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                f"IF NEW.target_entity='stats-performance-report' AND NEW.name='{operation}' THEN "
                "INSERT INTO core_mixed_write_audit VALUES(current_setting('application_name'),NEW.owner_id); END IF; "
                "RETURN NEW; END $$; CREATE TRIGGER core_mixed_write_audit AFTER INSERT OR UPDATE ON saved_filters "
                "FOR EACH ROW EXECUTE FUNCTION core_mixed_audit_write(); COMMIT;")
            audit_created = True
            audit_schema = self.schema()
            require(audit_schema != self.schema_sha, "The durable write audit was not actually installed")
            proxy = self.fixture.start_container("core-response-drop", self.core_image,
                ["bun", "--no-env-file", "-e", CORE_RESPONSE_DROP], environment={"CORE_FAULT_UPSTREAM": self.core,
                "CORE_FAULT_OPERATION": operation}, memory=f"{FAULT_MEMORY_MIB}m", readonly=True)
            snapshot_code = "const r=await fetch('http://127.0.0.1:3012/snapshot',{signal:AbortSignal.timeout(1000)}); console.log(await r.text())"
            self.fixture.wait_for(lambda: self.docker.run(["exec", proxy, "bun", "--no-env-file", "-e", snapshot_code],
                check=False, timeout=3).returncode == 0, "owned response-drop transport", 15, proxy)
            self._patch_fault_route(original, fault)
            routed = True
            lost = self._lost_reply_request(active, operation)
            metrics = self.docker.json(["exec", proxy, "bun", "--no-env-file", "-e", snapshot_code], timeout=5)
            require(metrics == {"attempts": 1, "forwarded": 1, "dropped": 1, "upstreamSuccess": 1, "unexpected": 0},
                    "Lost Core response caused retry or lacked one successful real Core mutation")
            self._patch_fault_route(fault, original)
            routed = False
            query = ("SELECT json_build_object('writes',count(*),'coreWrites',count(*) FILTER "
                     "(WHERE application_name='warpdrive-core-api'),'owners',coalesce(json_agg(owner_id),'[]'::json)) "
                     "FROM core_mixed_write_audit;")
            expected = {"writes": 1, "coreWrites": 1, "owners": [self.session["id"]]}
            require(self._database(query) == expected, "Lost reply replayed a write or fell back to the Web database owner")
            drain = self.drain_core(active, expected_schema=audit_schema)
            outage = self._lost_reply_request(active, operation)
            require(self._database(query) == expected, "Core outage performed a Web fallback mutation")
            row = self._database("SELECT coalesce(json_agg(owner_id),'[]'::json) FROM saved_filters "
                                 f"WHERE target_entity='stats-performance-report' AND name='{operation}';")
            require(row == [self.session["id"]], "Exactly one owned durable Core result must survive both failures")
            return {"lostReply": lost, "transport": metrics, "durableWrites": 1, "coreWrites": 1,
                    "webFallbackWrites": 0, "outageMutation": outage, "drain": drain,
                    "realFinalCoreImage": self.core_image, "fixtureAuditRemoved": True, "exactRouteRestored": True}
        finally:
            if routed:
                self._patch_fault_route(fault, original)
            if audit_created:
                self._fixture_sql("BEGIN; DROP TRIGGER core_mixed_write_audit ON saved_filters; "
                                  "DROP FUNCTION core_mixed_audit_write(); DROP TABLE core_mixed_write_audit; COMMIT;")
                require(self.schema() == self.schema_sha and self.target.read_route()[0] == self.target.slots[active]["route"],
                        "Fixture write audit or transport route was not restored exactly")

    def run(self):
        self.output_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
        try:
            self.check("authenticated-baseline-and-final-image-identities", self.load)
            self.check("retained-backend-two-webs-and-core", self.setup_runtimes)
            self.check("initial-caddy-route-and-web-assets", self.setup_caddy)
            old, new = self.generations
            if self.args.browser:
                self.check("native-browser-draft-and-core-ticket-before-switch", self.start_browser)
            self.check("baseline-native-session-and-core-rpc", lambda: self.rpc("baseline", old, new))
            self.check("forward-lost-caddy-ack-readback-without-replay", lambda: self.lost_route_ack(old, new))
            self.check("forward-authenticated-core-rpc", lambda: self.rpc("forward", new, old))
            for phase, before, after in (("reverse", new, old), ("reapply", old, new)):
                self.check(phase + "-caddy-route", lambda: self.transition(phase, before, after))
                self.check(phase + "-authenticated-core-rpc", lambda: self.rpc(phase, after, before))
            self.check("reverse-before-candidate-fault", lambda: self.transition("before-fault", new, old))
            self.check("failed-web-automatically-restores-retained-route", lambda: self.automatic_rollback(old, new))
            self.check("rollback-authenticated-core-rpc", lambda: self.rpc("automatic-rollback", old, new))
            if self.args.browser:
                self.check("persistent-browser-upgrade-rollback-and-single-old-action", self.finish_browser)
            self.check("real-core-lost-mutation-reply-and-outage-no-fallback", lambda: self.lost_reply_and_outage(old))
        except Exception as error:
            self.report["failure"] = {"check": self.report["checks"][-1]["name"], "type": type(error).__name__}
            if self.browser is not None:
                self.report["failure"]["browserStages"] = self.browser.failure_stages()
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
    parser.add_argument("--browser", action="store_true", help="require persistent native browser continuity through the final Core image")
    parser.add_argument("--topbar-gaps", nargs=2, type=int, metavar=("OLD", "NEW"))
    args = parser.parse_args(arguments)
    if not HASH.fullmatch(args.baseline_manifest_sha256) or not all(IMAGE.fullmatch(pin) for pin in (args.new_web_image_id, args.core_image_id)):
        parser.error("Exact baseline manifest SHA-256 and immutable Core and Web image IDs are required")
    if args.new_web_image_id == args.core_image_id or args.new_web_revision == args.baseline_revision:
        parser.error("Distinct Core and candidate image IDs and distinct Web revisions are required")
    if args.browser and (args.topbar_gaps is None or any(not 0 <= gap <= 64 for gap in args.topbar_gaps)
                         or args.topbar_gaps[0] - args.topbar_gaps[1] != 2):
        parser.error("Browser proof requires the exact admitted old/new TopBar gap pair")
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
