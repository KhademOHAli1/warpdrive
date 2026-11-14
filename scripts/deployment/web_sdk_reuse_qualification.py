"""Qualify one explicitly selected SDK Web/retained-backend fixture assembly.

This is a new, qualification-only lane. It never calls local_native_fixture's
equality admit/execute wrappers, changes installed routes, accepts Core API, or
turns a source comparison into compatibility. Original publications and pending
gates remain untouched. Only execute_reuse runs the two genuine lower probes.
Their reports remain separate: Fresh includes Engine; Mixed does not.
"""

from copy import deepcopy
from contextlib import contextmanager
import argparse
from functools import partial
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import platform
import re
import selectors
import shutil
import stat
import subprocess
import time
from types import SimpleNamespace

from bundle import regular_file
import component_inputs as inputs
import fresh_compose_smoke as fresh
from fresh_compose_admission import IMAGE as REFERENCE, validate_cgroup_parent, validate_storage_client_bin
from image_smoke import COMPONENTS, ImageSmoke, image_metadata
from installed_web_backend import process_witness
from installed_web_sdk_admission import compare_backend_inputs, validate_newsletter_binding, verify_engine_unchanged
from installed_web_sdk_runtime import COMMAND as SDK_COMMAND, validate_runtime_binding
import local_native_fixture as local
from native_image_identity import verify_native_inspection
from publication_gate import REPO, verify_downloaded
from registry_smoke import IsolatedDocker, RegistrySmoke
import web_mixed_image_smoke as mixed
from web_sdk_full_receipt import validate_web_sdk_full_receipt


KIND = "warpdrive-sdk-native-reuse-subproofs"
ADMISSION_KIND = "warpdrive-sdk-native-reuse-admission"
LEGACY_COMMAND = ("bun", "node_modules/next/dist/bin/next", "start")
ROLES = ("old_web", "new_web", "worker", "realtime", "migrator", "engine")
HASH = re.compile(r"[a-f0-9]{64}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
NAMESPACE = re.compile(r"wd-sdk-reuse-[a-f0-9]{12}\Z")
OWNER = "io.warpdrive.sdk-reuse.owner"
MAX_SECONDS = 1800
ENGINE_DIRECTORY = "deploy/newsletters/engine"
ENGINE_MAX_FILES, ENGINE_MAX_FILE_BYTES, ENGINE_MAX_TOTAL_BYTES = 256, 2 * 1024**2, 8 * 1024**2
ENGINE_REQUIRED = {"Dockerfile", "build.sh", "nonroot-entrypoint.sh", "patches/090-explicit-migrations.patch",
                   "migration-tests/verify.py", "migration-tests/test_verify.py"}
DISABLED_NEWSLETTER_KIND = "warpdrive-disabled-newsletter-integration-witness"
RETAINED = ("worker", "realtime", "migrator")
TOP = {"schemaVersion", "kind", "source", "sdk", "backend", "incumbent", "engine", "selection",
       "supports", "comparison", "contractReview", "installedChain", "engineWitness", "protectedWitnesses",
       "cgroup", "daemon", "dockerEndpoint", "storageClientBin", "newWebImport",
       "allowPrivateFixturePublication", "namespace", "maximumSeconds"}


def require(value, message):
    if not value:
        raise ValueError(message)


def keys(value, names, message):
    require(type(value) is dict and set(value) == set(names), message)


def pin(value, pattern=HASH):
    return type(value) is str and pattern.fullmatch(value) is not None


def file_record(record, *, contents=True, maximum=local.MAX_METADATA):
    return local._record(record, maximum=maximum, contents=contents)


def _engine_git_bytes(arguments, maximum):
    """Read only locally present Git objects, with finite time/output and no code."""
    command = ["git", "--no-optional-locks", "--no-replace-objects", "-c", "core.hooksPath=/dev/null",
               "-c", "core.fsmonitor=false", "-C", str(local.ROOT), *arguments]
    environment = {"PATH": os.defpath, "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull, "GIT_NO_REPLACE_OBJECTS": "1", "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"}
    deadline, result = time.monotonic() + 15, bytearray()
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env=environment, start_new_session=True) as child:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), "Historical Engine Git read timed out")
                    chunk = os.read(child.stdout.fileno(), min(65536, maximum - len(result) + 1))
                    if not chunk:
                        break
                    result.extend(chunk)
                    require(len(result) <= maximum, "Historical Engine Git read exceeded its byte bound")
            require(child.wait(timeout=max(.1, deadline - time.monotonic())) == 0, "Historical Engine object is not locally available")
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=3)
    return bytes(result)


def historical_engine_context(revision):
    """Reconstruct context_record from fixed-root producer Git blobs, not HEAD.

    No checkout, materialization, import, build or historical executable occurs.
    Missing producer objects hold; lazy fetching and credential prompts are off.
    """
    require(pin(revision, REVISION), "Exact authenticated Engine producer revision required")
    started = time.monotonic()
    def read(arguments, maximum):
        require(time.monotonic() - started < 60, "Historical Engine context read exceeded its total deadline")
        return _engine_git_bytes(arguments, maximum)
    actual = read(["rev-parse", "--verify", revision + "^{commit}"], 64).decode("ascii", "strict").strip()
    require(actual == revision, "Engine producer commit differs from authenticated revision")
    tree = read(["rev-parse", "--verify", revision + ":" + ENGINE_DIRECTORY], 64).decode("ascii", "strict").strip()
    require(pin(tree, REVISION) and read(["cat-file", "-t", tree], 16) == b"tree\n", "Fixed historical Engine directory is not a Git tree")
    raw = read(["ls-tree", "-r", "-z", tree], 128 * 1024)
    require(raw.endswith(b"\0"), "Historical Engine tree inventory is incomplete")
    records = raw[:-1].split(b"\0")
    require(0 < len(records) <= ENGINE_MAX_FILES, "Historical Engine file inventory exceeds its bound")
    files, total = {}, 0
    for entry in records:
        fields = entry.split(b"\t", 1)
        require(len(fields) == 2, "Malformed historical Engine tree member")
        header, relative = fields[0].decode("ascii", "strict").split(), fields[1].decode("ascii", "strict")
        require(len(header) == 3 and header[0] in {"100644", "100755"} and header[1] == "blob" and pin(header[2], REVISION),
                "Only regular historical Engine Git blobs are allowed")
        parts = relative.split("/")
        require(re.fullmatch(r"[A-Za-z0-9_.\-/]{1,240}", relative) and not relative.startswith("/")
                and all(part not in {"", ".", "..", ".git", "__pycache__"} for part in parts)
                and not any(part.startswith(".env") for part in parts) and not relative.endswith(".pyc")
                and relative not in files, "Unsafe, generated, secret or duplicate historical Engine path")
        size_raw = read(["cat-file", "-s", header[2]], 32)
        require(re.fullmatch(rb"[0-9]{1,10}\n", size_raw), "Historical Engine blob size unavailable")
        size = int(size_raw)
        require(size <= ENGINE_MAX_FILE_BYTES and total + size <= ENGINE_MAX_TOTAL_BYTES, "Historical Engine source context exceeds its byte bound")
        data = read(["cat-file", "blob", header[2]], size)
        require(len(data) == size and sha1(f"blob {size}\0".encode() + data, usedforsecurity=False).hexdigest() == header[2],
                "Historical Engine raw blob differs from its exact Git identity")
        files[relative] = sha256(data).hexdigest(); total += size
    require(ENGINE_REQUIRED <= files.keys(), "Historical Engine context lacks required nonroot/migration files")
    # Match engine_image_smoke.context_record's exact JSON/hash contract.
    context = {"sha256": sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "files": files}
    return {"sourceRevision": revision, "fixedDirectory": ENGINE_DIRECTORY, "gitTree": tree,
            "fileCount": len(files), "totalBytes": total, "context": context}


def verify_historical_engine_context(revision, report_context, *, expected_sha256):
    source = historical_engine_context(revision)
    require(pin(expected_sha256) and source["context"]["sha256"] == expected_sha256
            and report_context == source["context"], "Authenticated Engine report/context pin differs from its exact producer Git blobs")
    return source


def selected_images(selection):
    """Pure exact identity selection; never infer a profile from runtime Cmd."""
    keys(selection, ROLES, "Six exact selected image roles required")
    result = deepcopy(selection)
    for role, row in result.items():
        keys(row, ("nativeImageId", "configDigest", "manifestDigest", "sourceRevision", "reference"), "Exact selected native/config/manifest/source pins required")
        require(all(pin(row[name], DIGEST) for name in ("nativeImageId", "configDigest", "manifestDigest"))
                and pin(row["sourceRevision"], REVISION)
                and (row["reference"] is None or type(row["reference"]) is str and len(row["reference"]) <= 255
                     and REFERENCE.fullmatch(row["reference"])), "Selected image has no immutable identity")
    require(len({row["nativeImageId"] for row in result.values()}) == len(ROLES), "Selected application image roles overlap")
    require(len({result[role]["sourceRevision"] for role in RETAINED}) == 1
            and len({result[role]["sourceRevision"] for role in ("worker", "old_web", "new_web")}) == 3,
            "Actual backend, incumbent and new SDK sources must remain distinct")
    return result


class _BudgetDocker:
    """Bound each real command by one campaign clock; cleanup gets420s once."""
    def __init__(self, docker, *, deadline, disk_root):
        self.docker, self.deadline, self.disk_root = docker, deadline, Path(disk_root)
        self.cleanup_deadline, self.cleanup_limit = None, None
        self.unknown_outcome = False

    def __getattr__(self, name):
        return getattr(self.docker, name)

    @contextmanager
    def cleanup_window(self):
        old = self.cleanup_deadline
        if self.cleanup_limit is None:
            self.cleanup_limit = time.monotonic() + 420
        self.cleanup_deadline = self.cleanup_limit
        try:
            yield
        finally:
            self.cleanup_deadline = old

    def run(self, arguments, *, timeout=30, **options):
        remaining = (self.cleanup_deadline or self.deadline) - time.monotonic()
        require(remaining > 0, "Finite native fixture command deadline exhausted")
        if self.cleanup_deadline is None:
            require(shutil.disk_usage(self.disk_root).free >= 4 * 1024**3, "Native fixture disk operating reserve exhausted")
        try:
            return self.docker.run(arguments, timeout=min(timeout, max(.1, remaining)), **options)
        except fresh.FreshCommandUnknown:
            # Mixed.run catches exceptions internally; retain this latch before
            # its finally block can consider destructive Docker cleanup.
            self.unknown_outcome = True
            raise

    def json(self, arguments, *, timeout=30):
        return inputs.decode(self.run(arguments, timeout=timeout).stdout)


def daemon_readback(docker, expected):
    keys(expected, ("serverId", "socketDevice", "socketInode"), "Independent daemon/socket identity required")
    require(type(expected["serverId"]) is str and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", expected["serverId"])
            and type(expected["socketDevice"]) is int and expected["socketDevice"] >= 0
            and type(expected["socketInode"]) is int and expected["socketInode"] > 0, "Exact native daemon/socket pin required")
    socket = Path("/var/run/docker.sock").lstat()
    require(stat.S_ISSOCK(socket.st_mode) and socket.st_uid == 0
            and (socket.st_dev, socket.st_ino) == (expected["socketDevice"], expected["socketInode"]), "Selected native Docker socket changed")
    observed = docker.run(["info", "--format", "{{.ID}} {{.OSType}} {{.Architecture}}"], timeout=10).stdout.strip().split()
    require(observed in ([expected["serverId"], "linux", "x86_64"], [expected["serverId"], "linux", "amd64"]), "Selected native daemon/source platform changed")
    return deepcopy(expected)


def _release_coordinator(budget, proof):
    """Leave/remove only this driver's empty child, remaining inside its cap."""
    parent = local.CGROUP_ROOT / budget["parent"]
    child = parent / "coordinator"
    require(proof["pid"] == os.getpid() and proof["startTicks"] == local._birth()
            and proof["cgroup"] == f"/{budget['parent']}/coordinator"
            and child.resolve(strict=True) == child and child.stat().st_uid == os.geteuid()
            and set((child / "cgroup.procs").read_text(encoding="ascii").splitlines()) == {str(os.getpid())}
            and not any(path.is_dir() for path in child.iterdir()), "Own coordinator cgroup changed; removal refused")
    with (parent / "cgroup.procs").open("w", encoding="ascii") as target:
        target.write(str(os.getpid()) + "\n")
    require(f"0::/{budget['parent']}" in local._self_cgroup() and proof["startTicks"] == local._birth()
            and not (child / "cgroup.procs").read_text(encoding="ascii").splitlines(), "Own coordinator did not return inside the parent cap")
    child.rmdir()
    require(not child.exists(), "Own coordinator child still exists")
    return True


def profiles(old, new, selection, publication_sha256):
    keys(old, ("kind", "sourceRevision", "nativeImageId", "configDigest", "command", "authoritySha256"), "Exact authenticated incumbent profile required")
    require(old["kind"] == "warpdrive-legacy-web-fixture-profile" and type(old["command"]) is list
            and tuple(old["command"]) in (LEGACY_COMMAND, tuple(SDK_COMMAND))
            and old["sourceRevision"] == selection["old_web"]["sourceRevision"]
            and old["nativeImageId"] == selection["old_web"]["nativeImageId"]
            and old["configDigest"] == selection["old_web"]["configDigest"] and pin(old["authoritySha256"]),
            "Incumbent runtime profile is not the selected authenticated old Web")
    validate_runtime_binding(new, expected_sha256=inputs.content_hash(new), authority_sha256=publication_sha256,
        source_revision=selection["new_web"]["sourceRevision"], image_id=selection["new_web"]["manifestDigest"],
        tested_config_digest=selection["new_web"]["configDigest"])
    return {"old_web": deepcopy(old), "new_web": deepcopy(new)}


def record_comparison(current, original, declared, *, original_revision):
    comparison = compare_backend_inputs(current, original, expected_sdk_sha256=inputs.content_hash(current),
        expected_original_sha256=inputs.content_hash(original), original_revision=original_revision)
    require(declared == comparison, "Supplied comparison conceals changed records or source inequality")
    return comparison


def support_declarations(supports):
    """Reuse the original lane's non-equality support-pin prerequisites."""
    keys(supports, local.SUPPORT, "Five exact support role pins required")
    for support in supports.values():
        keys(support, ("reference", "configDigest", "configBlob", "snapshot"), "Exact support digest/config/native snapshot required")
        require(type(support["reference"]) is str and len(support["reference"]) <= 255 and REFERENCE.fullmatch(support["reference"])
                and pin(support["configDigest"], DIGEST), "Immutable support reference/config required")
        require(support["configBlob"]["sha256"] == support["configDigest"][7:], "Support config byte pin differs from OCI digest")
        file_record(support["configBlob"]); file_record(support["snapshot"])
    return deepcopy(supports)


def common_configuration(row, revision, *, selected, command):
    """Only an already bound old/new fixed command may differ in common config."""
    require(tuple(command) in (LEGACY_COMMAND, tuple(SDK_COMMAND))
            and row.get("Image") == selected["nativeImageId"] and revision == selected["sourceRevision"]
            and row.get("Config", {}).get("Cmd") == list(command), "Actual selected Web runtime command differs")
    value = deepcopy(row)
    value["Config"]["Cmd"] = list(SDK_COMMAND)
    return mixed.common_web_configuration(value, revision)


def _full_artifact(part):
    keys(part, ("revision", "bundleDir", "apiAdmission", "bundleManifestSha256", "configDigests", "loadArchive"), "Exact original full-artifact custody required")
    require(pin(part["revision"], REVISION) and pin(part["bundleManifestSha256"]), "Exact full-artifact revision and manifest required")
    api = file_record(part["apiAdmission"])
    directory = Path(part["bundleDir"])
    loaded = verify_downloaded(api, directory, expected_revision=part["revision"])
    require(loaded["provenance"]["bundleManifestSha256"] == part["bundleManifestSha256"], "Full bundle manifest differs from independent pin")
    candidate = loaded["candidate"]
    keys(part["configDigests"], COMPONENTS, "Independent four-config original pins required")
    expected = {}
    for role, record in candidate["components"].items():
        rows = inputs.decode(regular_file(directory / "inspections", role + ".json", local.MAX_METADATA).read_bytes())
        require(type(rows) is list and len(rows) == 1 and type(rows[0].get("Config")) is dict, "Original image inspection unavailable")
        expected[role] = {"configDigest": part["configDigests"][role], "sourceRevision": record.get("sourceRevision", part["revision"]),
            "metadata": {name: rows[0]["Config"].get(name) for name in ("User", "Cmd", "Entrypoint", "WorkingDir")}}
    archive = loaded["archivePath"]
    original_graph = local._graph({"path": str(archive), "sha256": loaded["provenance"]["archiveSha256"], "bytes": archive.stat().st_size},
                                  expected, archive_mode="docker-save-compatibility")
    for role, record in candidate["components"].items():
        require(record["imageId"] in original_graph["images"][role]["nativeIdentityCandidates"], "Original tested native ID is detached from config graph")
    graph = original_graph if part["loadArchive"] is None else local.verify_load_archive(original_graph, part["loadArchive"], expected)
    return {"loaded": loaded, "graph": graph, "originalGraph": original_graph, "expected": expected, "api": api}


def _history_args(incumbent, backend, new_web, output):
    keys(incumbent, ("history", "archive", "configDigest", "metadata", "legacyProfile"), "Actual incumbent history/archive/profile required")
    history = incumbent["history"]
    names = set(mixed.REPEAT_OPTIONS) | set(mixed.SUCCESSOR_OPTIONS) | set(mixed.FUNCTIONAL_PREDECESSOR_OPTIONS)
    keys(history, names, "Complete exact incumbent history inputs required")
    require(all(value is None or type(value) is str for value in history.values()),
            "Incumbent history fields must be explicit strings or null")
    paths = {name for name in names if name.endswith("bundle") or name in {"seed_root", "functional_predecessor_composite"} or name.endswith("publication_receipt")}
    values = {key: Path(value) if key in paths and value is not None else value for key, value in history.items()}
    return SimpleNamespace(**values, bundle_dir=Path(backend["bundleDir"]), baseline_revision=backend["revision"],
        baseline_manifest_sha256=backend["bundleManifestSha256"], new_web_image_id=new_web["nativeImageId"],
        new_web_revision=new_web["sourceRevision"], output_dir=output, browser=True, sdk_keyboard_help=False,
        sdk_scenario=None, topbar_gaps=None)


def incumbent_baseline(args, backend):
    """Select only the existing strict reader for the explicitly supplied history."""
    if mixed.functional_successor_mode(args):
        return mixed.functional_successor_baseline(args, backend)
    require(mixed.successor_mode(args), "Incumbent requires complete functional or repeat-successor history")
    return mixed.successor_baseline(args, backend)


def fixture_web_command(runtime_profiles, role):
    """Use the admitted fixed profile, never a live runtime or caller command."""
    require(role in ("old_web", "new_web") and type(runtime_profiles) is dict and role in runtime_profiles,
            "Exact admitted Web generation profile required")
    command = runtime_profiles[role].get("command")
    require(type(command) is list and tuple(command) in (LEGACY_COMMAND, tuple(SDK_COMMAND))
            and (role == "old_web" or tuple(command) == tuple(SDK_COMMAND)),
            "Only the two fixed old launchers and fixed new SDK launcher are supported")
    return command.copy()


def verify_profile_commands(runtime_profiles, *, old_metadata, new_metadata):
    for role, metadata in (("old_web", old_metadata), ("new_web", new_metadata)):
        require(type(metadata) is dict and metadata.get("Cmd") == fixture_web_command(runtime_profiles, role),
                "Admitted Web artifact command differs from its fixed profile")


def verify_incumbent_profile_authority(runtime_profiles, chain, history):
    require(runtime_profiles["old_web"]["authoritySha256"] == chain["active"]["provenance"]["authoritySha256"]
            == history["successor_web_publication_receipt_sha256"],
            "Old command profile is detached from the actual accepted publication authority")


def newsletter_binding(witness, chain, selection, protected):
    """Keep an actual Engine, or prove only the incumbent's disabled integration.

    In the disabled case the selected Engine is an isolated synthetic probe
    input. It is neither a retained installed process nor newsletter acceptance.
    The real environment read remains verify_engine_unchanged's responsibility.
    """
    validate_newsletter_binding(witness, chain)
    disabled = witness.get("kind") == DISABLED_NEWSLETTER_KIND
    actual = witness["web"] if disabled else witness
    if disabled:
        require(actual["imageId"] == selection["old_web"]["nativeImageId"], "Disabled witness names another incumbent Web")
    else:
        require(actual.get("imageId") == selection["engine"]["nativeImageId"], "Fixture Engine differs from the actual retained Engine witness")
    require(any(row.get("running") is True and row.get("witness") == actual for row in protected),
            "Complete actual newsletter-state process is missing from protected witnesses")
    return {"mode": "disabled-integration" if disabled else "running-engine",
            "selectedEngineRole": "synthetic-fixture-only" if disabled else "actual-retained-engine",
            "actualEngineWitnessPresent": not disabled, "installedNewsletterAcceptance": False}


def admit_reuse(handoff, *, expected_handoff_sha256):
    """Verify immutable metadata/source/graphs only; no daemon mutation here."""
    keys(handoff, TOP, "Exact closed SDK reuse admission required")
    require(pin(expected_handoff_sha256) and inputs.content_hash(handoff) == expected_handoff_sha256,
            "Independent canonical reuse admission pin differs")
    require(type(handoff["schemaVersion"]) is int and handoff["schemaVersion"] == 1 and handoff["kind"] == ADMISSION_KIND,
            "Unsupported SDK reuse admission")
    require(handoff["dockerEndpoint"] == "unix:///var/run/docker.sock" and handoff["maximumSeconds"] == MAX_SECONDS
            and type(handoff["maximumSeconds"]) is int and type(handoff["allowPrivateFixturePublication"]) is bool
            and type(handoff["namespace"]) is str and NAMESPACE.fullmatch(handoff["namespace"]), "Exact finite private native fixture policy required")
    validate_storage_client_bin(handoff["storageClientBin"])
    require(validate_cgroup_parent(handoff["cgroup"].get("parent")) is not None, "Explicit aggregate cgroup is mandatory")
    support_declarations(handoff["supports"])
    source_pin = local.verify_source(handoff["source"])
    selection = selected_images(handoff["selection"])
    keys(handoff["sdk"], ("artifact", "projection", "inputReceipt", "runtimeBinding", "packagingReceipt"), "Exact full-SDK custody/projection inputs required")
    sdk_part = handoff["sdk"]
    sdk_artifact, backend = _full_artifact(sdk_part["artifact"]), _full_artifact(handoff["backend"])
    require(sdk_artifact["loaded"]["candidate"]["schemaVersion"] == 3, "Ordinary schema3 full-SDK candidate required")
    sdk_input = file_record(sdk_part["inputReceipt"])
    validate_web_sdk_full_receipt(sdk_input, expected_revision=selection["new_web"]["sourceRevision"])
    require(sdk_artifact["loaded"]["candidate"]["inputProvenance"]["receiptSha256"] == inputs.content_hash(sdk_input), "SDK inputs differ from authenticated original candidate")
    original_input = inputs.decode(regular_file(Path(handoff["backend"]["bundleDir"]), "component-inputs.json", 4 * 1024**2).read_bytes())
    comparison = record_comparison(sdk_input, original_input, file_record(handoff["comparison"]), original_revision=handoff["backend"]["revision"])
    contract = file_record(handoff["contractReview"])
    require(contract.get("kind") == "warpdrive-sdk-retained-backend-contract-delta-review"
            and contract.get("compatibilityAccepted") is False and contract.get("mixedQualificationPassed") is False,
            "Pinned source-only unequal-backend contract review required")
    require(contract["sources"]["installedBackendRevision"] == handoff["backend"]["revision"]
            and contract["sources"]["uiCandidateRevision"] == selection["new_web"]["sourceRevision"], "Contract review names different source inputs")
    projection = file_record(sdk_part["projection"])
    require(projection.get("kind") == "warpdrive-sdk-web-archive-projection" and projection.get("projectionOnly") is True
            and projection.get("backendReuseQualified") is False and projection.get("installationAuthorized") is False
            and projection.get("deploymentAuthorized") is False and projection["sourceRevision"] == selection["new_web"]["sourceRevision"], "Exact unqualified SDK Web projection required")
    require(projection["original"]["bundleManifestSha256"] == handoff["sdk"]["artifact"]["bundleManifestSha256"]
            and projection["original"]["archiveSha256"] == sdk_artifact["loaded"]["provenance"]["archiveSha256"]
            and projection["original"]["publicationAdmissionSha256"] == inputs.content_hash(sdk_artifact["api"])
            and projection["original"]["testedNativeImageId"] == sdk_artifact["loaded"]["candidate"]["components"]["web"]["imageId"],
            "Projection detached from authenticated original full-SDK custody")
    keys(handoff["newWebImport"], ("archive", "loadAllowed"), "Only an explicit derived new-Web import can be admitted")
    require(type(handoff["newWebImport"]["loadAllowed"]) is bool, "Exact new-Web load policy required")
    derived = handoff["newWebImport"]["archive"]
    require(derived["sha256"] == projection["derived"]["archiveSha256"] and derived["bytes"] == projection["derived"]["archiveSizeBytes"], "Derived new-Web transport pin differs")
    new_graph = local._graph(derived, {"new_web": sdk_artifact["expected"]["web"]})
    identities = {"new_web": new_graph["images"]["new_web"]}
    for role in RETAINED:
        identities[role] = backend["graph"]["images"][role]
    args = _history_args(handoff["incumbent"], handoff["backend"], selection["new_web"], Path("/unexecuted-output"))
    composite = incumbent_baseline(args, backend["loaded"])
    old_graph = local._graph(handoff["incumbent"]["archive"], {"old_web": {"configDigest": handoff["incumbent"]["configDigest"],
        "sourceRevision": composite["web"]["sourceRevision"], "metadata": handoff["incumbent"]["metadata"]}}, archive_mode="docker-save-compatibility")
    identities["old_web"] = old_graph["images"]["old_web"]
    require(composite["web"]["image"]["imageId"] == identities["old_web"]["configDigest"], "Incumbent narrow archive config differs from admitted history")
    chain, engine_witness = file_record(handoff["installedChain"]), file_record(handoff["engineWitness"])
    protected = file_record(handoff["protectedWitnesses"])
    require(type(protected) is list and 1 <= len(protected) <= 32 and all(type(row) is dict and set(row) == {"running", "witness"}
            and type(row["running"]) is bool and type(row["witness"]) is dict for row in protected), "Bounded independently pinned protected process witnesses required")
    newsletter_mode = newsletter_binding(engine_witness, chain, selection, protected)
    engine = handoff["engine"]
    keys(engine, ("revision", "archive", "loadArchive", "configDigest", "metadata", "apiAdmission", "report", "contextSha256"), "Exact accepted Engine custody required")
    engine_api, engine_report = file_record(engine["apiAdmission"]), file_record(engine["report"])
    engine_source = verify_historical_engine_context(engine["revision"], engine_report.get("context"), expected_sha256=engine["contextSha256"])
    keys(engine_api, ("kind", "repository", "workflow", "revision", "contextSha256", "archiveSha256", "reportSha256", "producer", "artifact"), "Exact authenticated Engine API snapshot required")
    local._engine_producer(engine, engine_api["producer"], engine_api["artifact"], handoff["source"])
    require(engine_api.get("kind") == "warpdrive-engine-api-handoff" and engine_api.get("repository") == REPO
            and engine_api.get("workflow") == "production-engine.yml"
            and engine_api.get("revision") == engine["revision"] and engine_api.get("archiveSha256") == engine["archive"]["sha256"]
            and engine_api.get("reportSha256") == engine["report"]["sha256"] and engine_api.get("contextSha256") == engine["contextSha256"]
            and engine_report.get("success") is True and engine_report.get("failure") is None
            and engine_report.get("cleanup", {}).get("success") is True and not engine_report["cleanup"].get("errors")
            and local.required_checks_passed(engine_report.get("checks")) and engine_report.get("expectedRevision") == engine["revision"]
            and engine_report.get("context") == engine_source["context"]
            and engine["contextSha256"] == engine_source["context"]["sha256"], "Accepted Engine producer/native qualification/historical context differs")
    engine_expected = {"engine": {"configDigest": engine["configDigest"], "sourceRevision": engine["revision"], "metadata": engine["metadata"]}}
    original_engine_graph = local._graph(engine["archive"], engine_expected, archive_mode="docker-save-compatibility")
    require(engine_report["image"]["id"] in original_engine_graph["images"]["engine"]["nativeIdentityCandidates"], "Original Engine native identity detached from archive")
    engine_graph = original_engine_graph if engine["loadArchive"] is None else local.verify_load_archive(original_engine_graph, engine["loadArchive"], engine_expected)
    identities["engine"] = engine_graph["images"]["engine"]
    for role, row in selection.items():
        identity = identities[role]
        require(row["configDigest"] == identity["configDigest"] and row["manifestDigest"] == identity["manifestDigest"]
                and row["sourceRevision"] == identity["sourceRevision"] and row["nativeImageId"] in identity["nativeIdentityCandidates"], "Selected role differs from exact archive graph")
    require(projection["selectedWeb"]["configDigest"] == selection["new_web"]["configDigest"]
            and projection["selectedWeb"]["manifestDigest"] == selection["new_web"]["manifestDigest"], "Selected SDK config/platform manifest differs from original projection")
    binding = file_record(sdk_part["runtimeBinding"])
    runtime_profiles = profiles(file_record(handoff["incumbent"]["legacyProfile"]), binding, selection, sdk_part["artifact"]["apiAdmission"]["sha256"])
    verify_profile_commands(runtime_profiles, old_metadata=handoff["incumbent"]["metadata"],
        new_metadata=sdk_artifact["expected"]["web"]["metadata"])
    require(chain["active"]["provenance"]["revision"] == selection["old_web"]["sourceRevision"]
            and chain["active"]["provenance"]["testedConfigDigest"] == selection["old_web"]["configDigest"]
            and chain["active"]["slot"]["runtime"]["imageId"] == selection["old_web"]["nativeImageId"], "Actual accepted incumbent chain differs from selected old Web")
    verify_incumbent_profile_authority(runtime_profiles, chain, handoff["incumbent"]["history"])
    protected_ids = {row["witness"]["id"] for row in protected}
    require(len(protected_ids) == len(protected)
            and chain["active"]["slot"]["runtime"]["runtimeId"] in protected_ids
            and all(any(row["witness"]["imageId"] == selection[role]["nativeImageId"] for row in protected) for role in RETAINED),
            "Protected witness inventory omits actual incumbent or retained backend")
    return {"handoff": deepcopy(handoff), "sourcePin": source_pin, "selection": selection, "selectionSha256": inputs.content_hash(selection),
        "identities": identities, "backend": backend, "composite": composite, "projection": projection, "comparison": comparison,
        "runtimeProfiles": runtime_profiles, "chain": chain, "engineWitness": engine_witness, "protectedWitnesses": protected,
        "newGraph": new_graph, "historicalEngineSource": engine_source, "newsletterMode": newsletter_mode,
        "sdkPackagingReceipt": file_record(sdk_part["packagingReceipt"])}


class _Inspect:
    def __init__(self, docker):
        self.docker = docker

    def inspect(self, identifier):
        rows = self.docker.json(["container", "inspect", identifier], timeout=10)
        require(type(rows) is list and len(rows) == 1, "One exact protected process required")
        return rows[0]


def protected_readback(docker, admitted):
    native = _Inspect(docker)
    for item in admitted["protectedWitnesses"]:
        actual = process_witness(native.inspect(item["witness"]["id"]), running=item["running"])
        require(actual == item["witness"], "Protected production process changed")
    return verify_engine_unchanged(native, admitted["engineWitness"], expected_sha256=inputs.content_hash(admitted["engineWitness"]))


def cache_readback(docker, admitted):
    result = {}
    for role, selection in admitted["selection"].items():
        rows = docker.json(["image", "inspect", selection["nativeImageId"]], timeout=10)
        verify_native_inspection(admitted["identities"][role], rows, expected_native_id=selection["nativeImageId"])
        result[role] = {"nativeImageId": selection["nativeImageId"], "repoTags": sorted(rows[0].get("RepoTags") or []),
                        "repoDigests": sorted(rows[0].get("RepoDigests") or [])}
    return result


class _PrivateRegistry(RegistrySmoke):
    def __init__(self, *args, namespace, **options):
        super().__init__(*args, **options)
        require(NAMESPACE.fullmatch(namespace), "Exact private registry namespace required")
        self.prefix, self.registry_name = namespace, namespace + "-registry"

    def tag_image(self, image_id, reference):
        require(reference.startswith(self.repository_prefix + "/") and reference not in self.owned_tags, "Only a fresh own fixture alias may be created")
        observed = self.docker.run(["image", "inspect", reference], check=False, timeout=10)
        require(observed.returncode != 0 and "no such image" in (observed.stderr or "").lower(), "Private publication alias already exists or absence is indeterminate")
        return super().tag_image(image_id, reference)


class _FreshProducer(fresh.FreshSmoke):
    def __init__(self, *args, admitted, **options):
        self.admitted = admitted
        super().__init__(*args, **options)
        self.docker = _BudgetDocker(self.docker, deadline=admitted["executionDeadline"], disk_root=admitted["executionDiskRoot"])
        require(self.cgroup_parent == admitted["handoff"]["cgroup"]["parent"], "Fresh probe aggregate cgroup differs")

    def _preloaded(self):
        daemon_readback(self.docker, self.admitted["handoff"]["daemon"])
        return super()._preloaded()

    def prepare(self):
        super().prepare()
        for phase, role in (("baseline", "old_web"), ("candidate", "new_web")):
            model = inputs.decode(self.compose(phase, "--profile", "newsletter-migrations", "config", "--format", "json").encode())
            require(model["services"]["app"].get("command") == fixture_web_command(self.admitted["runtimeProfiles"], role),
                    "Fresh Compose launcher differs from the admitted Web profile")

    def _ready_rows(self, phase):
        require(phase in ("baseline", "candidate"), "Exact Fresh Web phase required")
        rows = super()._ready_rows(phase)
        role = "old_web" if phase == "baseline" else "new_web"
        require(rows["app"]["Image"] == self.images[phase]["app"]
                and self.revisions[phase] == self.admitted["selection"][role]["sourceRevision"]
                and rows["app"]["Config"].get("Cmd") == fixture_web_command(self.admitted["runtimeProfiles"], role),
                "Actual Fresh Web launcher, transport image or source differs from its admitted profile")
        return rows

    def cleanup(self):
        with self.docker.cleanup_window():
            return super().cleanup()

    def _observe(self, relay, phase):
        result = super()._observe(relay, phase)
        if phase == "candidate":
            rows = self._ready_rows(phase)
            completed = self._bun_probe(rows["app"], fresh.WORKER_PROBE, 45)
            fresh.require(completed == {"completed": True}, "Actual new Web producer did not reach retained Worker")
            self.receipt["checks"]["newWebProducerRetainedWorker"] = {"completed": True,
                "producerImageId": rows["app"]["Image"], "workerImageId": rows["worker"]["Image"], "restartDurabilityQualified": False}
        return result


class _PreloadedMixed(mixed.MixedWebSmoke):
    """No inherited image load method is ever invoked by this adapter."""
    def __init__(self, docker, args, private, *, admitted, supports):
        self.admitted, self.supports = admitted, supports
        super().__init__(docker, args, private)

    def load(self):
        selected = self.admitted["selection"]
        cache_readback(self.docker, self.admitted)
        self.verify_browser_source(self.admitted["backend"]["loaded"]["candidate"])
        images = {role: selected[role]["nativeImageId"] for role in RETAINED}
        images["web"] = selected["old_web"]["nativeImageId"]
        self.fixture = ImageSmoke(self.docker, images, self.private / "fixture", expected_revision=self.revision,
            postgres_image=self.supports["postgres"]["nativeImageId"], cgroup_parent=self.admitted["handoff"]["cgroup"]["parent"])
        for role in RETAINED:
            rows = self.docker.json(["image", "inspect", images[role]], timeout=10)
            self.fixture.report["images"][role] = image_metadata(rows, self.revision)
        self.old_image = mixed.read_web_image(self.docker, selected["old_web"]["nativeImageId"], selected["old_web"]["sourceRevision"])
        self.new_image = mixed.read_web_image(self.docker, selected["new_web"]["nativeImageId"], selected["new_web"]["sourceRevision"])
        self.retained_images = {role: images[role] for role in RETAINED}
        self.baseline_candidate = self.admitted["backend"]["loaded"]["candidate"]
        self.report["revision"] = self.old_image["sourceRevision"]
        self.assembly = {"kind": "warpdrive-sdk-selected-preloaded-mixed-assembly", "selectionSha256": self.admitted["selectionSha256"],
            "activeWebRevision": self.old_image["sourceRevision"], "newWeb": self.new_image,
            "retainedBackendImages": self.retained_images, "runtimeProfiles": deepcopy(self.admitted["runtimeProfiles"]),
            "archiveLoads": 0, "fixtureBuilds": 0, "engineInMixedFixture": False}
        self.report["images"] = self.assembly
        return self.assembly

    def selected_caddy_image(self):
        return self.supports["caddy"]["nativeImageId"]

    def cleanup_docker_allowed(self):
        return self.docker.unknown_outcome is False

    def cleanup(self):
        with self.docker.cleanup_window():
            return super().cleanup()

    def web_command(self, suffix, image):
        role = "old_web" if suffix == "a" else "new_web" if suffix == "b" else None
        require(role is not None and image["imageId"] == self.admitted["selection"][role]["nativeImageId"], "Unknown Web generation profile")
        return fixture_web_command(self.admitted["runtimeProfiles"], role)

    def common_configuration(self, row, revision):
        roles = [role for role in ("old_web", "new_web") if self.admitted["selection"][role]["nativeImageId"] == row.get("Image")]
        require(len(roles) == 1, "Runtime not selected by authenticated old/new artifact")
        role = roles[0]
        return common_configuration(row, revision, selected=self.admitted["selection"][role],
            command=fixture_web_command(self.admitted["runtimeProfiles"], role))


def subproofs_complete(fresh_report, mixed_report, *, selected_native_ids):
    """Exact lower report structure/checks; caller also binds their actual run."""
    required_mixed = {"authenticated-baseline-and-local-web", "owned-retained-backend-and-two-web-runtimes",
        "compiled-caddy-and-initial-web", "native-browser-draft-and-authenticated-socket-before-switch",
        "forward-web-generation-switch", "persistent-old-tab-action-and-fresh-realtime-after-switch",
        "rollback-to-retained-web-generation", "stopped-candidate-automatically-restores-retained-web"}
    checks = mixed_report.get("checks")
    require(fresh_report.get("kind") == "warpdrive-native-fresh-compose-smoke" and fresh_report.get("success") is True
            and fresh_report.get("cleanupSuccess") is True and fresh_report.get("manualReconciliationRequired") is False
            and mixed_report.get("success") is True and mixed_report.get("browserContinuityQualified") is True
            and mixed_report.get("cleanup", {}).get("success") is True and not mixed_report["cleanup"].get("errors")
            and type(checks) is list and len(checks) == len(required_mixed)
            and {row.get("name") for row in checks} == required_mixed and all(row.get("status") == "passed" for row in checks),
            "Both actual native subproofs and complete cleanup are mandatory")
    producer = fresh_report.get("checks", {}).get("newWebProducerRetainedWorker", {})
    require(producer == {"completed": True, "producerImageId": selected_native_ids["new_web"],
                        "workerImageId": selected_native_ids["worker"], "restartDurabilityQualified": False},
            "New Web producer/retained Worker evidence differs from exact immutable selection")
    require(all(fresh_report["checks"].get(name) for name in ("baseline", "candidate", "rollback", "injectedFailure", "cleanupDrain")),
            "Fresh native Engine/storage/rollback/drain subproof is incomplete")
    require(fresh_report.get("deploymentAuthorized") is False and mixed_report.get("deploymentAuthorized") is False,
            "Qualification subproofs cannot contain deployment authority")
    return True


def execute_reuse(handoff, output, *, expected_handoff_sha256):
    """One serial native attempt. No builds/pulls/installed mutation/retries.

    This output deliberately is NOT admission.QUALIFICATION_KIND. Separate Core
    API/live-schema/packaging/custody authority remains the composition owner's
    responsibility; the nine-check final record cannot be invented here.
    """
    require(platform.system() == "Linux" and platform.machine() in {"x86_64", "amd64"} and os.geteuid() == 0,
            "Actual native root Linux AMD64 execution required")
    output = Path(output)
    require(output.is_absolute() and output.parent.resolve(strict=True) == output.parent and not os.path.lexists(output), "Fresh private output required; no automatic retry")
    admitted = admit_reuse(handoff, expected_handoff_sha256=expected_handoff_sha256)
    require(not output.is_relative_to(local.ROOT), "Private proof output must not become an untracked source overlay")
    output.mkdir(mode=0o700)
    report = {"schemaVersion": 1, "kind": KIND, "success": False, "deploymentAuthorized": False,
        "installationAuthorized": False, "installedBackendCompatibilityQualified": False, "coreApiQualified": False,
        "fullNineCheckQualificationComplete": False, "selectionSha256": admitted["selectionSha256"],
        "selectedOriginalIdentities": deepcopy(admitted["selection"]),
        "custodyPins": {"sdkPublicationRawSha256": handoff["sdk"]["artifact"]["apiAdmission"]["sha256"],
            "sdkProjectionRawSha256": handoff["sdk"]["projection"]["sha256"], "sdkInputRawSha256": handoff["sdk"]["inputReceipt"]["sha256"],
            "backendOriginalManifestSha256": handoff["backend"]["bundleManifestSha256"],
            "backendPublicationRawSha256": handoff["backend"]["apiAdmission"]["sha256"],
            "incumbentPublicationRawSha256": handoff["incumbent"]["history"]["successor_web_publication_receipt_sha256"],
            "installedChainRawSha256": handoff["installedChain"]["sha256"], "engineApiRawSha256": handoff["engine"]["apiAdmission"]["sha256"],
            "engineWitnessRawSha256": handoff["engineWitness"]["sha256"], "sourceContractReviewRawSha256": handoff["contractReview"]["sha256"]},
        "handoffSha256": expected_handoff_sha256, "comparison": admitted["comparison"], "manualReconciliationRequired": False,
        "historicalEngineSource": deepcopy(admitted["historicalEngineSource"]),
        "newsletterMode": deepcopy(admitted["newsletterMode"]),
        "bounds": {"mainSeconds": MAX_SECONDS, "finalCleanupSeconds": 420, "automaticRetries": 0, "serialNativeProbes": 2},
        "limitations": ["Two distinct fresh synthetic assemblies share immutable artifact selection, not runtime/container identity.",
            "Fresh covers the explicitly selected Engine fixture/storage/Worker; Mixed covers native auth/Realtime/old tabs/generation reversal and excludes Engine.",
            "When actual newsletter integration is disabled, the Engine is synthetic only; no Engine installation or newsletter delivery/provider acceptance is inferred.",
            "Separate Core API, actual installed populated schema/journey, providers, performance and deployment acceptance are excluded.",
            "Retained6b named-worker-heartbeat remains unknown/not_reported; no restart-durability claim.",
            "Original candidate/projection pending gates remain unchanged; external nine-check completion remains required."]}
    docker, registry, keepers, original_cache, fresh_clean, mixed_clean = None, None, [], None, True, True
    mutation_unknown = False
    def save(): local._save(output, report)
    started = time.monotonic()
    try:
        native = IsolatedDocker(output / "docker", runner=fresh.run_owned_fixture_command)
        root = Path(native.run(["info", "--format", "{{.DockerRootDir}}"], timeout=10).stdout.strip())
        require(root.is_absolute() and root.is_dir(), "Actual native Docker disk root required")
        admitted["executionDeadline"], admitted["executionDiskRoot"] = started + MAX_SECONDS, str(root)
        docker = local.JournalDocker(_BudgetDocker(native, deadline=admitted["executionDeadline"], disk_root=root), report, save)
        require(docker.endpoint == handoff["dockerEndpoint"], "Native Docker endpoint differs")
        report["daemon"] = daemon_readback(docker, handoff["daemon"])
        report["budget"] = local.verify_budget(handoff["cgroup"], docker, initial=True)
        report["coordinator"] = local.move_self(handoff["cgroup"])
        protected_readback(docker, admitted)
        supports = local.support_images(docker, handoff)
        # Cache-only role sets cannot cause an old archive load. Only the new
        # projected Web has an independently admitted one-load policy.
        proofs = {}
        for role in ("old_web", *RETAINED, "engine"):
            part, count = local.preload(docker, Path("/not-loadable"), {"images": {role: admitted["identities"][role]}},
                load_allowed=False, expected_ids={role: admitted["selection"][role]["nativeImageId"]})
            require(count == 0, "Cached old role must never be imported")
            proofs.update(part)
        mutation_unknown = True
        new, count = local.preload(docker, Path(handoff["newWebImport"]["archive"]["path"]), admitted["newGraph"],
            load_allowed=handoff["newWebImport"]["loadAllowed"], expected_ids={"new_web": admitted["selection"]["new_web"]["nativeImageId"]})
        mutation_unknown = False
        proofs.update(new); report["newWebArchiveLoads"] = count
        original_cache = cache_readback(docker, admitted)
        references = {role: value["reference"] for role, value in admitted["selection"].items()}
        if any(value is None for value in references.values()):
            require(handoff["allowPrivateFixturePublication"] is True, "Missing preexisting RepoDigest needs explicit own-loopback publication policy")
            # A stopped native container keeps each original image reachable
            # while its temporary aliases are removed. It never executes code.
            for role, selected in admitted["selection"].items():
                name = handoff["namespace"] + "-keeper-" + role
                keeper = {"id": None, "name": name, "imageId": selected["nativeImageId"]}
                keepers.append(keeper); report["cacheKeepers"] = keepers; save()
                mutation_unknown = True
                identifier = docker.run(["create", "--pull", "never", "--name", name, "--label", f"{OWNER}={handoff['namespace']}",
                    "--network", "none", "--memory", "16m", "--memory-swap", "16m", "--cpus", "0.1", "--pids-limit", "16",
                    "--cgroup-parent", handoff["cgroup"]["parent"], "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                    "--read-only", "--entrypoint", "/bin/true", selected["nativeImageId"]], timeout=30).stdout.strip()
                require(pin(identifier), "Owned stopped cache keeper creation has unknown outcome")
                keeper["id"] = identifier
                created, = docker.json(["container", "inspect", identifier], timeout=10)
                require(created["Id"] == identifier and created["Name"] == "/" + name and created["Image"] == selected["nativeImageId"]
                        and created["State"]["Status"] == "created" and created["Config"]["Labels"].get(OWNER) == handoff["namespace"], "Stopped cache keeper did not bind selected native image")
                keeper["createdAt"] = created["Created"]
                mutation_unknown = False
            registry = _PrivateRegistry(docker, Path(handoff["backend"]["bundleDir"]), handoff["backend"]["revision"], output / "registry",
                namespace=handoff["namespace"], registry_image=supports["registry"]["reference"], registry_preloaded=True,
                cgroup_parent=handoff["cgroup"]["parent"])
            mutation_unknown = True
            references, published = local.publish(registry, docker, admitted["identities"], proofs)
            for role, reference in references.items():
                registry.owned_tags[reference] = published[role]["nativeImageId"]
            mutation_unknown = False
            report["privateFixtureTransports"] = published
            report["transportManifestEqualityClaimed"] = False
        transport_native = {}
        for role, reference in references.items():
            rows = docker.json(["image", "inspect", reference], timeout=10)
            require(reference in (rows[0].get("RepoDigests") or []), "Selected immutable fixture reference is not preloaded")
            actual = verify_native_inspection(admitted["identities"][role], rows) if registry is None else published[role]
            require(actual["configDigest"] == admitted["selection"][role]["configDigest"], "Transport selection changed source config")
            transport_native[role] = actual["nativeImageId"]
        report["selectedReferences"] = references
        report["transportNativeImageIds"] = transport_native
        baseline = {"app": references["old_web"], "worker": references["worker"], "ws": references["realtime"], "migrate": references["migrator"],
                    "newsletter-engine": references["engine"], "newsletter-engine-migrate": references["engine"]}
        baseline.update({service: supports[role]["reference"] for role, service in local.SUPPORT.items() if service})
        candidate = {**baseline, "app": references["new_web"]}
        require(MAX_SECONDS - (time.monotonic() - started) >= fresh.TOTAL_SECONDS + fresh.CLEANUP_SECONDS,
                "Single campaign lacks the existing finite Fresh main/cleanup budget")
        fresh_clean = False; report["phase"] = "fresh-intent"; save()
        report["fresh"] = fresh.run(baseline, candidate, storage_client_bin=handoff["storageClientBin"], cgroup_parent=handoff["cgroup"]["parent"],
            fixture_factory=partial(_FreshProducer, admitted=admitted))
        mutation_unknown = report["fresh"].get("mutationCompletionUnknown") is True
        fresh_clean = report["fresh"].get("cleanupSuccess") is True and report["fresh"].get("manualReconciliationRequired") is False
        require(report["fresh"].get("success") is True and fresh_clean, "Fresh subproof failed or cleanup unknown; Mixed is not attempted")
        local.verify_source(handoff["source"]); local.verify_budget(handoff["cgroup"], docker); protected_readback(docker, admitted)
        require(time.monotonic() - started < MAX_SECONDS, "Single campaign time budget exhausted before Mixed")
        args = _history_args(handoff["incumbent"], handoff["backend"], admitted["selection"]["new_web"], output / "mixed")
        private = output / "mixed-private"; private.mkdir(mode=0o700)
        probe = _PreloadedMixed(docker, args, private, admitted=admitted, supports=supports)
        mixed_clean = False; report["phase"] = "mixed-intent"; save()
        probe.run(); report["mixed"] = probe.report
        mixed_clean = probe.report.get("cleanup", {}).get("success") is True
        subproofs_complete(report["fresh"], report["mixed"], selected_native_ids=transport_native)
        require(time.monotonic() - started <= MAX_SECONDS, "Single campaign time budget exceeded")
        local.verify_source(handoff["source"]); local.verify_budget(handoff["cgroup"], docker); protected_readback(docker, admitted)
        daemon_readback(docker, handoff["daemon"])
        report.update(success=True, phase="native-subproofs-complete", nativeReportsExecuted=True,
            sourceOverlaySha256=admitted["sourcePin"], runtimeProfiles=deepcopy(admitted["runtimeProfiles"]))
    except (Exception, KeyboardInterrupt) as error:
        report.update(success=False, phase="held", failureType=type(error).__name__)
        mutation_unknown = mutation_unknown or isinstance(error, fresh.FreshCommandUnknown) or bool(docker is not None and docker.unknown_outcome)
        if type(error) is ValueError: report["failureFact"] = str(error)
    finally:
        # Unknown fixture cleanup retains publication/keepers for manual review.
        cleanup_errors = []
        if mutation_unknown: cleanup_errors.append("native-mutation-completion-unknown")
        if registry is not None and fresh_clean and mixed_clean and not mutation_unknown:
            try:
                with docker.cleanup_window(): cleanup_errors.extend(registry.cleanup())
            except Exception: cleanup_errors.append("own-registry-cleanup")
        elif registry is not None: cleanup_errors.append("native-subfixture-cleanup-unresolved")
        if docker is not None and not cleanup_errors:
            for keeper in reversed(keepers):
                try:
                    with docker.cleanup_window():
                        row, = docker.json(["container", "inspect", keeper["id"]], timeout=10)
                        require(row["Id"] == keeper["id"] and row["Name"] == "/" + keeper["name"] and row["Image"] == keeper["imageId"]
                                and row["Created"] == keeper["createdAt"] and row["Config"]["Labels"].get(OWNER) == handoff["namespace"] and row["State"]["Status"] == "created"
                                and row["HostConfig"]["CgroupParent"] == handoff["cgroup"]["parent"], "Stopped cache keeper identity changed")
                        docker.run(["container", "rm", keeper["id"]], timeout=15)
                except Exception: cleanup_errors.append("own-cache-keeper-cleanup")
        if docker is not None:
            try:
                with docker.cleanup_window():
                    protected_readback(docker, admitted); daemon_readback(docker, handoff["daemon"])
                    if not cleanup_errors and original_cache is not None:
                        require(cache_readback(docker, admitted) == original_cache, "Original selected image/cache alias inventory changed")
                        report["originalCacheAndAliasesRestored"] = True
                    local.verify_source(handoff["source"])
                    report["protectedSourceDaemonReadbackPassed"] = True
            except Exception: cleanup_errors.append("protected-source-cache-readback")
        if not cleanup_errors and fresh_clean and mixed_clean and "coordinator" in report:
            try: report["coordinatorReleasedInsideParentBudget"] = _release_coordinator(handoff["cgroup"], report["coordinator"])
            except Exception: cleanup_errors.append("own-coordinator-cgroup-release")
        report["cleanupSuccess"] = not cleanup_errors and fresh_clean and mixed_clean
        report["manualReconciliationRequired"] = not report["cleanupSuccess"]
        report["cleanupErrors"] = cleanup_errors
        report["success"] = report["success"] and report["cleanupSuccess"]
        report["durationSeconds"] = time.monotonic() - started
        save()
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", action="store_true", required=True)
    parser.add_argument("--admission-file", required=True, type=Path)
    parser.add_argument("--admission-raw-sha256", required=True)
    parser.add_argument("--admission-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    handoff = file_record({"path": str(args.admission_file), "sha256": args.admission_raw_sha256,
                           "bytes": args.admission_file.lstat().st_size})
    result = execute_reuse(handoff, args.output_dir, expected_handoff_sha256=args.admission_sha256)
    print(json.dumps({key: result[key] for key in ("kind", "success", "cleanupSuccess", "manualReconciliationRequired",
        "installedBackendCompatibilityQualified", "fullNineCheckQualificationComplete", "deploymentAuthorized")}))
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
