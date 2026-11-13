"""Smoke-test an exact optional Core image on the isolated final-image fixture."""

import argparse
import json
from pathlib import Path
import sys

from image_smoke import (
    COMPONENTS, Docker, ImageSmoke, SmokeError, image_metadata, utc_now, validate_reference,
    validate_revision,
)


CORE_PROBE = r"""
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
if (process.getuid() === 0 || existsSync('/app/src') || existsSync('/app/.next') ||
    existsSync('/app/drizzle') || existsSync('/app/node_modules/@ui-sdk'))
  throw Error('Unexpected Core runtime filesystem');
if (readdirSync('/app/dist').sort().join(',') !== 'core-api.mjs,workflow-code-worker.mjs')
  throw Error('Unexpected Core outputs');
const base = 'http://127.0.0.1:3010';
const get = (path) => fetch(base + path, {signal:AbortSignal.timeout(5000),redirect:'manual'});
if ((await get('/healthz')).status !== 200 || (await get('/readyz')).status !== 200)
  throw Error('Core is unavailable');
const denied = await get('/api/trpc/version.get');
if (denied.status !== 401) throw Error('Anonymous protected Core RPC was not denied');
if ((await get('/login')).status !== 404) throw Error('Web page leaked into Core routing');
const web = new URL(process.env.CORE_WEB_ORIGIN);
const dbUrl = new URL(process.env.DATABASE_URL);
assert.match(web.hostname, /^wd-image-smoke-[a-f0-9]{12}-web$/u);
assert.equal(web.port,'3000');
assert.equal(dbUrl.hostname,'postgres');
assert.equal(dbUrl.pathname,'/warpdrive_image_smoke');
assert.equal(dbUrl.username,'smoke_runtime');
const userId = randomUUID();
const email = `${userId}@example.invalid`;
const password = randomBytes(32).toString('base64url');
const client = new pg.Client({connectionString:dbUrl.href,connectionTimeoutMillis:3000,statement_timeout:3000});
await client.connect();
try {
  const before = await client.query('SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM sessions)::int AS sessions');
  assert.deepEqual(before.rows,[{users:0,sessions:0}]);
  await client.query('BEGIN');
  await client.query("INSERT INTO users(id,email,name,is_admin,is_active) VALUES($1,$2,'Core image fixture',false,true)",[userId,email]);
  await client.query("INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,'Core image fixture',true,false)",[userId,email]);
  await client.query("INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES($1,$2,'credential',$3)",[userId,userId,await hashPassword(password)]);
  await client.query('COMMIT');
  const origin = process.env.BASE_URL;
  const login = await fetch(new URL('/api/auth/sign-in/email',web),{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
    headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'},
    body:JSON.stringify({email,password}),
  });
  assert.equal(login.status,200);
  const cookies = login.headers.getSetCookie().filter(value => value.startsWith('wd_sid='));
  assert.equal(cookies.length,1);
  const csrfToken = randomBytes(32).toString('base64url');
  const headers = {origin,cookie:`${cookies[0].split(';',1)[0]}; wd_csrf=${csrfToken}`,'sec-fetch-site':'same-origin'};
  const webVersion = (await (await fetch(new URL('/api/runtime/web-identity',web),{
    signal:AbortSignal.timeout(5000),redirect:'manual',
  })).json()).version;
  const version = await fetch(`${base}/api/trpc/version.get`,{headers,signal:AbortSignal.timeout(5000),redirect:'manual'});
  assert.equal(version.status,200);
  assert.equal((await version.json()).result.data.json.current,webVersion);
  const name = `Core image report ${userId}`;
  const definition = {version:1,from:'2026-01-01',to:'2026-01-31',currency:'EUR',pipelineId:null,ownerScope:{kind:'me'}};
  const save = token => fetch(`${base}/api/trpc/stats.savedPerformance.create`,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({json:{name,definition,csrfToken:token}}),
  });
  assert.equal((await save(null)).status,403);
  const count = async () => (await client.query("SELECT owner_id FROM saved_filters WHERE target_entity='stats-performance-report' AND name=$1",[name])).rows;
  assert.deepEqual(await count(),[]);
  const saved = await save(csrfToken);
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).result.data.json.state,'created');
  assert.deepEqual(await count(),[{owner_id:userId}]);
} finally {
  await client.end();
}
console.log(JSON.stringify({ready:true,anonymousDenied:true,webPageAbsent:true,noCheckout:true,
  nativeWebSession:true,acceptedWebVersion:true,csrfDenied:true,durableAuthorizedWrite:true,uid:process.getuid()}));
"""


class CoreImageSmoke(ImageSmoke):
    def __init__(self, docker, images, core_image, output, revision):
        super().__init__(docker, images, output, revision)
        self.core_image = validate_reference(core_image)
        self.report["kind"] = "warpdrive-optional-core-final-image-smoke"
        self.report["limitations"] = [
            "Uses the exact fresh Web and Migrator fixture images and one synthetic database.",
            "Installed ingress, mixed release custody and full cross-version application acceptance remain separate.",
        ]

    def core(self):
        raw = self.docker.json(["image", "inspect", self.core_image])
        identity = image_metadata(raw, self.expected_revision)
        if raw[0].get("Os") != "linux" or raw[0].get("Architecture") != "amd64":
            raise SmokeError("Core image architecture differs from the admitted build")
        if identity["id"] in {image["id"] for image in self.report["images"].values()}:
            raise SmokeError("Core image must be distinct from the retained four artifacts")
        self.report["coreImage"] = identity
        web = self.containers["web"]
        self.env["CORE_WEB_ORIGIN"] = f"http://{web}:3000"
        environment = {**self.env, "RUNTIME_COMPONENT": "core-api",
                       "CORE_HOST": "0.0.0.0", "CORE_PORT": "3010"}
        name = self.start_container("core", identity["id"], [], environment=environment,
                                    memory="768m", readonly=True)
        self.wait_for(lambda: self.docker.run([
            "exec", name, "bun", "--no-env-file", "-e",
            "if (!(await fetch('http://127.0.0.1:3010/readyz',{signal:AbortSignal.timeout(2000)})).ok) process.exit(1)",
        ], check=False, timeout=5).returncode == 0, "Core ready", 60, name)
        result = self.probe(name, CORE_PROBE, timeout=40)
        self.docker.run(["stop", "--time", "75", name], timeout=80)
        state = self.state(name)
        if state["Running"] or state.get("OOMKilled") or state.get("ExitCode") != 0:
            raise SmokeError("Core image did not drain successfully")
        rejected = self.start_container(
            "core-bad-metadata", identity["id"], [],
            environment={**environment, "CORE_WEB_ORIGIN": "http://127.0.0.1:1"},
            memory="768m", readonly=True,
        )
        rejected_exit = self.docker.run(["wait", rejected], timeout=60).stdout.strip()
        rejected_state = self.state(rejected)
        if (rejected_exit != "1" or rejected_state["Running"] or rejected_state.get("OOMKilled")
                or rejected_state.get("ExitCode") != 1):
            raise SmokeError("Core image did not reject unavailable Web metadata")
        return {**result, "drained": True, "unavailableMetadataRejected": True}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("final-image-identities", self.inspect_images)
            self.check("disposable-isolation", self.create_environment)
            self.check("canonical-fresh-and-repeat-migration", self.migrations)
            self.check("accepted-web-fixture", self.web)
            self.check("optional-core-http-and-drain", self.core)
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            if self.report["failure"] is not None:
                self.report["diagnostics"] = self.failure_diagnostics()
            errors = self.cleanup()
            self.report.update(success=self.report["failure"] is None and not errors, finishedAt=utc_now(),
                               cleanup={"success": not errors, "errors": errors})
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for component in (*COMPONENTS, "core"):
        parser.add_argument(f"--{component}-image", required=True, type=validate_reference)
    parser.add_argument("--expected-revision", required=True, type=validate_revision)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    images = {name: getattr(args, f"{name}_image") for name in COMPONENTS}
    try:
        return 0 if CoreImageSmoke(Docker(), images, args.core_image, args.output_dir, args.expected_revision).run() else 1
    except (SmokeError, ValueError, OSError) as error:
        print(f"Core image smoke admission failed ({type(error).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
