"""Retain one tested Web image and its exact-source mixed-assembly evidence.

The caller authenticates the accepted baseline and producing workflow. The
reader requires their independently obtained manifest pins. A valid bundle
still requires publication and installed rollout admission.
"""
from __future__ import annotations

from contextlib import contextmanager, ExitStack
import hashlib
import os
from pathlib import Path
import re
import stat
import tarfile

from bundle import INPUT_RECEIPT, MAX_METADATA_BYTES, load_bundle, validate_origin
from candidate import COMPONENTS, REVISION, CandidateError, require
import component_inputs as inputs
from image_smoke import image_metadata
from web_mixed_image_smoke import LIMITATIONS, REVISION_LABEL, browser_message, build_environment, read_web_image
from web_release_inputs import (
    ENGINE_CONTEXT_VERSION, RUNTIME_PROFILE, WebReleaseInputError,
    verify_web_source_delta, web_input_delta,
)
from web_switch import content_hash as runtime_hash


MANIFEST = "web-bundle.json"
ARCHIVE = "web-image.tar"
BASELINE_INPUTS = "baseline-component-inputs.json"
BUILD = "web-release-build.json"
MIXED = "web-mixed-report.json"
METADATA = (INPUT_RECEIPT, BASELINE_INPUTS, BUILD, MIXED)
MAX_ARCHIVE_BYTES = 3 * 1024**3
MAX_TAR_MEMBERS = 512
PLATFORM = "linux/amd64"
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
USER = re.compile(r"[a-zA-Z_][a-zA-Z0-9_.-]{0,127}|[0-9]{1,10}")
BLOB_PATH = re.compile(r"blobs/sha256/[a-f0-9]{64}\Z")
IMAGE_MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json",
                        "application/vnd.docker.distribution.manifest.v2+json"}
LAYER_TYPES = {"application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip",
               "application/vnd.oci.image.layer.v1.tar+zstd", "application/vnd.docker.image.rootfs.diff.tar",
               "application/vnd.docker.image.rootfs.diff.tar.gzip", "application/vnd.docker.image.rootfs.diff.tar.zstd"}
CHECKS = (
    "authenticated-baseline-and-local-web",
    "owned-retained-backend-and-two-web-runtimes",
    "compiled-caddy-and-initial-web",
    "native-browser-draft-and-authenticated-socket-before-switch",
    "forward-web-generation-switch",
    "persistent-old-tab-action-and-fresh-realtime-after-switch",
    "rollback-to-retained-web-generation",
    "stopped-candidate-automatically-restores-retained-web",
)
SOURCE_HASH_FIELDS = ("runtimePolicySha256", "engineContextSha256", "engineContextTreeSha256")


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@contextmanager
def _directory(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), "Canonical Web bundle directory required")
    with ExitStack() as opened:
        descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
        opened.callback(os.close, descriptor)
        for part in path.parts[1:]:
            descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            opened.callback(os.close, descriptor)
        before = _identity(os.fstat(descriptor))
        yield descriptor
        require(before == _identity(os.fstat(descriptor)) == _identity(path.lstat()),
                "Web bundle directory changed during readback")


@contextmanager
def _opened(parent, name, maximum):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
                "Bounded single-link Web bundle file required")
        yield source, before.st_size
        named = os.stat(name, dir_fd=parent, follow_symlinks=False)
        require(_identity(before) == _identity(os.fstat(descriptor)) == _identity(named),
                "Web bundle file changed during readback")


def _metadata(parent, name):
    with _opened(parent, name, MAX_METADATA_BYTES) as (source, size):
        raw = source.read(MAX_METADATA_BYTES + 1)
        require(len(raw) == size, "Web bundle metadata size changed")
        return raw


def _input_file(path):
    path = Path(path)
    with _directory(path.parent) as parent:
        return _metadata(parent, path.name)


def _record(raw):
    return {"sha256": _sha(raw), "sizeBytes": len(raw)}


def _stream_digest(source, size):
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = source.read(min(1024**2, remaining))
        require(chunk, "Web archive ended early")
        digest.update(chunk)
        remaining -= len(chunk)
    require(source.read(1) == b"", "Web archive grew during readback")
    return digest.hexdigest()


def _write(directory, name, raw):
    descriptor = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())


def _main_origin(origin):
    validate_origin(origin)
    require(origin["kind"] == "github-actions" and origin["ref"] == "refs/heads/main"
            and origin["event"] in {"push", "workflow_dispatch"},
            "A trusted main workflow origin is required for a Web release bundle")
    return origin


def _baseline(value, revision, manifest_sha, repository):
    require(isinstance(value, dict) and set(value) == {"revision", "manifestSha256", "archiveSha256",
            "origin", "imageIds"} and value["revision"] == revision and value["manifestSha256"] == manifest_sha
            and _matches(inputs.HASH, value["archiveSha256"]), "Accepted full-bundle provenance differs")
    require(_main_origin(value["origin"])["repository"] == repository, "Baseline repository differs")
    ids = value["imageIds"]
    require(isinstance(ids, dict) and set(ids) == set(COMPONENTS)
            and all(_matches(IMAGE_ID, image_id) for image_id in ids.values())
            and len(set(ids.values())) == len(COMPONENTS), "Exact original Core image IDs are required")
    return value


def _source_delta(delta, before, after, old_revision, revision):
    inputs.validate_receipt(before)
    inputs.validate_receipt(after)
    require(before["context"] == after["context"]
            and after["context"]["buildArgs"] == {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"}
            and before["inputPolicySha256"] == after["inputPolicySha256"], "Web release build context differs")
    old_components, new_components = before["components"], after["components"]
    for name in ("worker", "realtime", "migrator"):
        require(old_components[name] == new_components[name], "A retained Core input changed")
    old, new = old_components["web"], new_components["web"]
    graph = {key for key in old if key not in {"inputs", "componentInputSha256"}}
    require(all(old[key] == new[key] for key in graph), "Web helper graph differs")
    try:
        changed, tooling = web_input_delta(old, new)
    except WebReleaseInputError as error:
        raise CandidateError(str(error)) from error
    require(isinstance(delta, dict) and all(_matches(inputs.HASH, delta.get(key)) for key in SOURCE_HASH_FIELDS),
            "Engine and runtime policy evidence is required")
    expected = {
        "schemaVersion": 1, "kind": "warpdrive-web-source-delta", "profile": RUNTIME_PROFILE,
        "presentationPolicyVersion": 1, "platform": PLATFORM, "releaseRevision": revision,
        "baselineRevision": old_revision, "engineContextVersion": ENGINE_CONTEXT_VERSION,
        "baselineCoreInputReceiptSha256": inputs.content_hash(before),
        "currentCoreInputReceiptSha256": inputs.content_hash(after),
        "currentWebInputSha256": new["componentInputSha256"], "inputPolicySha256": after["inputPolicySha256"],
        "changedPresentationPaths": changed,
        **({"changedReleaseToolingPaths": tooling} if tooling else {}),
        "buildComponents": ["web"], "deploymentAuthorized": False,
        **{key: delta[key] for key in SOURCE_HASH_FIELDS},
    }
    require(inputs.canonical(delta) == inputs.canonical(expected), "Exact Web source evidence differs")


def _image_record(image_id, revision, os_name, arch, config):
    require(os_name == "linux" and arch == "amd64" and isinstance(config, dict) and not config.get("Volumes"),
            "A native Web image without image-declared storage is required")
    user = config.get("User")
    parts = user.split(":") if isinstance(user, str) else []
    require(1 <= len(parts) <= 2 and all(_matches(USER, part) for part in parts)
            and parts[0] != "root" and not re.fullmatch(r"0+", parts[0]), "A non-root Web runtime user is required")
    labels = config.get("Labels")
    require(isinstance(labels, dict) and labels.get(REVISION_LABEL) == revision
            and labels.get("org.opencontainers.image.title") == "Warpdrive Web", "Web OCI source or role differs")
    environment = build_environment(config.get("Env"))
    generation = "wd-" + revision
    require(environment.get("APP_COMMIT") == revision and environment.get("NEXT_DEPLOYMENT_ID") == generation,
            "Web build stamps differ from exact source")
    return {"imageId": image_id, "sourceRevision": revision, "runtimeUser": user, "generation": generation}


def _evidence(raw, baseline, revision):
    before, after, build, mixed = (inputs.decode(raw[name]) for name in (BASELINE_INPUTS, INPUT_RECEIPT, BUILD, MIXED))
    require(isinstance(build, dict) and set(build) == {"sourceDelta", "baselineManifestSha256",
            "baselineArchiveSha256", "baselineImages", "capacity", "candidateWebImageId",
            "sourceVerifiedAfterBuild", "availableDiskBytesAfterBuild"}
            and build["sourceVerifiedAfterBuild"] is True
            and type(build["availableDiskBytesAfterBuild"]) is int
            and build["availableDiskBytesAfterBuild"] >= 4 * 1024**3
            and build["baselineManifestSha256"] == baseline["manifestSha256"]
            and build["baselineArchiveSha256"] == baseline["archiveSha256"]
            and build["baselineImages"] == baseline["imageIds"], "Build evidence differs from the accepted baseline")
    capacity = build["capacity"]
    require(isinstance(capacity, dict) and set(capacity) == {"admitted", "availableBytes", "requiredBytes",
            "remainingBytes", "scope"} and capacity["admitted"] is True
            and all(type(capacity[key]) is int and capacity[key] >= 0
                    for key in ("availableBytes", "requiredBytes", "remainingBytes"))
            and capacity["availableBytes"] == capacity["requiredBytes"] + capacity["remainingBytes"]
            and capacity["requiredBytes"] > 0 and isinstance(capacity["scope"], str) and 0 < len(capacity["scope"]) <= 200,
            "Bounded build admission is required")
    _source_delta(build["sourceDelta"], before, after, baseline["revision"], revision)
    image_id = build["candidateWebImageId"]
    require(_matches(IMAGE_ID, image_id) and image_id not in baseline["imageIds"].values(),
            "Distinct immutable tested Web image required")
    image = {"imageId": image_id, "sourceRevision": revision, "generation": "wd-" + revision}
    assembly = {"baselineRevision": baseline["revision"], "baselineOrigin": baseline["origin"],
                "baselineImages": baseline["imageIds"], "bundleManifestSha256": baseline["manifestSha256"],
                "archiveSha256": baseline["archiveSha256"], "newWeb": image, "fixtureBuilds": 0}
    require(isinstance(mixed, dict) and type(mixed.get("schemaVersion")) is int and mixed["schemaVersion"] == 1
            and mixed.get("kind") == "warpdrive-native-mixed-web-smoke" and mixed.get("scope") == "owned-native-staging-fixture"
            and mixed.get("revision") == baseline["revision"] and mixed.get("success") is True
            and "failure" in mixed and mixed["failure"] is None and mixed.get("deploymentAuthorized") is False
            and mixed.get("browserContinuityQualified") is True and mixed.get("limitations") == LIMITATIONS
            and inputs.canonical(mixed.get("images")) == inputs.canonical(assembly),
            "Native mixed browser report differs from the tested Web assembly")
    checks = mixed.get("checks")
    require(isinstance(checks, list) and len(checks) == len(CHECKS)
            and all(isinstance(row, dict) and set(row) == {"name", "status", "detail"}
                    and row["name"] == name and row["status"] == "passed" and isinstance(row["detail"], dict)
                    for row, name in zip(checks, CHECKS)), "Complete native mixed-image check sequence required")
    require(inputs.canonical(checks[0]["detail"]) == inputs.canonical(assembly), "Native image readback differs")
    initial = checks[3]["detail"]
    require(browser_message(initial.get("initial"))["phase"] == "initial-ready"
            and initial.get("freshBoundBaselineSeed") is True and initial.get("forgedSession") is False,
            "Native baseline browser admission is incomplete")
    browser = checks[5]["detail"]
    require(browser_message(browser.get("preSwitch"))["phase"] == "pre-switch-ready"
            and browser_message(browser.get("complete"))["phase"] == "complete"
            and type(browser.get("matchingActivityRows")) is int and browser["matchingActivityRows"] == 1
            and browser.get("generatedLoopbackTls") is True, "Native persistent browser proof is incomplete")
    qualification_detail = checks[2]["detail"]
    qualification = qualification_detail.get("qualification")
    require(isinstance(qualification, dict) and qualification.get("assembly") == assembly
            and qualification_detail.get("qualificationSha256") == runtime_hash(qualification),
            "Native rollout qualification binding differs")
    protected = qualification.get("protectedRuntimes")
    require(isinstance(protected, dict) and set(protected) == {"postgres", "worker", "realtime", "caddy"}
            and all(isinstance(row, dict) for row in protected.values())
            and all(protected[name].get("imageId") == baseline["imageIds"][name] for name in ("worker", "realtime")),
            "Native retained backend runtime inventory differs")
    backend_hash = qualification.get("backendFingerprint")
    require(backend_hash == runtime_hash(protected), "Native protected runtime witness differs")
    previous, current = "wd-" + baseline["revision"], image["generation"]
    slots = qualification.get("slots")
    require(isinstance(slots, dict) and set(slots) == {previous, current}, "Two exact Web slots required")
    schema_hash = None
    for generation, expected in ((previous, baseline["imageIds"]["web"]), (current, image_id)):
        slot = slots[generation]
        require(isinstance(slot, dict) and isinstance(slot.get("runtime"), dict)
                and slot["runtime"].get("imageId") == expected
                and _matches(inputs.HASH, slot["runtime"].get("schemaSha256")), "Native Web slot identity differs")
        observed = slot["runtime"]["schemaSha256"]
        require(schema_hash in (None, observed), "Native mixed Web schemas differ")
        schema_hash = observed
    for index, generation, state, writes in ((4, current, "accepted", 1), (6, previous, "accepted", 1),
                                             (7, previous, "rolled-back", 2)):
        detail = checks[index]["detail"]
        receipt = detail.get("receipt")
        ingress = detail.get("ingress")
        require(type(detail.get("routeWrites")) is int and detail["routeWrites"] == writes
                and detail.get("repeatReadOnly") is True and isinstance(receipt, dict)
                and receipt.get("state") == state and receipt.get("acceptedGeneration") == generation
                and receipt.get("backendFingerprint") == backend_hash
                and isinstance(ingress, dict) and ingress.get("activeGeneration") == generation
                and ingress.get("backendFingerprint") == backend_hash and ingress.get("schemaSha256") == schema_hash,
                "Native forward, reversal or automatic rollback evidence differs")
        if index == 7:
            require(detail.get("candidateStopped") is True and ingress.get("verifiedAssetGenerations") == [previous],
                    "A stopped candidate must restore only the retained healthy generation")
    cleanup = mixed.get("cleanup")
    require(isinstance(cleanup, dict) and cleanup.get("success") is True and cleanup.get("errors") == []
            and cleanup.get("fixtureResourcesAbsent") is True, "Native mixed fixture cleanup is incomplete")
    return image, build["sourceDelta"]


class _PlainTarMember(tarfile.TarInfo):
    def _proc_member(self, archive):
        # Docker's fixed archive names need no sparse, PAX or GNU extended headers.
        require(self.type in {tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE}
                and 0 <= self.size <= MAX_ARCHIVE_BYTES, "Unsafe Web archive member")
        return super()._proc_member(archive)


def _archive_image(source, size, image_id, revision):
    with tarfile.open(fileobj=source, mode="r:", tarinfo=_PlainTarMember) as archive:
        files, names = {}, set()
        for member in archive:
            name = member.name.rstrip("/")
            require(len(names) < MAX_TAR_MEMBERS and name not in names
                    and 0 <= member.offset_data <= member.offset_data + member.size <= size,
                    "Duplicate, oversized or truncated Web archive member")
            names.add(name)
            if member.isdir():
                require(member.size == 0 and name in {"blobs", "blobs/sha256"},
                        "Unexpected Web archive directory")
                continue
            require(name in {"manifest.json", "index.json", "oci-layout"} or _matches(BLOB_PATH, name),
                    "Unexpected Web archive file")
            files[name] = member
        require(1024 <= size - archive.offset <= 65536, "Invalid Web archive terminator")
        source.seek(archive.offset)
        require(not any(source.read(65537)), "Unexpected data after the Web archive terminator")

        def raw(name):
            require(name in files and 0 < files[name].size <= MAX_METADATA_BYTES, "Bounded Web archive metadata required")
            with archive.extractfile(files[name]) as member:
                value = member.read(MAX_METADATA_BYTES + 1)
            require(len(value) == files[name].size, "Truncated Web archive metadata")
            return value

        manifest = inputs.decode(raw("manifest.json"))
        require(isinstance(manifest, list) and len(manifest) == 1 and isinstance(manifest[0], dict),
                "Web archive must describe exactly one image")
        entry = manifest[0]
        config_path = entry.get("Config")
        layers = entry.get("Layers")
        require(entry.get("RepoTags") in (None, []) and not entry.get("Parent")
                and config_path == "blobs/sha256/" + image_id[7:]
                and isinstance(layers, list) and 0 < len(layers) <= 128
                and all(_matches(BLOB_PATH, path) and path in files
                        and path != config_path and files[path].size > 0 for path in layers),
                "Web archive must contain one untagged image and its native layers")
        config_raw = raw(config_path)
        require("sha256:" + _sha(config_raw) == image_id, "Web archive config digest differs from the tested image")
        require(inputs.decode(raw("oci-layout")) == {"imageLayoutVersion": "1.0.0"}, "Invalid Web OCI layout")
        index = inputs.decode(raw("index.json"))
        require(isinstance(index, dict) and type(index.get("schemaVersion")) is int and index["schemaVersion"] == 2
                and isinstance(index.get("manifests"), list) and len(index["manifests"]) == 1,
                "Web OCI archive must expose exactly one native manifest")
        descriptor = index["manifests"][0]
        require(isinstance(descriptor, dict) and descriptor.get("mediaType") in IMAGE_MANIFEST_TYPES
                and _matches(IMAGE_ID, descriptor.get("digest")), "Native Web OCI manifest descriptor required")
        annotations = descriptor.get("annotations", {})
        require(isinstance(annotations, dict)
                and not ({"org.opencontainers.image.ref.name", "io.containerd.image.name"} & annotations.keys()),
                "Tagged Web OCI archives are not admitted")
        manifest_path = "blobs/sha256/" + descriptor["digest"][7:]
        document = raw(manifest_path)
        require(type(descriptor.get("size")) is int and descriptor["size"] == len(document)
                and "sha256:" + _sha(document) == descriptor["digest"], "Web OCI manifest digest differs")
        oci = inputs.decode(document)
        require(isinstance(oci, dict) and type(oci.get("schemaVersion")) is int and oci["schemaVersion"] == 2
                and oci.get("mediaType", descriptor["mediaType"]) == descriptor["mediaType"]
                and not ({"manifests", "subject"} & oci.keys())
                and isinstance(oci.get("config"), dict) and oci["config"].get("digest") == image_id
                and type(oci["config"].get("size")) is int and oci["config"]["size"] == len(config_raw),
                "Docker and OCI Web archive image identities differ")
        oci_layers = oci.get("layers")
        require(isinstance(oci_layers, list) and len(oci_layers) == len(layers),
                "Docker and OCI Web archive layers differ")
        for path, layer in zip(layers, oci_layers):
            require(isinstance(layer, dict) and _matches(IMAGE_ID, layer.get("digest"))
                    and isinstance(layer.get("mediaType"), str) and layer["mediaType"] in LAYER_TYPES
                    and path == "blobs/sha256/" + layer["digest"][7:]
                    and type(layer.get("size")) is int and layer["size"] == files[path].size,
                    "Docker and OCI Web archive layer descriptors differ")
        config = inputs.decode(config_raw)
        require(isinstance(config, dict) and isinstance(config.get("rootfs"), dict) and config["rootfs"].get("type") == "layers"
                and isinstance(config["rootfs"].get("diff_ids"), list)
                and len(config["rootfs"]["diff_ids"]) == len(layers)
                and all(_matches(IMAGE_ID, diff_id) for diff_id in config["rootfs"]["diff_ids"]),
                "Web image root filesystem does not match its layer count")
        for path, layer, diff_id in zip(layers, oci_layers, config["rootfs"]["diff_ids"]):
            if layer["mediaType"].endswith(".tar"):
                require(layer["digest"] == diff_id, "Uncompressed Web layer differs from its image config")
        for path in set(layers):
            with archive.extractfile(files[path]) as member:
                require(_stream_digest(member, files[path].size) == path.rsplit("/", 1)[1],
                        "Web layer bytes differ from their OCI digest")
        return _image_record(image_id, revision, config.get("os"), config.get("architecture"), config.get("config"))


def _archive(parent, image_id, revision, expected=None):
    with _opened(parent, ARCHIVE, MAX_ARCHIVE_BYTES) as (source, size):
        if expected is not None:
            require(expected["sizeBytes"] == size, "Web archive size differs")
        record = {"sha256": _stream_digest(source, size), "sizeBytes": size}
        require(expected is None or record == expected, "Web archive digest differs")
        source.seek(0)
        try:
            return record, _archive_image(source, size, image_id, revision)
        except (tarfile.TarError, EOFError, OSError) as error:
            raise CandidateError("Invalid Web image archive") from error


def verify_saved_web_image(directory: Path, *, expected_image_id: str, expected_revision: str) -> dict:
    """Read back one modern Docker save archive, including in a disposable fixture."""
    require(_matches(IMAGE_ID, expected_image_id) and _matches(REVISION, expected_revision),
            "Exact Web image and source pins required")
    with _directory(directory) as parent:
        record, image = _archive(parent, expected_image_id, expected_revision)
    return {"image": image, "archiveSha256": record["sha256"], "archiveSizeBytes": record["sizeBytes"]}


def _result(directory, manifest, manifest_sha, image, delta):
    files = manifest["files"]
    return {
        "candidate": {
            "schemaVersion": 1, "kind": "warpdrive-tested-web-candidate",
            "releaseRevision": manifest["revision"], "platform": PLATFORM,
            "image": image, "baseline": manifest["baseline"], "inputProvenance": delta,
            "qualification": {"state": "native-mixed-web-browser-passed",
                              "reportSha256": files[MIXED]["sha256"], "checks": list(CHECKS),
                              "limitations": list(LIMITATIONS)},
            "deploymentAuthorized": False,
        },
        "origin": manifest["origin"], "archivePath": directory / ARCHIVE,
        "provenance": {"archiveSha256": files[ARCHIVE]["sha256"], "archiveSizeBytes": files[ARCHIVE]["sizeBytes"],
                       "bundleManifestSha256": manifest_sha, "buildEvidenceSha256": files[BUILD]["sha256"],
                       "inputReceiptFileSha256": files[INPUT_RECEIPT]["sha256"]},
    }


def _pins(revision, baseline_revision, baseline_manifest_sha256):
    require(_matches(REVISION, revision) and _matches(REVISION, baseline_revision) and revision != baseline_revision
            and _matches(inputs.HASH, baseline_manifest_sha256), "Distinct exact source and accepted baseline pins required")


def create_web_bundle(root: Path, output_dir: Path, *, expected_revision: str, baseline_dir: Path,
                      baseline_revision: str, baseline_manifest_sha256: str, input_receipt_path: Path,
                      build_evidence_path: Path, mixed_report_path: Path, origin: dict, docker) -> dict:
    """Save only the exact tested Web ID. The caller supplies authenticated baseline custody."""
    _pins(expected_revision, baseline_revision, baseline_manifest_sha256)
    _main_origin(origin)
    require(root.is_absolute() and root == root.resolve() and output_dir.is_absolute()
            and output_dir.parent == output_dir.parent.resolve() and not output_dir.is_relative_to(root)
            and not output_dir.is_relative_to(baseline_dir.resolve()), "Private Web output must sit outside source and baseline")
    loaded = load_bundle(baseline_dir, expected_revision=baseline_revision)
    require(loaded["candidate"]["schemaVersion"] == 2
            and loaded["provenance"]["bundleManifestSha256"] == baseline_manifest_sha256,
            "Accepted exact full v2 baseline required")
    baseline = _baseline({
        "revision": baseline_revision, "manifestSha256": baseline_manifest_sha256,
        "archiveSha256": loaded["provenance"]["archiveSha256"], "origin": loaded["origin"],
        "imageIds": {name: row["imageId"] for name, row in loaded["candidate"]["components"].items()},
    }, baseline_revision, baseline_manifest_sha256, origin["repository"])
    require(baseline["origin"]["runId"] != origin["runId"], "Baseline and release require distinct main workflow runs")
    raw = {INPUT_RECEIPT: _input_file(input_receipt_path), BASELINE_INPUTS: _input_file(baseline_dir / INPUT_RECEIPT),
           BUILD: _input_file(build_evidence_path), MIXED: _input_file(mixed_report_path)}
    image, delta = _evidence(raw, baseline, expected_revision)
    historical, current = (inputs.decode(raw[name]) for name in (BASELINE_INPUTS, INPUT_RECEIPT))
    require(delta["baselineCoreInputReceiptSha256"] == loaded["candidate"]["inputProvenance"]["receiptSha256"],
            "Accepted baseline input receipt differs")
    verified = verify_web_source_delta(root, current, expected_revision=expected_revision,
                                       baseline_revision=baseline_revision, baseline_receipt=historical)
    require(inputs.canonical(verified) == inputs.canonical(delta), "Verified source differs from the Web build evidence")
    image_id = image["imageId"]
    require(inputs.canonical(read_web_image(docker, image_id, expected_revision)) == inputs.canonical(image),
            "Native Web readback differs from the tested assembly")
    output_dir.mkdir(mode=0o700, exist_ok=False)
    docker.run(["image", "save", "--platform", PLATFORM, "--output", str(output_dir / ARCHIVE), image_id], timeout=600)
    with _directory(output_dir) as parent:
        require(os.listdir(parent) == [ARCHIVE], "Docker save emitted an unexpected Web bundle member")
        archive, saved = _archive(parent, image_id, expected_revision)
    final = image_metadata(docker.json(["image", "inspect", image_id], timeout=10), expected_revision)
    require(final["id"] == saved["imageId"] and final["user"] == saved["runtimeUser"],
            "Saved Web image readback differs")
    inputs.verify_source_revision(root, current, expected_revision)
    for name, value in raw.items():
        _write(output_dir, name, value)
    manifest = {"schemaVersion": 1, "kind": "warpdrive-tested-web-bundle", "revision": expected_revision,
                "platform": PLATFORM, "origin": origin, "baseline": baseline, "deploymentAuthorized": False,
                "files": {**{name: _record(value) for name, value in raw.items()}, ARCHIVE: archive}}
    encoded = inputs.canonical(manifest) + b"\n"
    _write(output_dir, MANIFEST, encoded)
    descriptor = os.open(output_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return _result(output_dir, manifest, _sha(encoded), saved, delta)


def load_web_bundle(directory: Path, *, expected_revision: str, expected_manifest_sha256: str,
                    baseline_revision: str, baseline_manifest_sha256: str, expected_origin: dict) -> dict:
    """Verify privately held bytes against independently authenticated artifact pins."""
    _pins(expected_revision, baseline_revision, baseline_manifest_sha256)
    require(_matches(inputs.HASH, expected_manifest_sha256), "An authenticated Web manifest digest is required")
    _main_origin(expected_origin)
    with _directory(directory) as parent:
        require(set(os.listdir(parent)) == {MANIFEST, ARCHIVE, *METADATA}, "Unexpected or missing Web bundle member")
        raw_manifest = _metadata(parent, MANIFEST)
        require(_sha(raw_manifest) == expected_manifest_sha256, "Web bundle manifest differs from its external pin")
        manifest = inputs.decode(raw_manifest)
        require(isinstance(manifest, dict) and set(manifest) == {"schemaVersion", "kind", "revision", "platform",
                "origin", "baseline", "deploymentAuthorized", "files"} and type(manifest["schemaVersion"]) is int
                and manifest["schemaVersion"] == 1 and manifest["kind"] == "warpdrive-tested-web-bundle"
                and manifest["revision"] == expected_revision and manifest["platform"] == PLATFORM
                and manifest["deploymentAuthorized"] is False
                and inputs.canonical(_main_origin(manifest["origin"])) == inputs.canonical(expected_origin),
                "Web bundle source, origin or authority differs")
        baseline = _baseline(manifest["baseline"], baseline_revision, baseline_manifest_sha256, expected_origin["repository"])
        require(baseline["origin"]["runId"] != expected_origin["runId"], "Baseline and release require distinct main workflow runs")
        files = manifest["files"]
        require(isinstance(files, dict) and set(files) == {ARCHIVE, *METADATA}, "Exact Web bundle inventory required")
        for name, row in files.items():
            limit = MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA_BYTES
            require(isinstance(row, dict) and set(row) == {"sha256", "sizeBytes"}
                    and _matches(inputs.HASH, row["sha256"]) and type(row["sizeBytes"]) is int
                    and 0 < row["sizeBytes"] <= limit, "Invalid Web bundle file digest or size")
        raw = {name: _metadata(parent, name) for name in METADATA}
        require(all(_record(value) == files[name] for name, value in raw.items()), "Web bundle metadata changed")
        image, delta = _evidence(raw, baseline, expected_revision)
        _, saved = _archive(parent, image["imageId"], expected_revision, expected=files[ARCHIVE])
        return _result(directory, manifest, expected_manifest_sha256, saved, delta)
