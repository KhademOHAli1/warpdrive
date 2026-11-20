"""Qualify the exact headless Web and Core images on disposable PostgreSQL."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import urlsplit

from image_smoke import (
    COMPONENTS,
    HEALTH_PROBE,
    OWNER_LABEL,
    WEB_PROBE,
    Docker,
    ImageSmoke,
    SmokeError,
    image_metadata,
    utc_now,
    validate_reference,
    validate_revision,
)


HISTORICAL_WEB_FIRST_REVISION = "12b9233bde834fca6628e540256ab4a4065d8a02"

WEB_IDENTITY_PROBE = r"""
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3000';
const get = path => fetch(base + path, {redirect:'manual',signal:AbortSignal.timeout(3000)});
const health = await get('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);
const metadata = await get('/api/runtime/web-identity');
assert.equal(metadata.status, 200);
const identity = await metadata.json();
assert.deepEqual(identity, {
  contract: 'warpdrive.web.identity.v1',
  component: 'web',
  version: identity.version,
  sourceRevision: process.argv.at(-1),
});
assert.match(identity.version, /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/u);
assert(!Object.keys(process.env).some(name => /^(DATABASE_URL|MIGRATION_DATABASE_URL|AUTH_SECRET|AUTH_SMTP_|MINIO_|TOKEN_ENCRYPTION_KEY|WS_TICKET_SECRET)/u.test(name)),
  'Backend configuration entered the Web container');
console.log(JSON.stringify(identity));
"""

CORE_READINESS_PROBE = r"""
const response = await fetch('http://127.0.0.1:3010/readyz', {signal:AbortSignal.timeout(2000)});
if (!response.ok) process.exit(1);
console.log(JSON.stringify({ready:true}));
"""

CORE_OFFLINE_WEB_PROBE = r"""
import assert from 'node:assert/strict';
const web = new URL(process.env.CORE_WEB_ORIGIN);
await assert.rejects(fetch(web, {signal:AbortSignal.timeout(1000)}), 'Web must be offline');
const origin = 'http://127.0.0.1:3010';
const ready = await fetch(origin + '/readyz', {signal:AbortSignal.timeout(5000)});
assert.equal(ready.status, 200);
assert.equal(ready.headers.get('x-warpdrive-runtime-code'), 'CORE_READY');
const response = await fetch(origin + '/api/trpc/frontend.configuration', {
  headers: {'x-warpdrive-proxy-token': process.env.CORE_PROXY_TOKEN},
  signal: AbortSignal.timeout(5000),
});
assert.equal(response.status, 200, 'Core serves admitted requests with Web offline');
assert.equal(typeof (await response.json()).result.data.json.MCP_ENABLED, 'boolean');
console.log(JSON.stringify({ready:true,webOffline:true,admittedRpcServed:true,diagnosticCode:'CORE_READY'}));
"""

# Retain the original Web smoke assertions and supply the Host an ingress would send.
PUBLIC_HOST = r"""
const fetch = (input, options) => globalThis.fetch(input, {
  ...options,
  headers: {host:process.argv.at(-1)},
});
"""

CORE_WEB_PROBE = r"""
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

let stage = 'core-packaging';
async function run() {
  assert(process.getuid() > 0, 'Core must execute as a non-root user');
  assert(!['src','.next','drizzle','node_modules/@ui-sdk'].some(path => existsSync('/app/' + path)),
    'Unexpected Core runtime filesystem');
  assert.deepEqual(readdirSync('/app/dist').sort(), ['core-api.mjs','workflow-code-worker.mjs']);
  stage = 'core-and-anonymous-http';
  const core = 'http://127.0.0.1:3010';
  const web = new URL(process.env.CORE_WEB_ORIGIN);
  assert.match(web.hostname, /^wd-image-smoke-[a-f0-9]{12}-web$/u);
  assert.equal(web.port, '3000');
  const options = {redirect:'manual',signal:AbortSignal.timeout(10000)};
  assert.equal((await fetch(core + '/healthz', options)).status, 200, 'Core local health');
  assert.equal((await fetch(core + '/api/trpc/version.get', options)).status, 401,
    'Core requires the proxy credential');
  assert.equal((await fetch(core + '/login', options)).status, 404, 'Web pages stay on Web');
  const origin = new URL(process.env.BASE_URL);
  const webHeaders = {host:origin.host,origin:origin.origin,'sec-fetch-site':'same-origin'};
  const request = (path, init = {}) => fetch(new URL(path, web), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: {...webHeaders,...init.headers},
  });
  assert.equal((await request('/api/trpc/version.get')).status, 401,
    'Web proxy does not authenticate an anonymous browser');

  stage = 'fixture-seeding';
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert.equal(dbUrl.hostname, 'postgres');
  assert.equal(dbUrl.pathname, '/warpdrive_image_smoke');
  assert.equal(dbUrl.username, 'smoke_runtime');
  const userId = randomUUID();
  const personId = randomUUID();
  const personName = 'Core fixture person ' + personId;
  const email = userId + '@example.invalid';
  const password = randomBytes(32).toString('base64url');
  const client = new pg.Client({connectionString:dbUrl.href,connectionTimeoutMillis:3000,statement_timeout:3000});
  await client.connect();
  try {
    const before = await client.query('SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM sessions)::int AS sessions');
    assert.deepEqual(before.rows, [{users:0,sessions:0}], 'Only seed an empty fixture');
    await client.query('BEGIN');
    await client.query("INSERT INTO users(id,email,name,is_admin,is_active) VALUES($1,$2,'Core image fixture',false,true)", [userId,email]);
    await client.query("INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,'Core image fixture',true,false)", [userId,email]);
    await client.query("INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",
      [userId,userId,await hashPassword(password)]);
    await client.query("INSERT INTO persons(id,owner_id,name,visibility_level) VALUES($1,$2,$3,'owner')", [personId,userId,personName]);
    await client.query('COMMIT');

    stage = 'native-login';
    const login = await request('/api/auth/sign-in/email', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({email,password}),
    });
    assert.equal(login.status, 200, 'Native password login through Web');
    const cookies = login.headers.getSetCookie().filter(value => value.startsWith('wd_sid='));
    assert.equal(cookies.length, 1, 'The native host-only session cookie survives the proxy');
    const sessionCookie = cookies[0].split(';',1)[0];
    const headers = {cookie:sessionCookie};
    stage = 'authenticated-ssr';
    const person = await request('/contacts/people/' + personId, {headers});
    assert.equal(person.status, 200, 'Authenticated Web renders the owned record');
    assert((await person.text()).includes(personName), 'SSR reads the fixture record from Core');
    stage = 'authenticated-rpc';
    const version = await request('/api/trpc/version.get', {headers});
    assert.equal(version.status, 200, 'Authenticated tRPC relays through Web');
    assert.equal((await version.json()).result.data.json.current, process.argv.at(-1));

    stage = 'csrf-rejection';
    const csrfToken = randomBytes(32).toString('base64url');
    const name = 'Core image report ' + userId;
    const definition = {version:1,from:'2026-01-01',to:'2026-01-31',currency:'EUR',pipelineId:null,ownerScope:{kind:'me'}};
    const save = token => request('/api/trpc/stats.savedPerformance.create', {
      method:'POST',
      headers:{cookie:sessionCookie + '; wd_csrf=' + csrfToken,'content-type':'application/json'},
      body:JSON.stringify({json:{name,definition,csrfToken:token}}),
    });
    const persistedOwners = async () => (await client.query(
      "SELECT owner_id FROM saved_filters WHERE target_entity='stats-performance-report' AND name=$1", [name],
    )).rows;
    assert.equal((await save(null)).status, 403, 'Missing CSRF is denied through Web');
    assert.deepEqual(await persistedOwners(), [], 'Denied mutation causes no write');
    stage = 'durable-write';
    const saved = await save(csrfToken);
    assert.equal(saved.status, 200, 'Authorized mutation succeeds through Web');
    assert.equal((await saved.json()).result.data.json.state, 'created');
    assert.deepEqual(await persistedOwners(), [{owner_id:userId}], 'One durable write for the actual actor');
    writeFileSync('/tmp/web-rollout.json', JSON.stringify({sessionCookie,personId,personName}), {mode:0o600,flag:'wx'});
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({nativeSession:true,authenticatedSsr:true,protectedRpc:true,proxyCredentialRequired:true,
    csrfDenied:true,durableAuthorizedWrite:true,uid:process.getuid()}));
}

try {
  await run();
} catch (error) {
  const isStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;
  const status = isStatus(error?.actual) && isStatus(error?.expected)
    ? ` (HTTP ${error.actual}, expected ${error.expected})` : '';
  console.error('headless-probe-failed: ' + stage + status);
  process.exitCode = 1;
}
"""


WEB_ROLLOUT_SESSION_PROBE = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const {sessionCookie,personId,personName} = JSON.parse(readFileSync('/tmp/web-rollout.json','utf8'));
const web = new URL(process.env.CORE_WEB_ORIGIN);
const headers = {host:new URL(process.env.BASE_URL).host,cookie:sessionCookie};
const request = (path) => fetch(new URL(path, web), {headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
const response = await request('/contacts/people/' + personId);
assert.equal(response.status, 200, 'The pre-rollout session works on the selected Web image');
assert((await response.text()).includes(personName), 'The selected Web image reads the same Core record');
const version = await request('/api/trpc/version.get');
assert.equal(version.status, 200);
assert.equal((await version.json()).result.data.json.current, process.argv.at(-1));
console.log(JSON.stringify({sameSession:true,sameRecord:true,activeWebVersion:true}));
"""


class HeadlessImageSmoke(ImageSmoke):
    def __init__(self, docker, images, core_image, output, revision, *, platform="linux/amd64",
                 baseline_web=None, historical_web_first=False):
        super().__init__(docker, images, output, revision)
        self.core_image = validate_reference(core_image)
        self.baseline_web = baseline_web
        self.historical_web_first = historical_web_first
        self.platform = platform
        self.web_identity = None
        self.env["CORE_PROXY_TOKEN"] = secrets.token_hex(32)
        self.public_host = urlsplit(self.env["BASE_URL"]).netloc
        self.report["kind"] = "warpdrive-headless-final-image-smoke"
        self.report["platform"] = platform
        self.report["limitations"] = [
            "Exact final images exercised on fresh disposable PostgreSQL and an internal Docker bridge.",
            "Realtime rejects unauthenticated traffic. Worker processes one empty-database file reaper job after restart.",
            "Web image replacement is single-slot. Retained browser generations, installed ingress, supported populated schema upgrades, external providers and production acceptance require separate evidence.",
        ]

    def inspect_images(self):
        local_ids = set()
        for role, reference in {**self.images, "core": self.core_image}.items():
            raw = self.docker.json(["image", "inspect", reference])
            identity = image_metadata(raw, self.expected_revision)
            image_platform = f"{raw[0].get('Os')}/{raw[0].get('Architecture')}"
            if image_platform != self.platform:
                raise SmokeError(f"{role} image must be {self.platform}")
            if identity["id"] in local_ids:
                raise SmokeError("Final images must have distinct immutable IDs")
            local_ids.add(identity["id"])
            if role == "core":
                self.report["coreImage"] = identity
            else:
                self.report["images"][role] = identity
        if self.baseline_web is not None:
            reference, revision = self.baseline_web
            raw = self.docker.json(["image", "inspect", reference])
            identity = image_metadata(raw, revision)
            image_platform = f"{raw[0].get('Os')}/{raw[0].get('Architecture')}"
            if image_platform != self.platform:
                raise SmokeError(f"Baseline Web image must be {self.platform}")
            if identity["id"] in local_ids or identity["revision"] == self.expected_revision:
                raise SmokeError("Baseline Web must be a distinct image built from a different revision")
            self.report["baselineWebImage"] = identity
        return {"revision": self.expected_revision, "components": [*COMPONENTS, "core"]}

    def start_web(self, identity):
        web = self.start_container(
            "web", identity["id"], [],
            environment={
                "CORE_API_ORIGIN": f"http://{self.prefix}-core:3010",
                "CORE_PROXY_TOKEN": self.env["CORE_PROXY_TOKEN"],
                "FRONTEND_TRUSTED_PROXY_HEADER": "none",
                "NEXT_TELEMETRY_DISABLED": "1",
                "BUN_OPTIONS": "--no-env-file",
            },
            memory="1536m",
        )
        self.wait_for(lambda: self.docker.run(
            ["exec", web, "bun", "--no-env-file", "-e", HEALTH_PROBE], timeout=10, check=False,
        ).returncode == 0, "Web-local readiness", 120, web)
        self.web_identity = self.probe(web, WEB_IDENTITY_PROBE, identity["revision"], timeout=15)
        return self.web_identity

    def start_core(self):
        core = self.start_container(
            "core", self.report["coreImage"]["id"], [],
            environment={
                **self.env,
                "RUNTIME_COMPONENT": "core-api",
                "CORE_WEB_ORIGIN": f"http://{self.prefix}-web:3000",
            },
            readonly=True,
            tmpfs=("/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",),
        )
        self.wait_for(lambda: self.docker.run(
            ["exec", core, "bun", "--no-env-file", "-e", CORE_READINESS_PROBE],
            timeout=5, check=False,
        ).returncode == 0, "private Core readiness", 60, core)
        script = CORE_READINESS_PROBE if self.historical_web_first else CORE_OFFLINE_WEB_PROBE
        return self.probe(core, script, timeout=15)

    def container_identity(self, component, image=None):
        raw = self.docker.json(["container", "inspect", self.containers[component]], timeout=10)
        if len(raw) != 1:
            raise SmokeError(f"Missing {component} container identity")
        row = raw[0]
        if (row["Config"]["Labels"].get(OWNER_LABEL) != self.prefix or not row["State"]["Running"]
                or row["State"]["OOMKilled"] or (image is not None and row["Image"] != image)):
            raise SmokeError(f"Unowned, stopped, or unexpected {component} container")
        return {key: row[key] for key in ("Id", "Image", "RestartCount")} | {"startedAt": row["State"]["StartedAt"]}

    def retained_components(self):
        return {component: self.container_identity(component)
                for component in ("core", "postgres", "worker", "realtime")}

    def migration_ledger(self):
        result = self.docker.run([
            "exec", self.containers["postgres"], "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
            "-U", "smoke", "-d", "warpdrive_image_smoke", "-c",
            "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id",
        ], timeout=10)
        hashes = result.stdout.splitlines()
        if not hashes or any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in hashes):
            raise SmokeError("Migration ledger witness is missing or malformed")
        return {"rows": len(hashes), "sha256": sha256("\n".join(hashes).encode()).hexdigest()}

    def replace_web(self, previous, selected):
        current = self.container_identity("web", previous["id"])
        self.docker.run(["stop", "--time", "20", current["Id"]], timeout=30)
        self.docker.run(["rm", current["Id"]], timeout=10)
        core_during_web_outage = self.probe(self.containers["core"], CORE_OFFLINE_WEB_PROBE, timeout=10)
        metadata = self.start_web(selected)
        runtime = self.container_identity("web", selected["id"])
        if runtime["Id"] == current["Id"]:
            raise SmokeError("Web replacement retained the previous container")
        session = self.probe(self.containers["core"], WEB_ROLLOUT_SESSION_PROBE, metadata["version"], timeout=40)
        return {"identity": metadata, "runtime": runtime, "session": session,
                "coreDuringWebOutage": core_during_web_outage}

    def web_rollout(self):
        baseline, candidate = self.report["baselineWebImage"], self.report["images"]["web"]
        retained, ledger = self.retained_components(), self.migration_ledger()
        transitions = {}
        for phase, prior, selected in (("upgrade", baseline, candidate), ("rollback", candidate, baseline)):
            transitions[phase] = self.replace_web(prior, selected)
            if self.retained_components() != retained or self.migration_ledger() != ledger:
                raise SmokeError(f"Web {phase} changed a retained service or the migration ledger")
            self.probe(self.containers["core"], CORE_READINESS_PROBE, timeout=5)
        return {"retainedComponents": retained, "migrationLedger": ledger, **transitions}

    def probe_web(self):
        web = self.containers["web"]
        result = self.probe(web, PUBLIC_HOST + WEB_PROBE, self.public_host, timeout=120)
        deadline = self.clock() + self.stability_seconds
        while self.clock() < deadline:
            self.assert_running(web)
            self.probe(web, HEALTH_PROBE, timeout=10)
            self.sleep(min(3, max(0, deadline - self.clock())))
        return {**result, "sustainedSeconds": self.stability_seconds}

    def drain_core(self):
        core = self.containers["core"]
        self.docker.run(["stop", "--time", "75", core], timeout=80)
        state = self.state(core)
        if state["Running"] or state.get("OOMKilled") or state.get("ExitCode") != 0:
            raise SmokeError("Core image did not drain cleanly")
        self.probe(self.containers["web"], WEB_IDENTITY_PROBE, self.web_identity["sourceRevision"], timeout=15)
        return {"coreDrained": True, "webIdentityServedIndependently": True}

    def probe_authenticated_web(self):
        result = self.docker.run(
            ["exec", self.containers["core"], "bun", "--no-env-file", "-e", CORE_WEB_PROBE,
             self.web_identity["version"]],
            timeout=100, check=False,
        )
        if result.returncode:
            # Only emit a fixed phase and optional HTTP status codes, never raw probe stderr.
            evidence = re.search(
                r"^headless-probe-failed: (core-packaging|core-and-anonymous-http|fixture-seeding|"
                r"native-login|authenticated-ssr|authenticated-rpc|csrf-rejection|durable-write)"
                r"( \(HTTP [1-5]\d{2}, expected [1-5]\d{2}\))?$",
                result.stderr, re.MULTILINE,
            )
            phase = "probe process startup" if evidence is None else evidence[1] + (evidence[2] or "")
            raise SmokeError(f"Authenticated Web probe failed at {phase} (exit {result.returncode})")
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise SmokeError("Authenticated Web probe returned invalid evidence") from error

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("final-image-identities", self.inspect_images)
            self.check("runtime-packaging-and-nonroot", self.packaging)
            self.check("disposable-isolation", self.create_environment)
            self.check("canonical-fresh-and-repeat-migration", self.migrations)
            initial_web = self.report.get("baselineWebImage", self.report["images"]["web"])
            if self.historical_web_first:
                self.check("web-local-health-and-identity-without-core", lambda: self.start_web(initial_web))
                self.check("private-core-readiness", self.start_core)
            else:
                self.check("private-core-readiness-without-web", self.start_core)
                self.check("web-local-health-and-identity", lambda: self.start_web(initial_web))
            self.check("web-login-assets-and-stability", self.probe_web)
            self.check("native-session-ssr-and-durable-write-through-web", self.probe_authenticated_web)
            self.check("realtime-unauthenticated-rejection", self.realtime)
            self.check("worker-durable-job-across-restart", self.worker)
            if self.baseline_web is not None:
                self.check("independent-web-upgrade-and-rollback", self.web_rollout)
            for component in ("web", "worker", "realtime", "core"):
                self.assert_running(self.containers[component])
            self.check("independent-core-drain", self.drain_core)
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            if self.report["failure"] is not None:
                self.report["diagnostics"] = self.failure_diagnostics()
            errors = self.cleanup()
            self.report.update(success=self.report["failure"] is None and not errors, finishedAt=utc_now(),
                               cleanup={"success": not errors, "errors": errors})
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        if self.report["failure"] is not None:
            print(self.report["failure"], file=sys.stderr)
        return self.report["success"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for component in (*COMPONENTS, "core"):
        parser.add_argument(f"--{component}-image", required=True, type=validate_reference)
    parser.add_argument("--expected-revision", required=True, type=validate_revision)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--platform", choices=("linux/amd64", "linux/arm64"), default="linux/amd64")
    parser.add_argument("--baseline-web-image", type=validate_reference)
    parser.add_argument("--baseline-web-revision", type=validate_revision)
    parser.add_argument("--historical-web-first", action="store_true")
    args = parser.parse_args()
    if args.historical_web_first and (
            args.expected_revision != HISTORICAL_WEB_FIRST_REVISION or args.baseline_web_image is not None):
        parser.error("Historical Web-first mode is reserved for the pinned 1.8.1 fixture")
    if (args.baseline_web_image is None) != (args.baseline_web_revision is None):
        parser.error("Baseline Web image and revision must be supplied together")
    baseline = None if args.baseline_web_image is None else (args.baseline_web_image, args.baseline_web_revision)
    images = {component: getattr(args, f"{component}_image") for component in COMPONENTS}
    try:
        smoke = HeadlessImageSmoke(
            Docker(), images, args.core_image, args.output_dir, args.expected_revision,
            platform=args.platform, baseline_web=baseline, historical_web_first=args.historical_web_first,
        )
        return 0 if smoke.run() else 1
    except (SmokeError, ValueError, OSError) as error:
        print(f"Headless image smoke admission failed ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
