"""Run a separately admitted, synthetic native fixture from an operator API handoff.

This path does not impersonate Actions or invoke/relax hosted release admission.
API authentication and downloads happen off-host. Every handoff byte is pinned;
root orchestration owns the pre-existing cgroup and all production resources.
"""

import argparse
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import threading

from bundle import load_bundle
from component_inputs import decode
from engine_image_smoke import context_record, required_checks_passed
from fresh_compose_admission import IMAGE, validate_cgroup_parent, validate_storage_client_bin
from fresh_compose_smoke import ROOT, FreshCommandUnknown, FreshMutationUnknown, run as run_fresh, run_owned_fixture_command
from image_smoke import SmokeError
from native_image_identity import _canonical, _runtime, verify_archive, verify_native_inspection
from publication_gate import REPO, admitted_artifact
from registry_smoke import IsolatedDocker, RegistrySmoke
from web_candidate import _directory, _opened, _stream_digest
from web_sdk_full_receipt import candidate_input_facts, validate_web_sdk_full_receipt


HASH = re.compile(r"[a-f0-9]{64}\Z")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
FIXTURE_REF = re.compile(r"refs/heads/[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:/[A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,3}\Z")
SUPPORT = {"caddy": "caddy", "postgres": "postgres", "storage": "minio", "storage_init": "createbuckets", "registry": None}
CGROUP_ROOT = Path("/sys/fs/cgroup")
GIB = 1024**3
MAX_METADATA = 2 * 1024**2
TOP = {"schemaVersion", "kind", "baseline", "web", "engine", "supports", "source", "cgroup", "recovery", "dockerEndpoint", "storageClientBin"}


class LocalFixtureError(ValueError):
    pass


def _docker_opcode(arguments):
    """Classify fixed command shapes; no caller-derived text enters the journal."""
    pair = tuple(arguments[:2])
    if pair == ("container", "inspect"):
        formats = {"{{json .Config.Labels}}": "labels", "{{json .HostConfig.CgroupParent}}": "cgroup",
                   "{{json .Image}}": "image", "{{json .State}}": "state"}
        return "container.inspect." + (formats.get(arguments[-1], "other-format") if "--format" in arguments else "full")
    if arguments[:1] == ["exec"] and len(arguments) == 5 and arguments[2:] == ["du", "-sk", "/var/lib/registry"]:
        return "registry.capacity.du"
    if pair in {("image", "inspect"), ("image", "load"), ("image", "tag"), ("image", "rm"),
                ("volume", "create"), ("volume", "inspect"), ("volume", "rm"),
                ("network", "create"), ("network", "inspect"), ("network", "rm"),
                ("container", "stop"), ("container", "rm")}:
        return ".".join(pair)
    if arguments[:1] == ["info"]:
        return {"{{.CgroupDriver}}": "info.cgroup-driver", "{{.DockerRootDir}}": "info.storage-root"}.get(arguments[-1], "info.other")
    if arguments[:1] == ["run"]:
        return "registry.run"
    if arguments[:1] == ["push"]:
        return "image.push"
    return "docker.other"


class JournalDocker:
    """Preserve Docker run/json behavior with sixteen nonsecret operation facts."""

    def __init__(self, docker, receipt, persist):
        self._docker, self._receipt, self._persist = docker, receipt, persist
        self._lock, self._sequence = threading.RLock(), 0
        self._receipt["dockerOperations"] = []

    def __getattr__(self, name):
        return getattr(self._docker, name)

    def _begin(self, arguments):
        with self._lock:
            self._sequence += 1
            entry = {"sequence": self._sequence, "opcode": _docker_opcode(arguments), "state": "intent"}
            operations = self._receipt["dockerOperations"]
            operations.append(entry)
            del operations[:-16]
            self._receipt["currentDockerOpcode"] = entry["opcode"]
            self._persist()
            return entry

    def _finish(self, entry, state, exit_code=None):
        with self._lock:
            entry["state"] = state
            if type(exit_code) is int:
                entry["exitCode"] = exit_code
            self._persist()

    def _invoke(self, arguments, *, timeout, check, input_bytes):
        entry = self._begin(arguments)
        try:
            result = self._docker.run(arguments, timeout=timeout, check=False, input_bytes=input_bytes)
        except (Exception, KeyboardInterrupt):
            self._finish(entry, "raised")
            raise
        self._finish(entry, "completed" if result.returncode == 0 else "nonzero", result.returncode)
        if check and result.returncode != 0:
            code = str(result.returncode) if type(result.returncode) is int else "unavailable"
            raise SmokeError(entry["opcode"] + " failed (exit " + code + ")")
        return result, entry

    def run(self, arguments, *, timeout=30, check=True, input_bytes=None):
        return self._invoke(arguments, timeout=timeout, check=check, input_bytes=input_bytes)[0]

    def json(self, arguments, *, timeout=30):
        result, entry = self._invoke(arguments, timeout=timeout, check=True, input_bytes=None)
        try:
            return json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError) as error:
            self._finish(entry, "invalid-json", result.returncode)
            raise SmokeError(entry["opcode"] + " returned invalid JSON") from error


def require(value, fact):
    if not value:
        raise LocalFixtureError(fact)


def _match(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def _record(record, *, maximum=MAX_METADATA, contents=False):
    require(type(record) is dict and set(record) == {"path", "sha256", "bytes"} and _match(HASH, record["sha256"])
            and type(record["bytes"]) is int and 0 < record["bytes"] <= maximum, "Exact bounded independent file pin required")
    path = Path(record["path"])
    with _directory(path.parent) as parent, _opened(parent, path.name, maximum) as (source, size):
        require(size == record["bytes"] and _stream_digest(source, size) == record["sha256"], "Handoff file differs from independent pin")
        if contents:
            source.seek(0)
            return decode(source.read(maximum + 1))
    return path


def _keys(value, keys, fact):
    require(type(value) is dict and set(value) == set(keys), fact)


def _git(*arguments):
    result = subprocess.run(["git", "--no-optional-locks", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", *arguments], cwd=ROOT, stdin=subprocess.DEVNULL,
                            capture_output=True, timeout=15, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 64 * 1024, "Source ownership observation failed")
    return result.stdout.decode("utf-8", "strict").strip()


def verify_source(source):
    _keys(source, ("root", "baseRevision", "capsule", "files"), "Exact source capsule and overlay pins required")
    require(Path(source["root"]) == ROOT and _match(REVISION, source["baseRevision"]), "Driver must run from the selected source root")
    _record(source["capsule"], maximum=256 * 1024**2)
    files = source["files"]
    require(type(files) is dict and 1 <= len(files) <= 64 and "scripts/deployment/local_native_fixture.py" in files
            and "scripts/deployment/native_image_identity.py" in files, "Pinned driver and complete overlay inventory required")
    for name, pin in files.items():
        require(type(name) is str and re.fullmatch(r"[A-Za-z0-9_./-]{1,240}", name) and not name.startswith("/")
                and ".." not in Path(name).parts and str(Path(name)) == name, "Unsafe source overlay path")
        _keys(pin, ("sha256", "bytes"), "Exact overlay file pin required")
        _record({"path": str(ROOT / name), **pin}, maximum=4 * 1024**2)
    require(_git("rev-parse", "HEAD") == source["baseRevision"], "Source baseline revision differs")
    changed = set(_git("diff", "--no-ext-diff", "--no-textconv", "--name-only", "--no-renames", "HEAD").splitlines())
    added = set(_git("ls-files", "--others", "--exclude-standard").splitlines())
    require(changed | added <= set(files), "Unpinned source changes or untracked inputs are present")
    return sha256(_canonical(files)).hexdigest()


def _host_memory():
    with Path("/proc/meminfo").open(encoding="ascii") as source:
        raw = source.read(65537)
    matches = re.findall(r"^MemAvailable:\s+([0-9]{1,16}) kB$", raw, re.MULTILINE)
    require(len(raw) <= 65536 and len(matches) == 1, "Host memory reserve observation is unavailable")
    return int(matches[0]) * 1024


def verify_budget(budget, docker, *, initial=False):
    _keys(budget, ("parent", "cpuQuota", "cpuPeriod", "memoryMaxBytes", "hostReserveBytes"), "Exact owned aggregate budget required")
    parent = validate_cgroup_parent(budget["parent"])
    require(parent is not None and type(budget["cpuQuota"]) is int and type(budget["cpuPeriod"]) is int
            and budget["cpuPeriod"] > 0 and budget["cpuQuota"] == 2 * budget["cpuPeriod"]
            and type(budget["memoryMaxBytes"]) is int and 6 * GIB <= budget["memoryMaxBytes"] <= 7 * GIB
            and type(budget["hostReserveBytes"]) is int and budget["hostReserveBytes"] >= GIB,
            "Only an explicit two-CPU six-to-seven-GiB fixture budget is supported")
    require(docker.run(["info", "--format", "{{.CgroupDriver}}"], timeout=10).stdout.strip() == "systemd", "Systemd Docker cgroup driver required")
    directory = CGROUP_ROOT / parent
    require(directory.is_dir() and directory.resolve(strict=True) == directory and directory.stat().st_uid == os.geteuid(),
            "Pre-existing owned flat cgroup required; driver never creates units")

    def read(name):
        with (directory / name).open(encoding="ascii") as source:
            raw = source.read(257)
        require(len(raw) <= 256, "Cgroup control observation exceeded its bound")
        return raw.strip()

    require(read("cpu.max") == f"{budget['cpuQuota']} {budget['cpuPeriod']}"
            and read("memory.max") == str(budget["memoryMaxBytes"]), "Aggregate cgroup budget differs from independent selection")
    current = read("memory.current")
    require(re.fullmatch(r"[0-9]{1,20}", current) and int(current) <= budget["memoryMaxBytes"], "Cgroup memory state is unavailable")
    if initial:
        require(not any(path.is_dir() for path in directory.iterdir()), "Selected cgroup already has child workloads")
        pids = read("cgroup.procs").splitlines()
        require(set(pids) <= {str(os.getpid())}, "Selected cgroup contains a foreign process")
        require(_host_memory() >= budget["memoryMaxBytes"] + budget["hostReserveBytes"], "Host operating reserve cannot support selected fixture cap")
    return {"parent": parent, "cpuMax": read("cpu.max"), "memoryMaxBytes": budget["memoryMaxBytes"], "memoryCurrentBytes": int(current)}


def _birth():
    raw = Path("/proc/self/stat").read_text(encoding="ascii")
    return raw.rsplit(")", 1)[1].split()[19]


def _self_cgroup():
    return Path("/proc/self/cgroup").read_text(encoding="ascii").splitlines()


def move_self(budget):
    parent = CGROUP_ROOT / budget["parent"]
    child = parent / "coordinator"
    require(not os.path.lexists(child), "Coordinator cgroup already exists")
    birth = _birth()
    child.mkdir(mode=0o755)
    require(child.resolve(strict=True) == child and child.stat().st_uid == os.geteuid(), "Own coordinator cgroup identity differs")
    path = child / "cgroup.procs"
    with path.open("w", encoding="ascii") as target:
        target.write(str(os.getpid()) + "\n")
    require(f"0::/{budget['parent']}/coordinator" in _self_cgroup() and _birth() == birth
            and set(path.read_text(encoding="ascii").splitlines()) == {str(os.getpid())}, "Own process cgroup move did not verify")
    return {"cgroup": f"/{budget['parent']}/coordinator", "pid": os.getpid(), "startTicks": birth}


def _graph(record, expected, *, archive_mode="strict-oci"):
    path = _record(record, maximum=8 * GIB)
    return verify_archive(path, expected_sha256=record["sha256"], expected_bytes=record["bytes"], expected_images=expected, archive_mode=archive_mode)


def verify_load_archive(original, transport, expected):
    """Admit an explicit complete-index transport; never generate or retry one."""
    graph = _graph(transport, expected, archive_mode="docker-save-compatibility")
    require(graph["payloadBlobs"] == original["payloadBlobs"]
            and graph["dockerManifestSha256"] == original["dockerManifestSha256"]
            and graph["ociLayoutSha256"] == original["ociLayoutSha256"],
            "Explicit load archive changes original payload, Docker inventory or layout bytes")
    require(graph["ociRootConfigDigests"] == sorted(value["configDigest"] for value in expected.values()),
            "Explicit load archive index does not reach all selected configs")
    for role, identity in original["images"].items():
        changed = graph["images"][role]
        require(all(changed[key] == identity[key] for key in ("configDigest", "manifestDigest", "sourceRevision", "platform",
                    "runtimeUser", "rootfsDiffIds", "configMetadataSha256", "roleMetadataSha256")),
                "Explicit load archive changes selected image identity")
    return graph


def _engine_producer(engine, producer, artifact, source):
    """Keep main custody by default; explicitly bind branch tests to this capsule."""
    _keys(producer, ("runId", "runAttempt", "event", "ref"), "Exact engine producer required")
    _keys(artifact, ("id", "name", "digest", "sizeBytes"), "Exact engine API artifact required")
    require(type(producer["runId"]) is int and producer["runId"] > 0
            and type(producer["runAttempt"]) is int and producer["runAttempt"] > 0
            and type(artifact["id"]) is int and artifact["id"] > 0 and _match(IMAGE_ID, artifact["digest"])
            and type(artifact["sizeBytes"]) is int and 0 < artifact["sizeBytes"] <= 512 * 1024**2
            and artifact["name"] == f"production-engine-{engine['revision']}-{producer['runId']}-{producer['runAttempt']}",
            "Engine snapshot has no exact artifact provenance")
    selected = engine.get("fixtureProducer")
    if selected is None:
        require("fixtureProducer" not in engine and producer["event"] in {"push", "workflow_dispatch"}
                and producer["ref"] == "refs/heads/main", "Engine snapshot requires original main provenance")
        return "main-artifact"
    _keys(selected, ("qualificationOnly", "ref", "revision", "sourceCapsuleSha256"), "Closed fixture-only producer selection required")
    require(selected["qualificationOnly"] is True and _match(FIXTURE_REF, selected["ref"])
            and selected["ref"] != "refs/heads/main" and producer["event"] == "workflow_dispatch"
            and producer["ref"] == selected["ref"] and selected["revision"] == engine["revision"]
            and _match(REVISION, selected["revision"]) and _match(HASH, selected["sourceCapsuleSha256"])
            and selected["sourceCapsuleSha256"] == source["capsule"]["sha256"],
            "Fixture-only engine producer differs from the explicit source capsule")
    return "explicit-fixture-only-branch-artifact"


def admit(handoff):
    _keys(handoff, TOP, "Exact closed local fixture admission required")
    require(type(handoff["schemaVersion"]) is int and handoff["schemaVersion"] == 1
            and handoff["kind"] == "warpdrive-local-native-fixture-admission", "Unsupported local fixture admission")
    validate_storage_client_bin(handoff["storageClientBin"])
    require(handoff["dockerEndpoint"] == "unix:///var/run/docker.sock", "Explicit local native Docker endpoint required")
    source_pin = verify_source(handoff["source"])
    baseline = handoff["baseline"]
    _keys(baseline, ("revision", "bundleDir", "bundleManifestSha256", "apiAdmission", "configDigests", "loadAllowed", "loadArchive"), "Exact authenticated baseline handoff required")
    require(_match(REVISION, baseline["revision"]) and baseline["revision"] == handoff["source"]["baseRevision"]
            and _match(HASH, baseline["bundleManifestSha256"]) and type(baseline["loadAllowed"]) is bool, "Baseline source pins differ")
    api = _record(baseline["apiAdmission"], contents=True)
    admitted_artifact(api, baseline["revision"])
    require(api.get("deploymentAuthorized") is False and type(api.get("ci")) is list and api["ci"]
            and type(api.get("security")) is dict, "Operator API handoff lacks successful source-policy evidence")
    directory = Path(baseline["bundleDir"])
    with _directory(directory) as parent, _opened(parent, "bundle.json", MAX_METADATA) as (stream, size):
        require(_stream_digest(stream, size) == baseline["bundleManifestSha256"], "Baseline manifest pin differs")
    loaded = load_bundle(directory, expected_revision=baseline["revision"])
    require(loaded["origin"] == {"kind": "github-actions", "repository": REPO, **api["producer"]}, "Baseline producer differs from pinned operator API handoff")
    components = loaded["candidate"]["components"]
    require(type(baseline["configDigests"]) is dict and set(baseline["configDigests"]) == set(components), "Exact independent four-config pins required")
    expected = {}
    for role, value in components.items():
        with _directory(directory / "inspections") as parent:
            rows = decode(_read_metadata(parent, role + ".json"))
        config = rows[0]["Config"]
        expected[role] = {"configDigest": baseline["configDigests"][role], "sourceRevision": value.get("sourceRevision", baseline["revision"]),
                          "metadata": {key: config.get(key) for key in ("User", "Cmd", "Entrypoint", "WorkingDir")}}
    archive = loaded["archivePath"]
    graph = verify_archive(archive, expected_sha256=loaded["provenance"]["archiveSha256"], expected_bytes=archive.stat().st_size,
                           expected_images=expected, archive_mode="docker-save-compatibility")
    for role, value in components.items():
        require(value["imageId"] in graph["images"][role]["nativeIdentityCandidates"], "Canonical baseline image ID is detached from archived config")
    original_graph = graph
    load_archive = archive
    if baseline["loadArchive"] is not None:
        graph = verify_load_archive(original_graph, baseline["loadArchive"], expected)
        load_archive = Path(baseline["loadArchive"]["path"])
    else:
        require(graph["ociRootConfigDigests"] == sorted(value["configDigest"] for value in expected.values()),
                "Incomplete OCI index requires an explicit independently pinned load archive")
    graphs = {"baseline": graph}
    web = handoff["web"]
    _keys(web, ("revision", "tree", "archive", "configDigest", "nativeImageId", "metadata", "inputReceipt", "sourceReceipt", "sdkReceipt", "custodyReceipt", "loadAllowed"), "Exact peer Web custody handoff required")
    require(_match(REVISION, web["revision"]) and web["revision"] != baseline["revision"] and _match(REVISION, web["tree"])
            and _match(IMAGE_ID, web["nativeImageId"]) and type(web["loadAllowed"]) is bool, "Distinct exact peer Web source required")
    inputs = _record(web["inputReceipt"], contents=True)
    validate_web_sdk_full_receipt(inputs, expected_revision=web["revision"])
    facts = candidate_input_facts(inputs, expected_revision=web["revision"])
    require(all(facts["components"][role]["inputSha256"] == components[role]["inputSha256"] for role in ("worker", "realtime", "migrator")),
            "Peer Web source changes the admitted backend inputs")
    source = _record(web["sourceReceipt"], contents=True)
    sdk = _record(web["sdkReceipt"], contents=True)
    custody = _record(web["custodyReceipt"], contents=True)
    sdk, custody = sdk.get("finalImageQualification", sdk), custody.get("testedImageCustody", custody)
    require(source.get("revision") == web["revision"] and source.get("tree") == web["tree"] and source.get("result") == "PreparedAndSeparatelyVerified"
            and sdk.get("revision") == web["revision"] and sdk.get("sourceAndBuildUnchanged") is True and sdk.get("sdkPackagingPassed") is True
            and type(sdk.get("fullBuildTypecheckExit")) is int and sdk["fullBuildTypecheckExit"] == 0
            and sdk.get("hostedProvenance") is False and sdk.get("deploymentAuthorized") is False
            and (sdk.get("image") or {}).get("id") == web["nativeImageId"], "Peer source or exact SDK packaging receipt differs")
    require(custody.get("status") == "saved-and-content-graph-verified" and custody.get("imageId") == web["nativeImageId"]
            and custody.get("configDigest") == web["configDigest"] and custody.get("sourceRevision") == web["revision"]
            and custody.get("bytes") == web["archive"]["bytes"] and custody.get("sha256") == web["archive"]["sha256"]
            and custody.get("allReachableBlobBytesMatchDigests") is True and custody.get("offServerCopySha256Verified") is True
            and custody.get("hostedOrReleaseAcceptance") is False,
            "Peer Web byte custody differs from independently selected archive")
    graphs["web"] = _graph(web["archive"], {"candidate_web": {"configDigest": web["configDigest"], "sourceRevision": web["revision"], "metadata": web["metadata"]}})
    engine = handoff["engine"]
    engine_keys = {"revision", "archive", "configDigest", "metadata", "apiAdmission", "report", "contextSha256", "loadAllowed"}
    _keys(engine, engine_keys | ({"fixtureProducer"} if "fixtureProducer" in engine else set()), "Exact original engine custody handoff required")
    engine_api, report = _record(engine["apiAdmission"], contents=True), _record(engine["report"], contents=True)
    _keys(engine_api, ("kind", "repository", "workflow", "revision", "contextSha256", "archiveSha256", "reportSha256", "producer", "artifact"),
          "Exact pinned engine operator API snapshot required")
    producer, artifact = engine_api["producer"], engine_api["artifact"]
    producer_scope = _engine_producer(engine, producer, artifact, handoff["source"])
    require(engine_api.get("kind") == "warpdrive-engine-api-handoff" and engine_api.get("repository") == REPO
            and engine_api.get("workflow") == "production-engine.yml" and engine_api.get("revision") == engine["revision"]
            and engine_api.get("contextSha256") == engine["contextSha256"] and engine_api.get("archiveSha256") == engine["archive"]["sha256"]
            and engine_api.get("reportSha256") == engine["report"]["sha256"], "Engine operator API handoff differs")
    require(report.get("success") is True and report.get("failure") is None and (report.get("cleanup") or {}).get("success") is True
            and not report["cleanup"].get("errors") and report.get("expectedRevision") == engine["revision"]
            and required_checks_passed(report.get("checks")) and report.get("context") == context_record()
            and report["context"]["sha256"] == engine["contextSha256"] and type(engine["loadAllowed"]) is bool, "Engine qualification or unchanged source context differs")
    graphs["engine"] = _graph(engine["archive"], {"engine": {"configDigest": engine["configDigest"], "sourceRevision": engine["revision"], "metadata": engine["metadata"]}},
                               archive_mode="docker-save-compatibility")
    require(report["image"]["id"] in graphs["engine"]["images"]["engine"]["nativeIdentityCandidates"], "Original engine report identity is detached from archive")
    require(type(handoff["supports"]) is dict and set(handoff["supports"]) == set(SUPPORT), "Five exact support role pins required")
    for support in handoff["supports"].values():
        _keys(support, ("reference", "configDigest", "configBlob", "snapshot"), "Exact support digest, config bytes and independent native snapshot required")
        require(_match(IMAGE, support["reference"]) and len(support["reference"]) <= 255 and _match(IMAGE_ID, support["configDigest"]), "Immutable support config/reference required")
        require(support["configBlob"]["sha256"] == support["configDigest"][7:], "Support config byte pin differs from OCI digest")
        _record(support["configBlob"], contents=True)
        _record(support["snapshot"], contents=True)
    recovery = handoff["recovery"]
    if recovery is not None:
        _keys(recovery, ("restic", "pgControl"), "Explicit recovery tool pins required")
        for record in recovery.values():
            _record(record, maximum=128 * 1024**2)
    return {"sourcePin": source_pin, "baseline": loaded, "graphs": graphs, "baselineLoadArchive": load_archive,
            "engineProducerScope": producer_scope,
            "baselineTransport": {"originalArchiveSha256": original_graph["archiveSha256"], "loadArchiveSha256": graph["archiveSha256"],
                "payloadBytesUnchanged": True, "originalIndexDigest": original_graph["archiveIndexDigest"],
                "loadIndexDigest": graph["archiveIndexDigest"], "allSelectedConfigsIndexed": True}}


def _read_metadata(parent, name):
    with _opened(parent, name, MAX_METADATA) as (source, size):
        raw = source.read(MAX_METADATA + 1)
        require(len(raw) == size, "Pinned metadata changed during readback")
        return raw


def _find(docker, identity, expected_id=None):
    found = {}
    for candidate in identity["nativeIdentityCandidates"]:
        result = docker.run(["image", "inspect", candidate], timeout=10, check=False)
        if result.returncode == 0:
            rows = decode(result.stdout.encode())
            proof = verify_native_inspection(identity, rows, expected_native_id=expected_id)
            found[proof["nativeImageId"]] = proof
    require(len(found) <= 1, "Ambiguous native identity aliases for admitted config")
    return next(iter(found.values())) if found else None


def preload(docker, record, graph, *, load_allowed, expected_ids=None, before_load=None):
    expected_ids = expected_ids or {}
    found = {role: _find(docker, identity, expected_ids.get(role)) for role, identity in graph["images"].items()}
    if all(found.values()):
        return found, 0
    require(load_allowed and not any(found.values()), "Missing or partially preloaded image set requires explicit reconciliation")
    if before_load is not None:
        before_load()
    try:
        docker.run(["image", "load", "--input", str(record)], timeout=300)
        found = {role: _find(docker, identity, expected_ids.get(role)) for role, identity in graph["images"].items()}
        require(all(found.values()), "One exact archive load did not establish admitted native images")
    except FreshCommandUnknown:
        raise
    except (Exception, KeyboardInterrupt) as error:
        raise FreshMutationUnknown("Archive load finished without all independently verified native identities") from error
    return found, 1


def support_images(docker, handoff):
    result = {}
    for role, support in handoff["supports"].items():
        snapshot = _record(support["snapshot"], contents=True)
        config = _record(support["configBlob"], contents=True)
        rows = docker.json(["image", "inspect", support["reference"]], timeout=10)
        require(type(snapshot) is list and len(snapshot) == 1 and type(rows) is list and len(rows) == 1, "One native support image snapshot required")
        actual, expected = rows[0], snapshot[0]
        require(actual.get("Os") == "linux" and actual.get("Architecture") == "amd64" and _match(IMAGE_ID, actual.get("Id"))
                and actual.get("Id") == expected.get("Id") and support["reference"] in (actual.get("RepoDigests") or [])
                and support["reference"] in (expected.get("RepoDigests") or []) and actual.get("Descriptor") == expected.get("Descriptor")
                and actual.get("RootFS") == expected.get("RootFS") and _runtime(actual.get("Config")) == _runtime(expected.get("Config")),
                "Preloaded support image differs from pinned operator snapshot or literal digest")
        require(type(config) is dict and config.get("os") == "linux" and config.get("architecture") == "amd64"
                and _runtime(config.get("config")) == _runtime(actual.get("Config"))
                and type(config.get("rootfs")) is dict and config["rootfs"].get("type") == "layers"
                and actual.get("RootFS") == {"Type": "layers", "Layers": config["rootfs"].get("diff_ids")},
                "Support config blob or RootFS differs from native image")
        result[role] = {"reference": support["reference"], "configDigest": support["configDigest"], "nativeImageId": actual["Id"]}
    alias = handoff["storageClientBin"] == "mcli" and result["storage"]["nativeImageId"] == result["storage_init"]["nativeImageId"]
    unique = [value["nativeImageId"] for role, value in result.items() if not (role == "storage_init" and alias)]
    require(len(set(unique)) == len(unique), "Only explicit bundled mcli storage/client alias is supported")
    return result


def publish(registry, docker, identities, proofs):
    registry.image_ids = {role: proof["nativeImageId"] for role, proof in proofs.items()}
    sizes = [docker.json(["image", "inspect", proof["nativeImageId"]], timeout=10)[0]["Size"] for proof in proofs.values()]
    require(all(type(size) is int and size > 0 for size in sizes), "Actual publication storage sizes required")
    registry.disk_limit = sum(sizes) + 256 * 1024**2
    registry.setup_registry()
    references, published = {}, {}
    for role, identity in identities.items():
        tag = registry.repository_prefix + "/" + role + ":fixture"
        registry.adapter.push(proofs[role]["nativeImageId"], tag)
        manifest_digest, manifest = registry.client.manifest(tag)
        reference = tag.rsplit(":", 1)[0] + "@" + manifest_digest
        config = registry.client.verify_config(reference, identity["configDigest"], identity["sourceRevision"])
        require(config["imageId"] == identity["configDigest"], "Published config differs from archived source identity")
        rows = docker.json(["image", "inspect", reference], timeout=10)
        require(reference in (rows[0].get("RepoDigests") or []), "Literal local published RepoDigest missing")
        adapted = deepcopy(identity)
        # A transport representation can change while the source config stays fixed.
        repository, _ = registry.client.split_reference(reference, immutable=True)
        raw, _, status = registry.client.get("/v2/" + repository + "/manifests/" + manifest_digest, manifest=True)
        require(status == 200 and "sha256:" + sha256(raw).hexdigest() == manifest_digest and decode(raw) == manifest,
                "Immutable published manifest bytes changed during native readback")
        adapted["nativeIdentityCandidates"][manifest_digest] = {"kind": "platform-manifest-digest", "mediaType": manifest["mediaType"],
                                                               "size": len(raw)}
        proof = verify_native_inspection(adapted, rows)
        references[role] = reference
        published[role] = {**proof, "reference": reference, "archiveNativeImageId": proofs[role]["nativeImageId"]}
    return references, published


def _save(output, receipt):
    raw = _canonical(receipt) + b"\n"
    require(len(raw) <= MAX_METADATA, "Finite fixture receipt exceeded its bound")
    temporary = output / (".report-" + os.urandom(6).hex())
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, output / "report.json")


def execute(handoff, output, *, move=False, docker_factory=IsolatedDocker, registry_factory=RegistrySmoke, fresh=run_fresh, cold=None):
    require(output.is_absolute() and output.resolve(strict=True) == output and output.stat().st_uid == os.geteuid()
            and stat.S_IMODE(output.stat().st_mode) == 0o700 and not os.path.lexists(output / "report.json"),
            "Fresh private owned fixture output required")
    receipt = {"schemaVersion": 1, "kind": "warpdrive-local-native-fixture-result", "success": False,
               "origin": "operator-api-handoff", "hostedProducer": False, "releaseProfileAdmitted": False,
               "installedBackendCompatibilityQualified": False, "deploymentAuthorized": False, "manualReconciliationRequired": False}
    receipt["handoffDocumentSha256"] = sha256(_canonical(handoff)).hexdigest()
    registry, fixtures_clean, unknown, mutation_pending = None, True, False, False
    try:
        admitted = admit(handoff)
        receipt["engineProducerScope"] = admitted.get("engineProducerScope", "main-artifact")
        docker = JournalDocker(docker_factory(output / "docker", runner=run_owned_fixture_command), receipt,
                               lambda: _save(output, receipt))
        require(docker.endpoint == handoff["dockerEndpoint"], "Native Docker endpoint differs from selection")
        receipt["budget"] = verify_budget(handoff["cgroup"], docker, initial=True)
        if move:
            receipt["coordinator"] = move_self(handoff["cgroup"])
        supports = support_images(docker, handoff)
        receipt["supports"] = supports
        receipt["sourceOverlaySha256"] = admitted["sourcePin"]
        proofs, loads = {}, {}
        graphs = admitted["graphs"]
        receipt["baselineTransport"] = admitted["baselineTransport"]
        for name, archive in (("baseline", admitted["baselineLoadArchive"]), ("web", Path(handoff["web"]["archive"]["path"])),
                              ("engine", Path(handoff["engine"]["archive"]["path"]))):
            receipt.update(phase="preload-intent", preloadRole=name, archiveLoads=dict(loads))
            _save(output, receipt)

            def load_intent():
                nonlocal mutation_pending
                mutation_pending = True
                receipt.update(phase="archive-load-intent", archiveRole=name)
                _save(output, receipt)

            part, loads[name] = preload(docker, archive, graphs[name], load_allowed=handoff[name]["loadAllowed"],
                expected_ids={"candidate_web": handoff["web"]["nativeImageId"]} if name == "web" else None, before_load=load_intent)
            mutation_pending = False
            proofs.update(part)
        identities = {role: identity for graph in graphs.values() for role, identity in graph["images"].items()}
        require(len({proof["nativeImageId"] for proof in proofs.values()}) == 6
                and not {proof["nativeImageId"] for proof in proofs.values()} & {row["nativeImageId"] for row in supports.values()},
                "Application and support identities overlap")
        verify_source(handoff["source"])
        verify_budget(handoff["cgroup"], docker)
        registry = registry_factory(docker, Path(handoff["baseline"]["bundleDir"]), handoff["baseline"]["revision"], output / "registry",
            registry_image=supports["registry"]["reference"], registry_preloaded=True, cgroup_parent=handoff["cgroup"]["parent"])
        receipt.update(phase="registry-intent", registryOwner=registry.prefix, archiveLoads=loads)
        _save(output, receipt)
        mutation_pending = True
        references, receipt["images"] = publish(registry, docker, identities, proofs)
        mutation_pending = False
        baseline = {"app": references["web"], "worker": references["worker"], "ws": references["realtime"], "migrate": references["migrator"],
                    "newsletter-engine": references["engine"], "newsletter-engine-migrate": references["engine"]}
        baseline.update({service: supports[role]["reference"] for role, service in SUPPORT.items() if service})
        candidate = {**baseline, "app": references["candidate_web"]}
        for phase, operation in (("fresh", fresh), ("recovery", cold)):
            if phase == "recovery" and handoff["recovery"] is None:
                continue
            require(operation is not None, "Explicit recovery callback required")
            verify_source(handoff["source"])
            verify_budget(handoff["cgroup"], docker)
            receipt["phase"] = phase + "-intent"
            fixtures_clean = False
            _save(output, receipt)
            options = {"storage_client_bin": handoff["storageClientBin"], "cgroup_parent": handoff["cgroup"]["parent"]}
            if phase == "recovery":
                tools = handoff["recovery"]
                options.update(restic=Path(tools["restic"]["path"]), restic_pin=tools["restic"]["sha256"],
                    pg_control=Path(tools["pgControl"]["path"]), pg_control_pin=tools["pgControl"]["sha256"], output_parent=output)
            receipt[phase] = operation(baseline, candidate, **options)
            confirmed_cleanup = receipt[phase].get("cleanupSuccess") is True and receipt[phase].get("manualReconciliationRequired") is not True
            verify_source(handoff["source"])
            verify_budget(handoff["cgroup"], docker)
            fixtures_clean = confirmed_cleanup
            require(receipt[phase].get("success") is True and fixtures_clean, "Selected native fixture did not pass and clean up")
        receipt.update(success=True, phase="qualified")
    except (Exception, KeyboardInterrupt) as error:
        unknown = mutation_pending or isinstance(error, FreshCommandUnknown)
        receipt.update(success=False, phase="held", failureType=type(error).__name__)
        receipt["mutationOutcomeUnknown"] = unknown
        if type(error) is LocalFixtureError:
            receipt["failureFact"] = str(error)
    finally:
        if registry is not None and fixtures_clean and not unknown:
            try:
                errors = registry.cleanup()
                receipt["registryCleanupSuccess"] = not errors
            except Exception:
                receipt["registryCleanupSuccess"] = False
        elif registry is not None:
            receipt["registryCleanupSuccess"] = False
        receipt["manualReconciliationRequired"] = unknown or not fixtures_clean or (registry is not None and not receipt.get("registryCleanupSuccess", False))
        receipt["success"] = receipt["success"] and not receipt["manualReconciliationRequired"]
        _save(output, receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", required=True, action="store_true")
    parser.add_argument("--admission-file", required=True, type=Path)
    parser.add_argument("--admission-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--move-self-to-cgroup", action="store_true")
    args = parser.parse_args(argv)
    require(platform.system() == "Linux" and platform.machine() in {"x86_64", "amd64"} and os.geteuid() == 0, "Root native Linux AMD64 fixture host required")
    require(args.output_dir.is_absolute() and args.output_dir.parent == args.output_dir.parent.resolve(strict=True)
            and not os.path.lexists(args.output_dir), "Fresh canonical private output required")
    handoff = _record({"path": str(args.admission_file), "sha256": args.admission_sha256, "bytes": args.admission_file.lstat().st_size}, contents=True)
    args.output_dir.mkdir(mode=0o700)
    from fresh_compose_recovery_smoke import run as run_cold
    result = execute(handoff, args.output_dir, move=args.move_self_to_cgroup, cold=run_cold)
    result["independentHandoffSha256"] = args.admission_sha256
    _save(args.output_dir, result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
