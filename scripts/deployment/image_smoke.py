#!/usr/bin/env python3
"""Exercise already-built final images against an owned, disposable local database.

This is a packaging/runtime gate, not installed acceptance. It deliberately has no
build, deployment, source mount, .env loading, production target, or credential input.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import urlsplit
import uuid


OWNER_LABEL = "io.warpdrive.image-smoke.owner"
COMPONENTS = ("web", "worker", "realtime", "migrator")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}\Z")
LIMITATIONS = [
    "Disposable fresh-database final-image packaging/runtime smoke only; no production deployment.",
    "No populated supported-version upgrade, tenant isolation or authenticated application journey.",
    "Realtime checks reject an unauthenticated client; authenticated delivery/reconnect is not qualified.",
    "Worker checks one empty-database file.reaper job across restart; graceful drain is not qualified.",
    "No object-storage operation, newsletter engine, external provider or mailbox delivery is qualified.",
    "No promotion, traffic-switch rollback, data recovery, off-host backup or host-failure drill.",
]


class SmokeError(RuntimeError):
    """A failed required gate, without leaking command arguments or credentials."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_reference(value: str) -> str:
    if not IMAGE.fullmatch(value):
        raise ValueError("Image must be a single Docker reference, not an option or shell expression")
    return value


def validate_revision(value: str) -> str:
    if not REVISION.fullmatch(value):
        raise ValueError("Expected revision must be a lowercase full Git SHA")
    return value


def admit_docker_environment(environment: dict[str, str]) -> None:
    # These overrides can redirect Docker before the selected context is inspected.
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        if environment.get(key):
            raise SmokeError(f"Image smoke refuses {key}; select a local Unix context explicitly")


def admit_endpoint(endpoint: str) -> None:
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "unix" or parsed.netloc or not parsed.path.startswith("/")
            or parsed.query or parsed.fragment):
        raise SmokeError("Image smoke requires a local Unix Docker endpoint")


def image_metadata(raw: Any, expected_revision: str | None) -> dict[str, Any]:
    if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], dict):
        raise SmokeError("Image inspection returned an invalid image record")
    image = raw[0]
    config = image.get("Config") or {}
    user = config.get("User", "")
    revision = (config.get("Labels") or {}).get("org.opencontainers.image.revision", "")
    image_id = image.get("Id", "")
    if (not isinstance(user, str) or not user or user.split(":", 1)[0] in {"root", "0"}):
        raise SmokeError("Final image must declare a non-root runtime user")
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise SmokeError("Final image must identify its exact source revision with an OCI label")
    if expected_revision is not None and revision != expected_revision:
        raise SmokeError("Final image revision does not match the requested source revision")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise SmokeError("Final image has no immutable local image ID")
    digests = image.get("RepoDigests") or []
    if not isinstance(digests, list) or any(not isinstance(item, str) for item in digests):
        raise SmokeError("Image inspection returned invalid registry digests")
    return {"id": image_id, "revision": revision, "user": user, "repoDigests": digests}


def sanitized_log(text: str, secret_values: list[str], byte_limit: int = 8192) -> dict[str, Any]:
    """Redact before truncating, so a boundary cannot reveal part of a secret."""
    for value in sorted(set(secret_values), key=len, reverse=True):
        if len(value) >= 8:
            text = text.replace(value, "[REDACTED]")
    text = re.sub(r"(?i)\b(?:postgres(?:ql)?|mysql|rediss?|mongodb(?:\+srv)?)://[^\s\"'<>]+",
                  "[REDACTED_DATABASE_URL]", text)
    text = re.sub(r"(?i)(https?://)[^\s/@]+:[^\s/@]+@", r"\1[REDACTED]@", text)
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", text)
    text = re.sub(r"(?i)\b(?:set-cookie|cookie)\s*:[^\r\n]+", "Cookie: [REDACTED]", text)
    text = re.sub(
        r'''(?i)(["']?\b\w*(?:secret|password|token|api_key|access_key|signing_key|encryption_key|authorization|database_url)\w*\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)''',
        r"\1[REDACTED]", text,
    )
    lines = text.splitlines(keepends=True)
    truncated = len(lines) > 80 or len(text.encode("utf-8")) > byte_limit
    if truncated:
        marker = "[diagnostic output truncated]\n"
        text = "".join(lines[-79:])
        text = marker + text.encode("utf-8")[-(byte_limit - len(marker)):].decode("utf-8", errors="ignore")
    return {"text": text, "truncated": truncated, "retainedBytes": len(text.encode("utf-8"))}


class Docker:
    """Run only argv-based commands against the admitted, pinned local context."""

    def __init__(self, environment: dict[str, str] | None = None,
                 runner: Callable[..., Any] = subprocess.run):
        source = dict(os.environ if environment is None else environment)
        admit_docker_environment(source)
        # Do not forward application/provider credentials or arbitrary runtime options.
        self.environment = {key: source[key] for key in (
            "PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "SYSTEMROOT",
            "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
        ) if key in source}
        self.runner = runner
        self.context: str | None = None
        context = self.run(["context", "show"], timeout=10).stdout.strip()
        if not context or not re.fullmatch(r"[A-Za-z0-9_.-]+", context):
            raise SmokeError("Docker did not identify an unambiguous context")
        endpoint = self.run([
            "context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}",
        ], timeout=10).stdout.strip()
        admit_endpoint(endpoint)
        self.context = context

    def run(self, arguments: list[str], *, timeout: int = 30,
            check: bool = True) -> Any:
        command = ["docker"]
        if self.context is not None:
            command += ["--context", self.context]
        command += arguments
        try:
            result = self.runner(command, capture_output=True, text=True, timeout=timeout,
                                 env=self.environment, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SmokeError(f"Docker {arguments[0]} did not complete") from error
        if check and result.returncode != 0:
            # Docker commands may contain synthetic secrets and logs may carry private data
            # if an image is accidentally misbuilt. Retain operation/result, never raw argv.
            raise SmokeError(f"Docker {arguments[0]} failed (exit {result.returncode})")
        return result

    def json(self, arguments: list[str], *, timeout: int = 30) -> Any:
        try:
            return json.loads(self.run(arguments, timeout=timeout).stdout)
        except (TypeError, json.JSONDecodeError) as error:
            raise SmokeError(f"Docker {arguments[0]} returned invalid JSON") from error


PACKAGING_PROBE = r"""
import { existsSync } from 'node:fs';
const component = process.env.IMAGE_SMOKE_COMPONENT;
if (typeof process.getuid !== 'function' || process.getuid() === 0) throw Error('Runtime UID is root');
if (existsSync('/app/src') || existsSync('/app/next.config.ts')) throw Error('Raw source in final image');
for (const name of ['.env','.env.local','.env.production','.env.production.local']) {
  if (existsSync('/app/'+name)) throw Error('Environment file in final image');
}
if (component === 'web' && !existsSync('/app/next.config.mjs')) throw Error('Missing bundled config');
if (component !== 'web' && existsSync('/app/.next')) throw Error('Backend image contains Next build');
console.log(JSON.stringify({uid:process.getuid(),rawSourceAbsent:true,component}));
"""

HEALTH_PROBE = r"""
const r = await fetch('http://127.0.0.1:3000/api/health', {signal:AbortSignal.timeout(4000)});
if (!r.ok || (await r.json()).ok !== true) throw Error('Application health is not ready');
console.log(JSON.stringify({ready:true}));
"""

WEB_PROBE = r"""
const origin = 'http://127.0.0.1:3000';
const request = (path) => fetch(new URL(path, origin), {redirect:'manual',signal:AbortSignal.timeout(10000)});
const login = await request('/login');
if (login.status !== 200) throw Error('Login did not render');
for (const [name, value] of [['x-frame-options','DENY'],['x-content-type-options','nosniff']]) {
  if (login.headers.get(name) !== value) throw Error('Security header missing');
}
if (!login.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw Error('CSP missing');
if (login.headers.has('x-powered-by')) throw Error('Framework disclosure header');
const html = await login.text();
const protectedResponse = await request('/pipeline');
const location = protectedResponse.headers.get('location');
if (![302,303,307,308].includes(protectedResponse.status) || !location ||
    new URL(location, origin).pathname !== '/login') throw Error('Protected route did not redirect to login');
const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')))];
let js=0, css=0;
const selected = assets.filter(path=> {
  const url = new URL(path, origin);
  return url.origin === origin && url.pathname.startsWith('/_next/static/') && /\.(?:js|css)$/.test(url.pathname);
}).slice(0,40);
for (const path of selected) {
  const response = await request(path);
  const type = response.headers.get('content-type') || '';
  if (response.status !== 200 || !(await response.arrayBuffer()).byteLength) throw Error('Static asset failed');
  if (new URL(path,origin).pathname.endsWith('.js')) {
    if (!/(?:javascript|ecmascript)/i.test(type)) throw Error('Wrong JS content type'); js++;
  } else { if (!type.includes('text/css')) throw Error('Wrong CSS content type'); css++; }
}
if (!js || !css) throw Error('Login did not exercise both JS and CSS artifacts');
console.log(JSON.stringify({login:200,protectedStatus:protectedResponse.status,jsAssets:js,cssAssets:css,securityHeaders:true}));
"""

WS_PROBE = r"""
import { WebSocket } from 'ws';
await new Promise((resolve,reject)=> {
  const socket = new WebSocket('ws://127.0.0.1:8080');
  const timer = setTimeout(()=> {socket.terminate();reject(Error('WS rejection timed out'));},5000);
  socket.once('open',()=>socket.send(JSON.stringify({kind:'subscribe',channel:'user:00000000-0000-0000-0000-000000000000'})));
  socket.once('error',error=> {clearTimeout(timer);reject(error);});
  socket.once('close',code=> {clearTimeout(timer);code===4401?resolve():reject(Error('WS failed to reject unauthenticated request'));});
});
console.log(JSON.stringify({unauthenticatedCloseCode:4401}));
"""

QUEUE_PROBE = r"""
import { PgBoss } from 'pg-boss';
const mode = process.env.IMAGE_SMOKE_QUEUE_MODE, id = process.env.IMAGE_SMOKE_JOB_ID;
const boss = new PgBoss({connectionString:process.env.DATABASE_URL,max:1,schedule:false,supervise:false,application_name:'image-smoke-producer'});
let backgroundError = false;
boss.on('error',()=> {backgroundError=true;});
try {
  await boss.start();
  const deadline = Date.now()+45000;
  while (!(await boss.getQueue('file.reaper'))) {
    if (backgroundError || Date.now()>=deadline) throw Error('Application worker did not register reaper');
    await Bun.sleep(250);
  }
  if (mode === 'registered') console.log(JSON.stringify({registered:true}));
  else if (mode === 'enqueue') {
    const jobId = await boss.send('file.reaper',{imageSmoke:true},{retryLimit:0});
    if (!jobId) throw Error('No durable job ID');
    const [job] = await boss.findJobs('file.reaper',{id:jobId,limit:1});
    if (job?.state !== 'created') throw Error('Job not persisted while worker is stopped');
    console.log(JSON.stringify({jobId,state:job.state}));
  } else if (mode === 'completed') {
    while (true) {
      const [job] = await boss.findJobs('file.reaper',{id,limit:1});
      if (job?.state === 'completed') {console.log(JSON.stringify({jobId:id,state:job.state}));break;}
      if (backgroundError || ['failed','cancelled'].includes(job?.state) || Date.now()>=deadline) throw Error('Application worker did not complete durable job');
      await Bun.sleep(250);
    }
  } else throw Error('Unknown queue probe');
} finally {await boss.stop({graceful:false,timeout:1000});}
"""


class ImageSmoke:
    def __init__(self, docker: Docker, images: dict[str, str], output_dir: Path,
                 expected_revision: str | None = None, stability_seconds: int = 15,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        if set(images) != set(COMPONENTS):
            raise ValueError("All four component images are required")
        self.images = {name: validate_reference(value) for name, value in images.items()}
        self.expected_revision = validate_revision(expected_revision) if expected_revision else None
        if not 15 <= stability_seconds <= 120:
            raise ValueError("Stability window must be between 15 and 120 seconds")
        self.docker = docker
        self.output_dir = output_dir
        self.stability_seconds = stability_seconds
        self.clock, self.sleep = clock, sleep
        self.prefix = f"wd-image-smoke-{uuid.uuid4().hex[:12]}"
        self.resources: list[tuple[str, str]] = []
        self.containers: dict[str, str] = {}
        password = secrets.token_hex(24)
        self.env = {
            "NODE_ENV": "production", "BUN_OPTIONS": "--no-env-file",
            "BASE_URL": "https://image-smoke.example.invalid",
            "DATABASE_URL": f"postgres://smoke:{password}@postgres:5432/warpdrive_image_smoke",
            "WS_TICKET_SECRET": secrets.token_hex(32), "WS_PUBLIC_URL": "ws://realtime:8080",
            "MINIO_ENDPOINT": "http://127.0.0.1:9", "MINIO_ACCESS_KEY": "image-smoke-only",
            "MINIO_SECRET_KEY": secrets.token_hex(24), "MINIO_BUCKET": "image-smoke-only",
            "TOKEN_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
            "MCP_ENABLED": "false", "OAUTH_REGISTRATION": "disabled",
            "SEED_ADMIN_EMAIL": "smoke@example.invalid", "ALLOW_FIRST_LOGIN_ADMIN": "false",
            "AUTH_SECRET": secrets.token_hex(32), "AUTH_GOOGLE_ENABLED": "false",
            "GOOGLE_OAUTH_CLIENT_ID": "", "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_CALENDAR_OAUTH_CLIENT_ID": "", "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET": "",
            "AUTH_MICROSOFT_CLIENT_ID": "", "AUTH_MICROSOFT_CLIENT_SECRET": "",
            "AUTH_OIDC_PROVIDERS": "[]", "SLACK_CLIENT_ID": "", "SLACK_CLIENT_SECRET": "",
            "AUTH_ALLOW_PASSWORD": "true", "AUTH_ALLOW_PASSKEY": "false",
            "AUTH_MAIL_TRANSPORT": "smtp", "AUTH_MAIL_FROM": "smoke@example.invalid",
            "AUTH_SMTP_HOST": "127.0.0.1", "AUTH_SMTP_PORT": "9",
            "NEWSLETTER_DELIVERY_ENABLED": "false", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
            "NEWSLETTER_BASE_URL": "", "NEWSLETTER_API_USER": "", "NEWSLETTER_API_TOKEN": "",
            "MAIL_INTERNAL_ENDPOINTS": "[]", "WORKFLOW_HTTP_GRANTS": "", "WORKFLOW_WEBHOOK_KEYS": "",
            "BILLING_ENABLED": "false", "POSTHOG_KEY": "", "POSTHOG_HOST": "",
            "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true",
            "NEXT_TELEMETRY_DISABLED": "1", "HOSTNAME": "0.0.0.0", "PORT": "3000",
        }
        # An accidentally baked *_FILE value must never override the generated target.
        for key in (
            "GOOGLE_OAUTH_CLIENT_SECRET", "SLACK_CLIENT_SECRET", "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
            "WS_TICKET_SECRET", "TOKEN_ENCRYPTION_KEY", "MINIO_SECRET_KEY", "DATABASE_URL",
            "OAUTH_SIGNING_KEY", "AUTH_SECRET", "AUTH_SMTP_PASSWORD", "NEWSLETTER_API_TOKEN",
            "AUTH_MICROSOFT_CLIENT_SECRET", "AUTH_OIDC_PROVIDERS", "MAIL_INTERNAL_ENDPOINTS",
            "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "WORKFLOW_HTTP_GRANTS", "WORKFLOW_WEBHOOK_KEYS",
        ):
            self.env[f"{key}_FILE"] = ""
        self.pg_env = {"POSTGRES_USER": "smoke", "POSTGRES_PASSWORD": password,
                       "POSTGRES_DB": "warpdrive_image_smoke"}
        self.report: dict[str, Any] = {
            "schemaVersion": 1, "success": False, "expectedRevision": self.expected_revision,
            "startedAt": utc_now(), "images": {}, "checks": [], "limitations": LIMITATIONS,
            "resources": {"prefix": self.prefix, "network": f"{self.prefix}-network"},
            "cleanup": {"success": False, "errors": []}, "failure": None, "diagnostics": [],
        }

    def check(self, name: str, operation: Callable[[], Any]) -> Any:
        try:
            detail = operation()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed", "detail": {}})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def inspect_images(self) -> dict[str, Any]:
        common_revision = self.expected_revision
        for component in COMPONENTS:
            value = image_metadata(self.docker.json(["image", "inspect", self.images[component]]),
                                   common_revision)
            common_revision = value["revision"]
            self.report["images"][component] = value
        return {"revision": common_revision, "components": list(COMPONENTS)}

    def create_environment(self) -> dict[str, Any]:
        network = self.report["resources"]["network"]
        self.resources.append(("network", network))
        self.docker.run(["network", "create", "--internal", "--label",
                         f"{OWNER_LABEL}={self.prefix}", network])
        internal = self.docker.json(["network", "inspect", network, "--format", "{{json .Internal}}"])
        if internal is not True:
            raise SmokeError("Disposable network does not block external routing")
        volume = f"{self.prefix}-pgdata"
        self.resources.append(("volume", volume))
        self.docker.run(["volume", "create", "--label", f"{OWNER_LABEL}={self.prefix}", volume])
        self.start_container("postgres", "postgres:16-alpine", [], environment=self.pg_env,
                             mount=f"type=volume,source={volume},target=/var/lib/postgresql/data",
                             pull="missing", memory="512m")
        self.wait_for(lambda: self.docker.run([
            "exec", self.containers["postgres"], "pg_isready", "-U", "smoke", "-d",
            "warpdrive_image_smoke",
        ], check=False, timeout=10).returncode == 0, "PostgreSQL readiness", 60,
            self.containers["postgres"])
        return {"internalNetwork": True, "database": "fresh-disposable", "publishedPorts": 0,
                "smtp": "disabled-loopback-port-9", "sourceMounts": 0}

    def start_container(self, component: str, image: str, command: list[str], *,
                        environment: dict[str, str] | None = None, mount: str | None = None,
                        pull: str = "never", memory: str = "768m", network: str | None = None,
                        readonly: bool = False) -> str:
        name = f"{self.prefix}-{component}"
        self.resources.append(("container", name))
        self.containers[component] = name
        args = ["run", "--detach", "--pull", pull, "--name", name, "--label",
                f"{OWNER_LABEL}={self.prefix}", "--network", network or self.report["resources"]["network"],
                "--memory", memory, "--memory-swap", memory, "--cpus", "1", "--pids-limit", "192",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
        if component == "postgres":
            # postgres:alpine starts as root to set ownership, then drops to postgres.
            # A pre-owned volume would need extra bootstrap machinery; retain only
            # the capabilities its official entrypoint needs on this isolated fixture.
            args += ["--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE", "--cap-add", "FOWNER",
                     "--cap-add", "SETGID", "--cap-add", "SETUID"]
        if component == "postgres" or component == "realtime":
            args += ["--network-alias", component]
        if readonly:
            args.append("--read-only")
        if mount:
            args += ["--mount", mount]
        for key, value in sorted((self.env if environment is None else environment).items()):
            args += ["--env", f"{key}={value}"]
        args += [image, *command]
        self.docker.run(args, timeout=120)
        return name

    def state(self, container: str) -> dict[str, Any]:
        value = self.docker.json(["container", "inspect", container, "--format", "{{json .State}}"])
        if not isinstance(value, dict) or not isinstance(value.get("Running"), bool):
            raise SmokeError("Container state is unavailable")
        return value

    def assert_running(self, container: str) -> None:
        state = self.state(container)
        if not state["Running"] or state.get("OOMKilled"):
            raise SmokeError(f"Required process stopped (exit {state.get('ExitCode')}, OOM {bool(state.get('OOMKilled'))})")

    def wait_for(self, condition: Callable[[], bool], description: str, timeout: int,
                 container: str) -> None:
        deadline = self.clock() + timeout
        while True:
            self.assert_running(container)
            if condition():
                return
            if self.clock() >= deadline:
                raise SmokeError(f"Timed out waiting for {description}")
            self.sleep(2)

    def finished(self, container: str, timeout: int = 120) -> None:
        result = self.docker.run(["wait", container], timeout=timeout)
        if result.stdout.strip() != "0":
            raise SmokeError("One-shot final-image command failed")
        state = self.state(container)
        if state["Running"] or state.get("OOMKilled") or state.get("ExitCode") != 0:
            raise SmokeError("One-shot final-image command did not exit successfully")

    def probe(self, container: str, code: str, *arguments: str, timeout: int = 60) -> Any:
        return self.docker.json(["exec", container, "bun", "--no-env-file", "-e", code,
                                 *arguments], timeout=timeout)

    def packaging(self) -> dict[str, Any]:
        details = {}
        for component in COMPONENTS:
            name = self.start_container(f"package-{component}", self.report["images"][component]["id"],
                                        ["bun", "--no-env-file", "-e", PACKAGING_PROBE],
                                        environment={**self.env, "IMAGE_SMOKE_COMPONENT": component},
                                        network="none", readonly=True)
            self.finished(name)
            raw = self.docker.run(["logs", name]).stdout
            try:
                detail = json.loads(raw)
            except json.JSONDecodeError as error:
                raise SmokeError("Packaging probe did not return its runtime UID") from error
            if detail.get("component") != component or not isinstance(detail.get("uid"), int) or detail["uid"] == 0:
                raise SmokeError("Packaging runtime identity was not verified")
            details[component] = detail
        return details

    def migrations(self) -> dict[str, Any]:
        image = self.report["images"]["migrator"]["id"]
        for attempt in (1, 2):
            name = self.start_container(f"migrate-{attempt}", image, ["bun", "dist/migrate.mjs"])
            self.finished(name, 180)
        result = self.docker.run([
            "exec", self.containers["postgres"], "psql", "-U", "smoke", "-d",
            "warpdrive_image_smoke", "-v", "ON_ERROR_STOP=1", "-Atc",
            "SELECT count(*) FROM drizzle.__drizzle_migrations; SELECT count(*) FROM files;",
        ]).stdout.strip().splitlines()
        if len(result) != 2 or not result[0].isdigit() or int(result[0]) < 1 or result[1] != "0":
            raise SmokeError("Fresh canonical migration ledger or empty files fixture not established")
        return {"successfulRuns": 2, "canonicalMigrationCount": int(result[0]), "emptyFiles": True}

    def web(self) -> dict[str, Any]:
        name = self.start_container("web", self.report["images"]["web"]["id"],
                                    ["bun", "--bun", "next", "start"], memory="1536m")
        self.wait_for(lambda: self.docker.run([
            "exec", name, "bun", "--no-env-file", "-e", HEALTH_PROBE,
        ], timeout=10, check=False).returncode == 0, "web HTTP readiness", 120, name)
        result = self.probe(name, WEB_PROBE, timeout=120)
        deadline = self.clock() + self.stability_seconds
        samples = 0
        while True:
            self.assert_running(name)
            self.probe(name, HEALTH_PROBE, timeout=10)
            samples += 1
            if self.clock() >= deadline:
                break
            self.sleep(min(3, max(0, deadline - self.clock())))
        return {**result, "sustainedSeconds": self.stability_seconds, "healthSamples": samples}

    def realtime(self) -> dict[str, Any]:
        name = self.start_container("realtime", self.report["images"]["realtime"]["id"],
                                    ["bun", "dist/ws.mjs"])
        self.wait_for(lambda: self.docker.run([
            "exec", name, "bun", "--no-env-file", "-e",
            "const s=Bun.connect({hostname:'127.0.0.1',port:8080,socket:{data(){},open(s){s.end();},error(){}}});await s;",
        ], timeout=10, check=False).returncode == 0, "realtime listener", 45, name)
        result = self.probe(name, WS_PROBE, timeout=15)
        self.assert_running(name)
        return result

    def queue_helper(self, mode: str, job_id: str | None = None) -> dict[str, Any]:
        name = self.start_container(f"queue-{mode}", self.report["images"]["worker"]["id"],
                                    ["bun", "--no-env-file", "-e", QUEUE_PROBE],
                                    environment={**self.env, "IMAGE_SMOKE_QUEUE_MODE": mode,
                                                 "IMAGE_SMOKE_JOB_ID": job_id or ""})
        self.finished(name, 60)
        try:
            result = json.loads(self.docker.run(["logs", name]).stdout)
        except json.JSONDecodeError as error:
            raise SmokeError("Durable queue probe returned no result") from error
        if not isinstance(result, dict):
            raise SmokeError("Durable queue probe returned an invalid result")
        return result

    def worker(self) -> dict[str, Any]:
        name = self.start_container("worker", self.report["images"]["worker"]["id"],
                                    ["bun", "dist/worker.mjs"], memory="1024m")
        if self.queue_helper("registered") != {"registered": True}:
            raise SmokeError("Application worker did not register its handler")
        self.assert_running(name)
        self.docker.run(["stop", "--time", "10", name], timeout=20)
        if self.state(name)["Running"]:
            raise SmokeError("Worker did not stop before durable enqueue")
        queued = self.queue_helper("enqueue")
        job_id = queued.get("jobId")
        if (queued.get("state") != "created" or not isinstance(job_id, str)
                or not re.fullmatch(r"[0-9a-f-]{36}", job_id)):
            raise SmokeError("Worker job was not durably stored while the consumer was stopped")
        self.docker.run(["start", name])
        completed = self.queue_helper("completed", job_id)
        self.assert_running(name)
        if completed != {"jobId": job_id, "state": "completed"}:
            raise SmokeError("Restarted packaged worker did not complete its queued application job")
        return {"queue": "file.reaper", "persistedWithoutConsumer": True,
                "completedAfterRestart": True, "externalSideEffects": 0}

    def failure_diagnostics(self) -> list[dict[str, Any]]:
        """Read only owned containers; retain at most eight 8-KiB redacted log tails."""
        values = [value for key, value in {**self.env, **self.pg_env}.items()
                  if re.search(r"SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL", key)]
        diagnostics = []
        names = list(dict.fromkeys(name for kind, name in reversed(self.resources) if kind == "container"))[:8]
        for name in names:
            entry: dict[str, Any] = {"container": name}
            try:
                labels = self.docker.json([
                    "container", "inspect", name, "--format", "{{json .Config.Labels}}",
                ], timeout=5)
                if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
                    entry["status"] = "foreign-owner-read-refused"
                else:
                    state = self.docker.json([
                        "container", "inspect", name, "--format", "{{json .State}}",
                    ], timeout=5)
                    entry["state"] = {key: state[key] for key in ("Running", "ExitCode", "OOMKilled")
                                      if isinstance(state.get(key), (bool, int))}
                    logs = self.docker.run(["logs", "--tail", "80", name], timeout=5, check=False)
                    entry["log"] = sanitized_log((logs.stdout or "") + (logs.stderr or ""), values)
                    entry["status"] = "collected" if logs.returncode == 0 else "log-read-failed"
            except Exception:
                # A diagnostic transport failure must not prevent owned-resource cleanup.
                entry["status"] = "unavailable"
            diagnostics.append(entry)
        return diagnostics

    def cleanup(self) -> list[str]:
        errors = []
        # Reverse creation order removes all containers before their volume/network.
        for kind, name in reversed(self.resources):
            label_field = ".Config.Labels" if kind == "container" else ".Labels"
            try:
                inspected = self.docker.run([
                    kind, "inspect", name, "--format", "{{json " + label_field + "}}",
                ], check=False)
                if inspected.returncode != 0:
                    if "No such" in (inspected.stderr or ""):
                        continue
                    raise SmokeError("Owned resource inspection failed")
                labels = json.loads(inspected.stdout)
                if not isinstance(labels, dict) or labels.get(OWNER_LABEL) != self.prefix:
                    raise SmokeError("Resource owner mismatch; removal refused")
                removal = [kind, "rm"] + (["--force"] if kind == "container" else []) + [name]
                self.docker.run(removal)
            except (SmokeError, json.JSONDecodeError) as error:
                errors.append(f"{kind} {name}: {error}")
        return errors

    def run(self) -> bool:
        # Refuse to overwrite another run's evidence.
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("final-image-identities", self.inspect_images)
            self.check("runtime-packaging-and-nonroot", self.packaging)
            self.check("disposable-isolation", self.create_environment)
            self.check("canonical-fresh-and-repeat-migration", self.migrations)
            self.check("web-startup-http-assets-and-stability", self.web)
            self.check("realtime-unauthenticated-rejection", self.realtime)
            self.check("worker-durable-job-across-restart", self.worker)
            for component in ("web", "worker", "realtime"):
                self.assert_running(self.containers[component])
        except Exception as error:
            # Keep reports safe and deterministic: generated command arguments/logs are not emitted.
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
        finally:
            if self.report["failure"] is not None:
                self.report["diagnostics"] = self.failure_diagnostics()
            errors = self.cleanup()
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for component in COMPONENTS:
        parser.add_argument(f"--{component}-image", required=True, type=validate_reference)
    parser.add_argument("--expected-revision", type=validate_revision)
    parser.add_argument("--output-dir", type=Path,
                        default=Path("test-results/image-smoke") / uuid.uuid4().hex)
    parser.add_argument("--stability-seconds", type=int, default=15)
    args = parser.parse_args(arguments)
    try:
        harness = ImageSmoke(Docker(), {name: getattr(args, f"{name}_image") for name in COMPONENTS},
                             args.output_dir, args.expected_revision, args.stability_seconds)
        passed = harness.run()
    except (SmokeError, ValueError, OSError) as error:
        print(f"Image smoke admission failed: {error}", file=sys.stderr)
        return 1
    print(f"Final-image runtime smoke {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
