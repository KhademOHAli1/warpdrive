#!/usr/bin/env python3
"""Native isolated Caddy/Web switch rehearsal using a verified retained image bundle.

No build, Compose traversal, production target, credential, provider or deployment is
accepted. Only generated fixture configuration is mounted. Runtime results, not this
harness's unit tests, establish the bounded native rehearsal evidence.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

try:
    from .bundle import load_bundle
    from .image_smoke import COMPONENTS, HEALTH_PROBE, OWNER_LABEL, ImageSmoke, SmokeError, utc_now, validate_revision
    from .registry_smoke import IsolatedDocker, loopback_authority
    from . import loopback_forwarder as relay
    from . import web_switch as engine
except ImportError:
    from bundle import load_bundle
    from image_smoke import COMPONENTS, HEALTH_PROBE, OWNER_LABEL, ImageSmoke, SmokeError, utc_now, validate_revision
    from registry_smoke import IsolatedDocker, loopback_authority
    import loopback_forwarder as relay
    import web_switch as engine


OPERATION_LABEL = "io.warpdrive.web-switch.operation"
GENERATION_HEADER = "X-Warpdrive-Rehearsal-Generation"
MAX_HTTP_BYTES = 256 * 1024
MAX_SCHEMA_BYTES = 2 * 1024 * 1024
CADDY_TMPFS = ("/data:rw,noexec,nosuid,nodev,size=16m", "/config:rw,noexec,nosuid,nodev,size=16m")
ADMIN_HOST = "localhost:2019"
MIB = 1024 ** 2
MEMORY_LIMITS_MIB = {"web-a": 1536, "web-rejected": 1536, "web-b": 1536, "web-c": 1536,
                     "worker": 1024, "realtime": 768, "postgres": 512, "caddy": 256, "caddy-adapt": 256}
HOST_RESERVE_BYTES = 1024 ** 3
LIMITATIONS = [
    "Isolated native Caddy same-image/source/configuration/schema Web rehearsal only; no production deployment authorization.",
    "A lost acknowledgement is injected after a real successful Caddy PATCH; no actual network partition is claimed.",
    "No old/new API or schema compatibility, automatic rollback, populated upgrade, authentication journey or data recovery is qualified.",
    "The internal network has no external route; only owned native-host loopback relays expose fixed fixture ports.",
    "Schema identity is a bounded migration-ledger/public-column/constraint projection, not full PostgreSQL physical integrity.",
]

SCHEMA_SQL = """BEGIN READ ONLY; SET LOCAL statement_timeout='3s';
SELECT json_build_object(
 'ledger',(SELECT coalesce(json_agg(row_to_json(m) ORDER BY id),'[]'::json) FROM drizzle.__drizzle_migrations m),
 'columns',(SELECT coalesce(json_agg(row_to_json(c) ORDER BY table_name,ordinal_position),'[]'::json)
   FROM (SELECT table_name,ordinal_position,column_name,data_type,udt_name,is_nullable,column_default
         FROM information_schema.columns WHERE table_schema='public') c),
 'constraints',(SELECT coalesce(json_agg(row_to_json(c) ORDER BY relation,definition),'[]'::json)
   FROM (SELECT conrelid::regclass::text AS relation,pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE connamespace='public'::regnamespace) c)); ROLLBACK;"""


class WebSwitchSmokeError(SmokeError):
    pass


def require(condition, message):
    if not condition:
        raise WebSwitchSmokeError(message)


def memory_budget(meminfo):
    require(isinstance(meminfo, str) and 0 < len(meminfo) <= 65536, "bounded native Linux memory information required")
    matches = re.findall(r"^MemAvailable:[ \t]+([0-9]+)[ \t]+kB[ \t]*$", meminfo, re.MULTILINE)
    require(len(matches) == 1 and len(re.findall(r"^MemAvailable:", meminfo, re.MULTILINE)) == 1,
            "one MemAvailable value in native Linux kB required")
    available = int(matches[0]) * 1024
    require(0 < available <= 2 ** 63, "native available-memory value is invalid")
    configured = {name: amount * MIB for name, amount in MEMORY_LIMITS_MIB.items()}
    required = sum(configured.values()) + HOST_RESERVE_BYTES
    return {"source": "native Linux /proc/meminfo MemAvailable", "availableBytes": available,
            "configuredPeakLimitsBytes": configured, "configuredPeakBytes": sum(configured.values()),
            "hostReserveBytes": HOST_RESERVE_BYTES, "requiredBytes": required, "admitted": available >= required,
            "limitation": "Conservative configured-limit admission, not reserved capacity or a production sizing result."}


def memory_peak(result):
    text = result.stdout.strip()
    if result.returncode != 0 or not re.fullmatch(r"[0-9]{1,20}", text) or int(text) > 2 ** 63:
        return {"status": "unavailable", "bytes": None}
    return {"status": "observed", "bytes": int(text)}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *arguments):
        raise WebSwitchSmokeError("Fixture HTTP redirect refused")


class FixtureHTTP:
    """Only fixed root-config and health requests to an admitted loopback relay."""
    def __init__(self, authority, owned, *, admin=False, opener=None):
        self.authority = loopback_authority(authority)
        self.owned, self.admin = owned, admin
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method="GET", *, value=None, etag=None):
        require((self.admin and method in {"GET", "PATCH"}) or (not self.admin and method == "GET"),
                "fixed fixture HTTP operation required")
        self.owned()
        path = "/config/" if self.admin else "/api/health"
        headers = {"Connection": "close", "Accept": "application/json"}
        if self.admin:
            # TCP still targets the owned numeric loopback relay. Match Caddy's
            # explicitly narrow origin policy instead of its ephemeral relay port.
            headers.update({"Host": ADMIN_HOST, "Origin": "http://" + ADMIN_HOST})
        data = None
        if method == "PATCH":
            require(isinstance(etag, str) and 1 <= len(etag) <= 256 and "\n" not in etag and "\r" not in etag,
                    "actual bounded Caddy Etag required")
            data = engine.canonical(value)
            require(len(data) <= MAX_HTTP_BYTES, "fixture configuration exceeds byte bound")
            headers.update({"Content-Type": "application/json", "If-Match": etag})
        request = Request("http://" + self.authority + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=4)
        except HTTPError as error:
            response = error
        except (URLError, OSError, ValueError) as error:
            raise WebSwitchSmokeError("Fixture HTTP transport outcome unavailable") from error
        with response:
            body = response.read(MAX_HTTP_BYTES + 1)
            require(len(body) <= MAX_HTTP_BYTES, "fixture HTTP response exceeds byte bound")
            status = response.status if hasattr(response, "status") else response.code
            selected = {key.lower(): value for key, value in response.headers.items()
                        if key.lower() in {"etag", GENERATION_HEADER.lower()}}
            return status, selected, body

    def config(self):
        status, headers, body = self.request()
        require(status == 200 and "etag" in headers, "Caddy config/Etag readback unavailable")
        value = json.loads(body)
        require(isinstance(value, dict), "Caddy full root configuration required")
        return value, headers["etag"]

    def health(self):
        status, headers, body = self.request()
        try:
            healthy = status == 200 and json.loads(body).get("ok") is True
        except (ValueError, AttributeError):
            healthy = False
        return healthy, headers.get(GENERATION_HEADER.lower())


def _walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def route_values(config):
    web = [item for item in _walk(config) if item.get("handler") == "reverse_proxy"
           and isinstance(item.get("upstreams"), list)
           and len(item["upstreams"]) == 1
           and str(item["upstreams"][0].get("dial", "")).endswith(":3000")]
    generations = [item[GENERATION_HEADER] for item in _walk(config) if GENERATION_HEADER in item]
    require(len(web) == 1 and len(generations) == 1 and isinstance(generations[0], list)
            and len(generations[0]) == 1 and isinstance(generations[0][0], str),
            "fixture must have one Web upstream and one generation response header")
    name = web[0]["upstreams"][0]["dial"].removesuffix(":3000")
    require(bool(re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,63}", name)), "fixed owned Web upstream name required")
    return name, generations[0][0]


def desired_config(config, old_name, candidate_name, old_generation, new_generation):
    require(route_values(config) == (old_name, old_generation), "active config differs from fixed switch baseline")
    result = copy.deepcopy(config)
    changed_upstream = changed_header = 0
    for item in _walk(result):
        if item.get("handler") == "reverse_proxy" and item.get("upstreams") == [{"dial": old_name + ":3000"}]:
            item["upstreams"] = [{"dial": candidate_name + ":3000"}]
            changed_upstream += 1
        if item.get(GENERATION_HEADER) == [old_generation]:
            item[GENERATION_HEADER] = [new_generation]
            changed_header += 1
    require((changed_upstream, changed_header) == (1, 1)
            and route_values(result) == (candidate_name, new_generation), "only Web upstream and generation may change")
    return result


def fixture_caddyfile(web_name, realtime_name):
    return ("{\n auto_https off\n admin 0.0.0.0:2019 {\n origins localhost:2019\n enforce_origin\n }\n"
            " persist_config off\n}\n:8080 {\n request_body {\n max_size 80MB\n }\n"
            f" header {GENERATION_HEADER} generation-a\n @ws path /_ws*\n reverse_proxy @ws {realtime_name}:8080\n"
            f" reverse_proxy {web_name}:3000 {{\n header_up X-Real-IP {{remote_host}}\n }}\n}}\n")


def caddy_storage(row):
    """Prove bounded ephemeral Caddy directories without deleting any volume."""
    host = row.get("HostConfig", {})
    expected = {specification.split(":", 1)[0]: specification.split(":", 1)[1] for specification in CADDY_TMPFS}
    require(host.get("ReadonlyRootfs") is True and host.get("Tmpfs") == expected,
            "Caddy fixture requires both explicit bounded tmpfs directories")
    mounts = row.get("Mounts")
    require(isinstance(mounts, list) and not any(mount.get("Type") == "volume" for mount in mounts),
            "Caddy fixture must not create or retain anonymous volumes")
    require(all(mount.get("Type") in {"bind", "tmpfs"} for mount in mounts), "unexpected Caddy fixture mount type")
    return {"readOnlyRoot": True, "boundedTmpfs": expected, "anonymousVolumeMounts": 0,
            "actualMountTypes": sorted({mount["Type"] for mount in mounts})}


def caddy_image(docker):
    inspected = docker.run(["image", "inspect", "caddy:2-alpine"], check=False, timeout=10)
    if inspected.returncode != 0:
        require("no such image" in inspected.stderr.lower(), "Caddy image inspection is indeterminate")
        docker.run(["image", "pull", "--platform", "linux/amd64", "caddy:2-alpine"], timeout=120)
        rows = docker.json(["image", "inspect", "caddy:2-alpine"])
    else:
        rows = json.loads(inspected.stdout)
    require(isinstance(rows, list) and len(rows) == 1 and rows[0].get("Os") == "linux"
            and rows[0].get("Architecture") == "amd64", "native Caddy image required")
    volumes = (rows[0].get("Config") or {}).get("Volumes") or {}
    require(isinstance(volumes, dict) and set(volumes) <= {"/data", "/config"},
            "Caddy image declares an unbounded fixture volume")
    return rows[0]["Id"]


class HealthWatch:
    def __init__(self, client):
        self.client = client
        self.stop_event = threading.Event()
        self.samples = []
        self.exhausted = False
        self.thread = threading.Thread(target=self._run, name="owned-web-switch-health", daemon=True)

    def _run(self):
        while not self.stop_event.is_set() and len(self.samples) < 180:
            try:
                healthy, generation = self.client.health()
                self.samples.append({"healthy": healthy, "generation": generation})
            except Exception:
                self.samples.append({"healthy": False, "generation": None})
            self.stop_event.wait(2)
        self.exhausted = not self.stop_event.is_set()

    def start(self):
        self.thread.start()
        return self

    def close(self):
        self.stop_event.set()
        self.thread.join(5)
        require(not self.thread.is_alive(), "owned background health thread did not stop")


class CaddySwitchAdapter:
    """One harness-owned target and precomputed plan/config; never an arbitrary deployment adapter."""
    def __init__(self, harness, plan, desired, *, reject_readiness=False, lose_ack=False):
        self.harness, self.plan, self.desired = harness, copy.deepcopy(plan), copy.deepcopy(desired)
        self.reject_readiness, self.lose_ack = reject_readiness, lose_ack
        self.patch_attempts = self.created = 0

    def _plan(self, plan):
        require(plan == self.plan and engine.content_hash(self.desired) == plan["desiredRouteFingerprint"],
                "adapter accepts only its fixed precomputed rehearsal plan")

    def inspect(self, accepted_runtime, candidate_name):
        require(accepted_runtime["name"] in self.harness.web_names
                and candidate_name in {None, self.plan["candidateName"]}, "fixture runtime target escapes owned names")
        candidate = self.harness.runtime(candidate_name, allow_absent=True, candidate=True) if candidate_name else None
        return {"acceptedRuntime": self.harness.runtime(accepted_runtime["name"]),
                "candidateRuntime": candidate, "route": self.harness.actual_route(),
                "unrelatedFingerprint": engine.content_hash(self.harness.unrelated())}

    def create_candidate(self, plan):
        self._plan(plan)
        self.harness.start_web(plan["candidateName"], operation=plan["operationId"])
        self.created += 1
        self.harness.wait_web(plan["candidateName"])
        if self.reject_readiness:
            self.harness.owned(plan["candidateName"])
            self.harness.docker.run(["pause", plan["candidateName"]], timeout=10)

    def candidate_ready(self, plan):
        self._plan(plan)
        self.harness.owned(plan["candidateName"])
        result = self.harness.docker.run(["exec", plan["candidateName"], "bun", "--no-env-file", "-e", HEALTH_PROBE],
                                         check=False, timeout=8)
        return result.returncode == 0

    def apply_route(self, plan, expected_route_fingerprint):
        self._plan(plan)
        current, etag = self.harness.admin.config()
        if engine.content_hash(current) != expected_route_fingerprint:
            raise engine.DefiniteRejected("actual route precondition rejected before PATCH")
        self.patch_attempts += 1
        status, _, _ = self.harness.admin.request("PATCH", value=self.desired, etag=etag)
        if status == 412:
            raise engine.DefiniteRejected("actual Caddy If-Match precondition rejected")
        require(status == 200, "Caddy route application outcome needs inspection")
        if self.lose_ack:
            self.lose_ack = False
            raise TimeoutError("injected lost acknowledgement after actual Caddy apply")

    def observe_route(self, plan):
        self._plan(plan)
        actual = self.harness.actual_route()
        healthy, generation = self.harness.traffic.health()
        return {**actual, "healthy": healthy and generation == actual["generation"]}


class WebSwitchSmoke:
    def __init__(self, docker, bundle_dir, expected_revision, output_dir):
        self.docker, self.bundle_dir = docker, bundle_dir
        self.revision, self.output_dir = validate_revision(expected_revision), Path(output_dir)
        self.fixture = None
        self.relays, self.web_names, self.protected_names = [], set(), []
        self.watch = None
        self.report = {"schemaVersion": 1, "kind": "warpdrive-native-caddy-web-switch-smoke", "success": False,
                       "revision": self.revision, "startedAt": utc_now(), "checks": [], "images": {},
                       "limitations": LIMITATIONS, "failure": None, "diagnostics": [],
                       "cleanup": {"success": False, "errors": []}}

    def check(self, name, operation):
        try:
            detail = operation()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed"})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def load(self):
        architecture = self.docker.run(["info", "--format", "{{.Architecture}}"], timeout=10).stdout.strip()
        require(architecture in {"amd64", "x86_64"}, "native AMD64 Docker daemon required")
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        images = {name: loaded["candidate"]["components"][name]["imageId"] for name in COMPONENTS}
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.output_dir / "fixture", expected_revision=self.revision)
        self.fixture.inspect_images()
        self.report["images"] = self.fixture.report["images"]
        self.web_image = images["web"]
        return {"archiveSha256": loaded["provenance"]["archiveSha256"], "rebuilds": 0, "nativeArchitecture": architecture}

    def owned(self, name, allow_absent=False):
        require(name.startswith(self.fixture.prefix + "-"), "foreign container name refused")
        result = self.docker.run(["container", "inspect", name], timeout=10, check=False)
        if result.returncode != 0:
            if allow_absent and "no such" in result.stderr.lower():
                return None
            raise WebSwitchSmokeError("owned fixture inspection unavailable")
        rows = json.loads(result.stdout)
        require(isinstance(rows, list) and len(rows) == 1, "one owned container required")
        row = rows[0]
        require(row.get("Name") == "/" + name and (row.get("Config", {}).get("Labels") or {}).get(OWNER_LABEL) == self.fixture.prefix
                and isinstance(row.get("Id"), str) and re.fullmatch(r"[0-9a-f]{64}", row["Id"]),
                "owned container identity mismatch")
        return row

    def schema(self):
        name = self.fixture.containers["postgres"]
        self.owned(name)
        result = self.docker.run(["exec", name, "psql", "-XqAt", "-U", "smoke", "-d", "warpdrive_image_smoke",
                                  "-v", "ON_ERROR_STOP=1", "-c", SCHEMA_SQL], timeout=10).stdout.strip()
        require(len(result.encode()) <= MAX_SCHEMA_BYTES, "schema fingerprint exceeds bound")
        return engine.content_hash(json.loads(result))

    def runtime(self, name, *, allow_absent=False, candidate=False):
        row = self.owned(name, allow_absent)
        if row is None:
            return None
        require(name in self.web_names and row["Image"] == self.web_image, "untested Web runtime refused")
        config = copy.deepcopy(row["Config"])
        config.pop("Hostname", None)
        labels = config.pop("Labels", {}) or {}
        # Name/ownership distinguish slots; their executable and application config must match.
        normalized = {"Config": config, "Labels": {key: value for key, value in labels.items() if key != OPERATION_LABEL},
                      "HostConfig": row["HostConfig"], "Mounts": row.get("Mounts", [])}
        require(row.get("State", {}).get("Running") is True and not row["State"].get("OOMKilled"), "Web runtime is not running")
        result = {"runtimeId": row["Id"], "name": name, "imageId": row["Image"], "sourceRevision": self.revision,
                  "configSha256": engine.content_hash(normalized), "schemaSha256": self.schema(),
                  "restartCount": row.get("RestartCount"), "running": True}
        if candidate:
            result["ownerOperation"] = labels.get(OPERATION_LABEL)
        return result

    def unrelated(self):
        result = {}
        for name in self.protected_names:
            row = self.owned(name)
            require(row.get("State", {}).get("Running") is True and not row["State"].get("OOMKilled"), "protected fixture service stopped")
            result[name] = {"id": row["Id"], "imageId": row["Image"], "restarts": row.get("RestartCount"), "running": True}
        return result

    def actual_route(self):
        config, _ = self.admin.config()
        name, generation = route_values(config)
        require(name in self.web_names, "active Caddy route escapes fixture Web slots")
        row = self.owned(name)
        return {"generation": generation, "fingerprint": engine.content_hash(config), "runtimeId": row["Id"]}

    def start_web(self, name, operation=None):
        require(name.startswith(self.fixture.prefix + "-") and name in self.web_names, "fixed fixture Web name required")
        self.fixture.resources.append(("container", name))
        args = ["run", "--detach", "--pull", "never", "--name", name, "--label", f"{OWNER_LABEL}={self.fixture.prefix}",
                "--network", self.fixture.report["resources"]["network"], "--memory", "1536m", "--memory-swap", "1536m",
                "--cpus", "1", "--pids-limit", "192", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
        if operation:
            args += ["--label", f"{OPERATION_LABEL}={operation}"]
        for key, value in sorted(self.fixture.env.items()):
            args += ["--env", f"{key}={value}"]
        self.docker.run([*args, self.web_image, "bun", "--bun", "next", "start"], timeout=120)

    def wait_web(self, name):
        self.fixture.wait_for(lambda: self.docker.run(["exec", name, "bun", "--no-env-file", "-e", HEALTH_PROBE],
                                                     timeout=8, check=False).returncode == 0,
                              "isolated Web readiness", 90, name)

    def setup(self):
        require(sys.platform == "linux", "this capacity admission requires the native Linux runner")
        with Path("/proc/meminfo").open(encoding="ascii") as source:
            self.report["memoryAdmission"] = memory_budget(source.read(65537))
        require(self.report["memoryAdmission"]["admitted"], "native memory cannot cover fixture peak limits plus 1 GiB reserve")
        self.fixture.output_dir.mkdir(parents=True, exist_ok=False)
        isolation = self.fixture.create_environment()
        migrations = self.fixture.migrations()
        self.fixture.realtime()
        worker = self.fixture.start_container("worker", self.fixture.report["images"]["worker"]["id"],
                                               ["bun", "dist/worker.mjs"], memory="1024m")
        require(self.fixture.queue_helper("registered") == {"registered": True}, "real worker queue not registered")
        self.fixture.assert_running(worker)
        self.web_a = self.fixture.prefix + "-web-a"
        self.web_names = {self.web_a, *(self.fixture.prefix + "-" + suffix for suffix in ("web-rejected", "web-b", "web-c"))}
        self.start_web(self.web_a)
        self.wait_web(self.web_a)
        caddyfile = self.fixture.output_dir / "Caddyfile.generated"
        caddyfile.write_text(fixture_caddyfile(self.web_a, self.fixture.containers["realtime"]))
        mount = f"type=bind,source={caddyfile.resolve()},target=/etc/caddy/Caddyfile,readonly"
        caddy_id = caddy_image(self.docker)
        adapt = self.fixture.start_container("caddy-adapt", caddy_id, ["caddy", "adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
                                               environment={}, mount=mount, memory="256m", network="none", readonly=True, tmpfs=CADDY_TMPFS)
        self.fixture.finished(adapt, 30)
        adapt_storage = caddy_storage(self.owned(adapt))
        adapted = json.loads(self.docker.run(["logs", adapt], timeout=10).stdout)
        require(route_values(adapted) == (self.web_a, "generation-a"), "generated Caddy fixture adaptation changed")
        require(adapted.get("admin", {}).get("origins") == [ADMIN_HOST]
                and adapted["admin"].get("enforce_origin") is True, "Caddy fixture origin policy differs from fixed client headers")
        self.caddy = self.fixture.start_container("caddy", caddy_id, ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
                                                  environment={}, mount=mount, memory="256m", readonly=True, tmpfs=CADDY_TMPFS)
        runtime_storage = caddy_storage(self.owned(self.caddy))
        version = self.docker.run(["exec", self.caddy, "caddy", "version"], timeout=10).stdout.strip()
        require(1 <= len(version) <= 256, "bounded Caddy runtime version required")
        for port in (2019, 8080):
            forwarding = relay.owned_bridge_forwarder(self.docker, owner_label=OWNER_LABEL, owner=self.fixture.prefix,
                                                       network_name=self.fixture.report["resources"]["network"], container_name=self.caddy,
                                                       port=port, lifetime_seconds=30, total_bytes=64 * 1024 ** 2).start()
            self.relays.append(forwarding)
        self.admin = FixtureHTTP(self.relays[0].authority, lambda: self.owned(self.caddy), admin=True)
        self.traffic = FixtureHTTP(self.relays[1].authority, lambda: self.owned(self.caddy))
        self.fixture.wait_for(lambda: self.traffic.health() == (True, "generation-a"), "proxied accepted Web readiness", 30, self.caddy)
        self.protected_names = [self.fixture.containers[name] for name in ("postgres", "worker", "realtime")] + [self.caddy, self.web_a]
        self.protected = self.unrelated()
        self.accepted = {"schemaVersion": 1, "kind": "warpdrive-accepted-web", "scope": engine.SCOPE,
                         "targetKey": self.fixture.prefix, "runtime": self.runtime(self.web_a),
                         "route": self.actual_route(), "unrelatedFingerprint": engine.content_hash(self.protected)}
        self.state_dir = self.output_dir / "switch-state"
        self.watch = HealthWatch(self.traffic).start()
        return {"isolation": isolation, "migrationsBeforeRehearsal": migrations, "caddyImageId": caddy_id,
                "caddyVersion": version, "protectedServiceIds": self.protected,
                "caddyStorage": {"adapt": adapt_storage, "runtime": runtime_storage}, "fixedAdminHost": ADMIN_HOST,
                "loopbackRelays": [item.target_metadata for item in self.relays], "generatedConfigOnly": True}

    def cas(self):
        config, etag = self.admin.config()
        status, _, _ = self.admin.request("PATCH", value=config, etag='"/config/ deliberately-stale"')
        after, _ = self.admin.config()
        require(status == 412 and after == config and self.traffic.health() == (True, "generation-a"),
                "actual Caddy If-Match rejection did not preserve accepted config and traffic")
        return {"rejectedStatus": status, "unchangedConfigSha256": engine.content_hash(after), "actualEtagObserved": bool(etag)}

    def prepare(self, operation, suffix, **adapter_options):
        config, _ = self.admin.config()
        old, generation = route_values(config)
        name = self.fixture.prefix + "-" + suffix
        desired = desired_config(config, old, name, generation, operation)
        value = {"schemaVersion": 1, "kind": "warpdrive-isolated-web-switch", "scope": engine.SCOPE,
                 "operationId": operation, "targetKey": self.accepted["targetKey"], "acceptedSha256": engine.content_hash(self.accepted),
                 "candidateName": name, "desiredGeneration": operation, "desiredRouteFingerprint": engine.content_hash(desired),
                 "unrelatedFingerprint": self.accepted["unrelatedFingerprint"],
                 **{key: self.accepted["runtime"][key] for key in ("imageId", "sourceRevision", "configSha256", "schemaSha256")}}
        return value, CaddySwitchAdapter(self, value, desired, **adapter_options)

    def reject(self):
        value, adapter = self.prepare("rejected-readiness", "web-rejected", reject_readiness=True)
        engine.initialize_rehearsal(self.state_dir, self.accepted, adapter)
        before = (self.state_dir / "accepted.json").read_bytes()
        start = len(self.watch.samples)
        try:
            engine.rehearse_web_switch(value, state_dir=self.state_dir, adapter=adapter)
        except engine.DefiniteRejected:
            pass
        else:
            raise WebSwitchSmokeError("paused candidate was incorrectly switched")
        time.sleep(2.1)
        samples = self.watch.samples[start:]
        require(adapter.patch_attempts == 0 and (self.state_dir / "accepted.json").read_bytes() == before
                and self.traffic.health() == (True, "generation-a") and samples
                and all(item == {"healthy": True, "generation": "generation-a"} for item in samples),
                "readiness rejection did not preserve actual accepted traffic")
        return {"actualPausedCandidateRejected": True, "routePatches": 0, "acceptedRecordUnchanged": True,
                "backgroundAcceptedHealthSamples": len(samples)}

    def successful(self):
        value, adapter = self.prepare("generation-b", "web-b")
        result = engine.rehearse_web_switch(value, state_dir=self.state_dir, adapter=adapter)
        repeated = engine.rehearse_web_switch(value, state_dir=self.state_dir, adapter=adapter)
        require(result["acceptedSha256"] == repeated["acceptedSha256"] and adapter.patch_attempts == 1
                and adapter.created == 1 and self.unrelated() == self.protected, "completed switch was replayed or changed protected services")
        self.accepted = engine._read(self.state_dir / "accepted.json")
        return {"receipt": result, "idempotentReceipt": repeated, "actualRoutePatches": adapter.patch_attempts,
                "activeConfig": self.admin.config()[0]}

    def acknowledgement_loss(self):
        value, adapter = self.prepare("generation-c", "web-c", lose_ack=True)
        before = (self.state_dir / "accepted.json").read_bytes()
        try:
            engine.rehearse_web_switch(value, state_dir=self.state_dir, adapter=adapter)
        except engine.SwitchUnknown:
            pass
        else:
            raise WebSwitchSmokeError("injected lost acknowledgement did not retain unknown state")
        require((self.state_dir / "accepted.json").read_bytes() == before
                and self.actual_route()["generation"] == "generation-c", "unknown result lost prior acceptance or did not actually apply")
        result = engine.rehearse_web_switch(value, state_dir=self.state_dir, adapter=adapter)
        require(adapter.patch_attempts == 1 and adapter.created == 1 and self.unrelated() == self.protected,
                "unknown switch recovery replayed a mutation or changed protected services")
        return {"receipt": result, "actualRoutePatches": 1, "unknownReconciledByIndependentReadback": True,
                "acknowledgementLossInjectedAfterActualApply": True, "activeConfig": self.admin.config()[0]}

    def memory_peaks(self):
        measured = {}
        for component, admitted_mib in MEMORY_LIMITS_MIB.items():
            name = self.fixture.prefix + "-" + component
            row = self.owned(name)
            limit = row.get("HostConfig", {}).get("Memory")
            require(limit == admitted_mib * MIB, "actual fixture memory limit differs from the admitted budget")
            if row.get("State", {}).get("Running") is True and not row["State"].get("Paused"):
                try:
                    result = self.docker.run(["exec", name, "cat", "/sys/fs/cgroup/memory.peak"], timeout=5, check=False)
                    observation = memory_peak(result)
                except SmokeError:
                    observation = {"status": "unavailable", "bytes": None}
            else:
                observation = {"status": "not-running-or-paused", "bytes": None}
            measured[component] = {"containerId": row["Id"], "configuredLimitBytes": limit,
                                   "source": "container cgroup v2 memory.peak", **observation}
        return {"containers": measured, "limitation": "Unavailable or paused-container peaks remain unknown, not zero; no production capacity claim."}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("verified-native-tested-bundle", self.load)
            self.check("isolated-services-and-generated-caddy", self.setup)
            self.check("actual-caddy-cas-rejection-preserves-traffic", self.cas)
            self.check("real-candidate-readiness-rejection", self.reject)
            self.check("actual-web-switch-and-idempotent-readback", self.successful)
            self.check("actual-apply-lost-ack-readback-without-replay", self.acknowledgement_loss)
            self.check("bounded-native-container-memory-observations", self.memory_peaks)
            require(self.unrelated() == self.protected, "protected runtime identities or restarts changed")
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, (SmokeError, engine.SwitchError)) else type(error).__name__
            if self.fixture:
                self.report["diagnostics"] = self.fixture.failure_diagnostics()
        finally:
            errors = []
            if self.watch:
                try:
                    self.watch.close()
                    self.report["backgroundTraffic"] = {"samples": len(self.watch.samples),
                                                        "sampleLimitReached": self.watch.exhausted,
                                                        "allHealthy": bool(self.watch.samples) and all(item["healthy"] for item in self.watch.samples)}
                    if not self.report["backgroundTraffic"]["allHealthy"]:
                        errors.append("background proxied health failed")
                    if self.watch.exhausted:
                        errors.append("background health sample budget exhausted")
                except Exception:
                    errors.append("owned background health cleanup failed")
            for forwarding in reversed(self.relays):
                try:
                    forwarding.close()
                except Exception:
                    errors.append("owned loopback relay cleanup failed")
            if self.fixture:
                errors.extend(self.fixture.cleanup())
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
        with tempfile.TemporaryDirectory(prefix="wd-web-switch-auth-") as directory:
            passed = WebSwitchSmoke(IsolatedDocker(Path(directory) / "docker"), args.bundle_dir,
                                    args.expected_revision, args.output_dir).run()
    except (SmokeError, engine.SwitchError, OSError, ValueError) as error:
        print(f"Native isolated Web switch rehearsal rejected: {error}", file=sys.stderr)
        return 1
    print(f"Native isolated Web switch rehearsal {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
