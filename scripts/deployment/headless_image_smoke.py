"""Qualify the exact headless Web and Core images on disposable PostgreSQL."""

import argparse
import json
from pathlib import Path
import secrets
import sys
from urllib.parse import urlsplit

from image_smoke import (
    COMPONENTS,
    HEALTH_PROBE,
    WEB_PROBE,
    Docker,
    ImageSmoke,
    SmokeError,
    image_metadata,
    utc_now,
    validate_reference,
    validate_revision,
)


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
  version: '1.8.1',
  sourceRevision: process.argv.at(-1),
});
assert(!Object.keys(process.env).some(name => /^(DATABASE_URL|MIGRATION_DATABASE_URL|AUTH_SECRET|AUTH_SMTP_|MINIO_|TOKEN_ENCRYPTION_KEY|WS_TICKET_SECRET)/u.test(name)),
  'Backend configuration entered the Web container');
console.log(JSON.stringify(identity));
"""

CORE_READINESS_PROBE = r"""
const response = await fetch('http://127.0.0.1:3010/readyz', {signal:AbortSignal.timeout(2000)});
if (!response.ok) process.exit(1);
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
import { existsSync, readdirSync } from 'node:fs';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

assert(process.getuid() > 0, 'Core must execute as a non-root user');
assert(!['src','.next','drizzle','node_modules/@ui-sdk'].some(path => existsSync('/app/' + path)),
  'Unexpected Core runtime filesystem');
assert.deepEqual(readdirSync('/app/dist').sort(), ['core-api.mjs','workflow-code-worker.mjs']);
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
  const person = await request('/contacts/people/' + personId, {headers});
  assert.equal(person.status, 200, 'Authenticated Web renders the owned record');
  assert((await person.text()).includes(personName), 'SSR reads the fixture record from Core');
  const version = await request('/api/trpc/version.get', {headers});
  assert.equal(version.status, 200, 'Authenticated tRPC relays through Web');
  assert.equal((await version.json()).result.data.json.current, '1.8.1');

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
  const saved = await save(csrfToken);
  assert.equal(saved.status, 200, 'Authorized mutation succeeds through Web');
  assert.equal((await saved.json()).result.data.json.state, 'created');
  assert.deepEqual(await persistedOwners(), [{owner_id:userId}], 'One durable write for the actual actor');
} finally {
  await client.end();
}
console.log(JSON.stringify({nativeSession:true,authenticatedSsr:true,protectedRpc:true,proxyCredentialRequired:true,
  csrfDenied:true,durableAuthorizedWrite:true,uid:process.getuid()}));
"""


class HeadlessImageSmoke(ImageSmoke):
    def __init__(self, docker, images, core_image, output, revision):
        super().__init__(docker, images, output, revision)
        self.core_image = validate_reference(core_image)
        self.env["CORE_PROXY_TOKEN"] = secrets.token_hex(32)
        self.public_host = urlsplit(self.env["BASE_URL"]).netloc
        self.report["kind"] = "warpdrive-headless-final-image-smoke"
        self.report["limitations"] = [
            "Exact final images exercised on fresh disposable PostgreSQL and an internal Docker bridge.",
            "Realtime rejects unauthenticated traffic. Worker processes one empty-database file reaper job after restart.",
            "Installed ingress, populated upgrades, mixed generations, external providers and production acceptance require separate evidence.",
        ]

    def inspect_images(self):
        local_ids = set()
        for role, reference in {**self.images, "core": self.core_image}.items():
            raw = self.docker.json(["image", "inspect", reference])
            identity = image_metadata(raw, self.expected_revision)
            if raw[0].get("Os") != "linux" or raw[0].get("Architecture") != "amd64":
                raise SmokeError(f"{role} image must be linux/amd64")
            if identity["id"] in local_ids:
                raise SmokeError("Final images must have distinct immutable IDs")
            local_ids.add(identity["id"])
            if role == "core":
                self.report["coreImage"] = identity
            else:
                self.report["images"][role] = identity
        return {"revision": self.expected_revision, "components": [*COMPONENTS, "core"]}

    def start_web(self):
        web = self.start_container(
            "web", self.report["images"]["web"]["id"], [],
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
        return self.probe(web, WEB_IDENTITY_PROBE, self.expected_revision, timeout=15)

    def start_core(self):
        core = self.start_container(
            "core", self.report["coreImage"]["id"], [],
            environment={
                **self.env,
                "RUNTIME_COMPONENT": "core-api",
                "CORE_WEB_ORIGIN": f"http://{self.containers['web']}:3000",
            },
            readonly=True,
        )
        self.wait_for(lambda: self.docker.run(
            ["exec", core, "bun", "--no-env-file", "-e", CORE_READINESS_PROBE],
            timeout=5, check=False,
        ).returncode == 0, "private Core readiness", 60, core)
        return {"ready": True}

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
        self.probe(self.containers["web"], WEB_IDENTITY_PROBE, self.expected_revision, timeout=15)
        return {"coreDrained": True, "webIdentityServedIndependently": True}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("final-image-identities", self.inspect_images)
            self.check("runtime-packaging-and-nonroot", self.packaging)
            self.check("disposable-isolation", self.create_environment)
            self.check("canonical-fresh-and-repeat-migration", self.migrations)
            self.check("web-local-health-and-identity-without-core", self.start_web)
            self.check("private-core-readiness", self.start_core)
            self.check("web-login-assets-and-stability", self.probe_web)
            self.check("native-session-ssr-and-durable-write-through-web",
                       lambda: self.probe(self.containers["core"], CORE_WEB_PROBE, timeout=100))
            self.check("realtime-unauthenticated-rejection", self.realtime)
            self.check("worker-durable-job-across-restart", self.worker)
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
    args = parser.parse_args()
    images = {component: getattr(args, f"{component}_image") for component in COMPONENTS}
    try:
        smoke = HeadlessImageSmoke(Docker(), images, args.core_image, args.output_dir, args.expected_revision)
        return 0 if smoke.run() else 1
    except (SmokeError, ValueError, OSError) as error:
        print(f"Headless image smoke admission failed ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
