"""Retain tested optional images separately from the canonical four-image bundle.

Origin is the linked baseline's producer snapshot, not independent API admission.
Promotion must authenticate the enclosing artifact and producer separately. This
offline pack/verify tool never builds, loads, pushes or authorizes deployment.
"""

from contextlib import contextmanager, ExitStack
from hashlib import sha256
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile

from bundle import load_bundle, validate_origin
from candidate import COMPONENTS, CandidateError, IMAGE_ID, REVISION, admit_capacity, require
from component_inputs import InputError, decode
from image_smoke import Docker, image_metadata
import native_image_identity as native_identity
from web_candidate import (
    IMAGE_MANIFEST_TYPES, MAX_ARCHIVE_BYTES, MAX_TAR_MEMBERS,
    _PlainTarMember, _directory, _opened, _stream_digest,
)


MANIFEST = "optional-bundle.json"
ARCHIVE = "optional-images.tar"
MAX_METADATA = 512 * 1024
HASH = re.compile(r"[a-f0-9]{64}\Z")
ROLES = {
    "core-api": {"field": "coreImage", "kind": "warpdrive-optional-core-final-image-smoke",
                 "command": ["bun", "--no-env-file", "dist/core-api.mjs"], "ports": {"3010/tcp": {}},
                 "checks": ("final-image-identities", "disposable-isolation", "canonical-fresh-and-repeat-migration",
                            "accepted-web-fixture", "optional-core-http-and-drain")},
    "operations-collector": {"field": "collectorImage", "kind": "warpdrive-optional-operations-collector-final-image-smoke",
                 "command": ["bun", "--no-env-file", "dist/operations-collector.mjs", "/run/warpdrive-operations-config.json"],
                 "ports": {}, "checks": ("exact-final-image-identities", "disposable-isolation", "canonical-fresh-and-repeat-migration",
                                        "restricted-collector-enrollment", "private-signed-collector-restart-and-drain")},
}


def _json(raw):
    return json.dumps(raw, sort_keys=True, separators=(",", ":"), allow_nan=False).encode() + b"\n"


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _read(parent, name, maximum=MAX_METADATA):
    with _opened(parent, name, maximum) as (source, size):
        raw = source.read(maximum + 1)
        require(len(raw) == size, "Optional metadata changed during readback")
        return raw


def _input(path):
    require(path.is_absolute() and path.parent == path.parent.resolve(strict=True), "Canonical report path required")
    with _directory(path.parent) as parent:
        return _read(parent, path.name)


def _write(parent, name, raw):
    require("/" not in name and name not in {"", ".", ".."}, "Fixed flat optional bundle filename required")
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
    with os.fdopen(descriptor, "wb") as output:
        require(output.write(raw) == len(raw), "Optional bundle write was incomplete")
        output.flush()
        os.fsync(output.fileno())


@contextmanager
def _writer(directory):
    """Anchor owned output identity while permitting intended directory writes."""
    require(directory.is_absolute() and directory == directory.resolve(strict=True), "Canonical optional output directory required")
    with ExitStack() as opened:
        descriptor = os.open(directory.anchor, os.O_RDONLY | os.O_DIRECTORY)
        opened.callback(os.close, descriptor)
        for part in directory.parts[1:]:
            descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            opened.callback(os.close, descriptor)

        def identity(info):
            return info.st_dev, info.st_ino, info.st_uid, info.st_mode

        before = os.fstat(descriptor)
        require(stat.S_ISDIR(before.st_mode) and before.st_uid == os.geteuid() and stat.S_IMODE(before.st_mode) == 0o700,
                "Private owned optional output directory required")
        yield descriptor
        require(identity(before) == identity(os.fstat(descriptor)) == identity(directory.lstat()),
                "Optional output directory ownership changed")


def _baseline(directory, revision, manifest_pin, expected_origin):
    require(_matches(REVISION, revision) and _matches(HASH, manifest_pin), "Exact baseline source and independent manifest pin required")
    with _directory(directory) as parent:
        manifest_raw = _read(parent, "bundle.json", 4 * 1024**2)
    require(sha256(manifest_raw).hexdigest() == manifest_pin, "Baseline bundle differs from its independent manifest pin")
    loaded = load_bundle(directory, expected_revision=revision)
    require(loaded["provenance"]["bundleManifestSha256"] == manifest_pin, "Baseline changed during verification")
    validate_origin(loaded["origin"])
    validate_origin(expected_origin)
    require(loaded["origin"] == expected_origin, "Baseline producer differs from independently supplied origin snapshot")
    linkage = {"revision": revision, **loaded["provenance"],
               "components": {role: value["imageId"] for role, value in loaded["candidate"]["components"].items()}}
    return loaded, linkage


def _projection(value):
    require(type(value) is dict and _matches(IMAGE_ID, value.get("id")) and _matches(REVISION, value.get("revision"))
            and isinstance(value.get("user"), str), "Exact optional report image identity required")
    return {key: value[key] for key in ("id", "revision", "user")}


def _image(role, rows, revision):
    identity = image_metadata(rows, revision)
    specification = ROLES[role]
    row, = rows
    config = row.get("Config") or {}
    require(row.get("Os") == "linux" and row.get("Architecture") == "amd64"
            and config.get("Cmd") == specification["command"]
            and (config.get("ExposedPorts") or {}) == specification["ports"] and not config.get("Volumes"),
            "Optional image native role, command or exposure profile differs")
    require(role != "operations-collector" or identity["user"] == "1000:1000", "Collector runtime user differs")
    return _projection(identity)


def _report(role, report, rows, revision, baseline):
    specification = ROLES[role]
    require(type(report) is dict and report.get("kind") == specification["kind"] and report.get("expectedRevision") == revision
            and report.get("success") is True and report.get("failure") is None
            and (report.get("cleanup") or {}).get("success") is True and not report["cleanup"].get("errors"),
            "Successful optional final-image report with completed cleanup required")
    checks = report.get("checks")
    require(type(checks) is list and tuple(item.get("name") for item in checks if type(item) is dict) == specification["checks"]
            and all(type(item) is dict and item.get("status") == "passed" for item in checks), "All exact optional runtime checks must pass")
    evidence = report.get("images")
    require(type(evidence) is dict and set(evidence) == set(COMPONENTS), "Optional runtime report must identify the exact retained four-image fixture")
    for component, value in baseline["candidate"]["components"].items():
        require(_projection(evidence[component]) == {"id": value["imageId"], "revision": value.get("sourceRevision", revision), "user": value["runtimeUser"]},
                "Optional runtime evidence uses a different baseline image")
    identity = _image(role, rows, revision)
    require(_projection(report.get(specification["field"])) == identity
            and identity["id"] not in {row["imageId"] for row in baseline["candidate"]["components"].values()},
            "Optional image differs from successful runtime evidence or duplicates a baseline role")
    return {"imageId": identity["id"], "sourceRevision": identity["revision"], "runtimeUser": identity["user"], "platform": "linux/amd64"}


def _archive_images(source, size, components, revision):
    """Verify the pinned save stream using the explicit classic-Docker closure.

    The enclosing opened-file scope has already checked its external SHA and byte
    count. Keep that same descriptor pinned through policy and shared graph reads.
    Tags remain forbidden custody metadata; they never select an image identity.
    """
    try:
        documents = {}
        config_paths = {"blobs/sha256/" + value["imageId"][7:] for value in components.values()}
        with tarfile.open(fileobj=source, mode="r:", tarinfo=_PlainTarMember) as archive:
            for index, member in enumerate(archive):
                require(index < MAX_TAR_MEMBERS, "Optional archive inventory exceeds its bound")
                if member.name in config_paths:
                    require(member.isfile() and 0 < member.size <= MAX_METADATA, "Bounded optional config required")
                if member.name in {"manifest.json", "index.json"}:
                    require(member.isfile() and 0 < member.size <= MAX_METADATA and member.name not in documents,
                            "Bounded unique optional archive metadata required")
                    with archive.extractfile(member) as stream:
                        raw = stream.read(MAX_METADATA + 1)
                    require(len(raw) == member.size, "Truncated optional archive metadata")
                    documents[member.name] = decode(raw)
        manifest, index = documents.get("manifest.json"), documents.get("index.json")
        require(type(manifest) is list and len(manifest) == len(components)
                and all(type(entry) is dict and entry.get("RepoTags") in (None, []) and not entry.get("Parent") for entry in manifest),
                "Exactly untagged optional Docker inventory required")
        require(type(index) is dict and type(index.get("manifests")) is list
                and 0 < len(index["manifests"]) <= len(components), "Truthful optional OCI root inventory required")
        for descriptor in index["manifests"]:
            require(type(descriptor) is dict and descriptor.get("mediaType") in IMAGE_MANIFEST_TYPES,
                    "Native optional OCI manifest required")
            annotations = descriptor.get("annotations", {})
            require(type(annotations) is dict and not {"org.opencontainers.image.ref.name", "io.containerd.image.name"} & annotations.keys(),
                    "Tagged optional archives are not admitted")
        expected = {role: {"configDigest": value["imageId"], "sourceRevision": revision,
                    "metadata": {"User": value["runtimeUser"], "Cmd": ROLES[role]["command"],
                                 "ExposedPorts": ROLES[role]["ports"], "Volumes": {}}} for role, value in components.items()}
        source.seek(0)
        # The common verifier derives every unindexed platform manifest and v1
        # metadata prefix from these independent config and RootFS pins. It never
        # treats an index subset, a tag or an arbitrary extra blob as authority.
        native_identity._graph(source, size, native_identity._expectations(expected), "docker-save-compatibility")
    except (tarfile.TarError, EOFError, OSError, InputError, native_identity.IdentityError) as error:
        raise CandidateError("Invalid optional image archive") from error


def verify_bundle(directory, *, expected_revision, expected_manifest_sha256, baseline_dir, baseline_manifest_sha256, expected_origin):
    require(_matches(HASH, expected_manifest_sha256), "Independent optional manifest pin required")
    baseline, linkage = _baseline(baseline_dir, expected_revision, baseline_manifest_sha256, expected_origin)
    with _directory(directory) as parent:
        manifest_raw = _read(parent, MANIFEST)
        require(sha256(manifest_raw).hexdigest() == expected_manifest_sha256, "Optional bundle differs from independent manifest pin")
        manifest = decode(manifest_raw)
        require(type(manifest) is dict and set(manifest) == {"schemaVersion", "kind", "revision", "platform", "origin", "originVerification",
                "baseline", "components", "files", "deploymentAuthorized"} and type(manifest["schemaVersion"]) is int
                and manifest["schemaVersion"] == 1 and manifest["kind"] == "warpdrive-tested-optional-image-bundle"
                and manifest["revision"] == expected_revision and manifest["platform"] == "linux/amd64"
                and manifest["deploymentAuthorized"] is False and manifest["originVerification"] == "baseline-producer-snapshot-only"
                and manifest["origin"] == baseline["origin"] and manifest["baseline"] == linkage,
                "Optional manifest source, baseline, producer snapshot or authority differs")
        components = manifest["components"]
        require(type(components) is dict and 0 < len(components) <= 2 and set(components) <= set(ROLES), "Exact selected optional roles required")
        require(all(type(value) is dict and set(value) == {"imageId", "sourceRevision", "runtimeUser", "platform"}
                    and _matches(IMAGE_ID, value["imageId"]) and value["sourceRevision"] == expected_revision
                    and isinstance(value["runtimeUser"], str) and value["platform"] == "linux/amd64" for value in components.values()),
                "Exact optional source/platform identity records required")
        inventory = {ARCHIVE, *(role + suffix for role in components for suffix in ("-report.json", "-inspection.json"))}
        require(type(manifest["files"]) is dict and set(manifest["files"]) == inventory
                and set(os.listdir(parent)) == inventory | {MANIFEST}, "Optional bundle file inventory differs")
        raw_files = {}
        for name in inventory:
            record = manifest["files"][name]
            require(type(record) is dict and set(record) == {"sha256", "sizeBytes"} and _matches(HASH, record["sha256"])
                    and type(record["sizeBytes"]) is int and record["sizeBytes"] > 0, "Exact optional file hash and byte count required")
            with _opened(parent, name, MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA) as (source, size):
                require(size == record["sizeBytes"] and _stream_digest(source, size) == record["sha256"], "Optional file bytes differ from manifest")
                source.seek(0)
                if name == ARCHIVE:
                    _archive_images(source, size, components, expected_revision)
                else:
                    raw_files[name] = source.read(MAX_METADATA + 1)
        reconstructed = {role: _report(role, decode(raw_files[role + "-report.json"]), decode(raw_files[role + "-inspection.json"]),
                                        expected_revision, baseline) for role in components}
        require(reconstructed == components and len({row["imageId"] for row in components.values()}) == len(components),
                "Optional manifest differs from reconstructed runtime evidence")
    return {"manifest": manifest, "manifestSha256": expected_manifest_sha256, "archivePath": directory / ARCHIVE,
            "deploymentAuthorized": False, "independentProducerApiAdmissionRequired": True}


def create_bundle(output_dir, *, expected_revision, baseline_dir, baseline_manifest_sha256, expected_origin, reports, docker):
    baseline, linkage = _baseline(baseline_dir, expected_revision, baseline_manifest_sha256, expected_origin)
    require(type(reports) is dict and 0 < len(reports) <= 2 and set(reports) <= set(ROLES), "At least one exact optional report role required")
    raw_files, components, sizes = {}, {}, []
    for role, path in sorted(reports.items()):
        raw = _input(path)
        report = decode(raw)
        identity = _projection(report.get(ROLES[role]["field"]))
        rows = docker.json(["image", "inspect", identity["id"]], timeout=15)
        components[role] = _report(role, report, rows, expected_revision, baseline)
        size = rows[0].get("Size")
        require(type(size) is int and size > 0, "Actual optional image storage size required")
        sizes.append(size)
        raw_files[role + "-report.json"] = raw
        raw_files[role + "-inspection.json"] = _json(rows)
        require(len(raw_files[role + "-inspection.json"]) <= MAX_METADATA, "Optional inspection exceeds its metadata bound")
    require(len({value["imageId"] for value in components.values()}) == len(components), "Distinct optional image IDs required")
    require(output_dir.is_absolute() and output_dir.parent == output_dir.parent.resolve(strict=True)
            and not os.path.lexists(output_dir), "Fresh canonical optional output directory required")
    require(sum(sizes) + 32 * 1024**2 <= MAX_ARCHIVE_BYTES, "Optional archive exceeds its fixed storage bound")
    admit_capacity(available=shutil.disk_usage(output_dir.parent).free, candidate=sum(sizes) + 32 * 1024**2,
                   migration=0, temporary=sum(len(raw) for raw in raw_files.values()), reserve=1024**3)
    output_dir.mkdir(mode=0o700)
    with _writer(output_dir) as parent:
        for name, raw in raw_files.items():
            _write(parent, name, raw)
        _write(parent, ARCHIVE, b"")
        before = os.stat(ARCHIVE, dir_fd=parent, follow_symlinks=False)
        identifiers = [components[role]["imageId"] for role in sorted(components)]
        docker.run(["image", "save", "--output", str(output_dir / ARCHIVE), *identifiers], timeout=300)
        after = os.stat(ARCHIVE, dir_fd=parent, follow_symlinks=False)
        require(stat.S_ISREG(after.st_mode) and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
                and after.st_uid == os.geteuid() and after.st_nlink == 1 and stat.S_IMODE(after.st_mode) == 0o600,
                "Docker save replaced the private owned optional archive")
        files = {}
        for name in (*raw_files, ARCHIVE):
            with _opened(parent, name, MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_METADATA) as (source, size):
                files[name] = {"sha256": _stream_digest(source, size), "sizeBytes": size}
        require(shutil.disk_usage(output_dir).free >= 1024**3, "Optional archive consumed the operating reserve")
        manifest = {"schemaVersion": 1, "kind": "warpdrive-tested-optional-image-bundle", "revision": expected_revision,
                    "platform": "linux/amd64", "origin": baseline["origin"], "originVerification": "baseline-producer-snapshot-only",
                    "baseline": linkage, "components": components, "files": files, "deploymentAuthorized": False}
        manifest_raw = _json(manifest)
        _write(parent, MANIFEST, manifest_raw)
        os.fsync(parent)
    return verify_bundle(output_dir, expected_revision=expected_revision, expected_manifest_sha256=sha256(manifest_raw).hexdigest(),
                         baseline_dir=baseline_dir, baseline_manifest_sha256=baseline_manifest_sha256, expected_origin=expected_origin)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack")
    pack.add_argument("--output-dir", required=True, type=Path)
    pack.add_argument("--core-report", type=Path)
    pack.add_argument("--collector-report", type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("--bundle-dir", required=True, type=Path)
    verify.add_argument("--optional-manifest-sha256", required=True)
    for command in (pack, verify):
        command.add_argument("--expected-revision", required=True)
        command.add_argument("--baseline-dir", required=True, type=Path)
        command.add_argument("--baseline-manifest-sha256", required=True)
        command.add_argument("--producer-origin-file", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        arguments = {"expected_revision": args.expected_revision, "baseline_dir": args.baseline_dir,
                     "baseline_manifest_sha256": args.baseline_manifest_sha256,
                     "expected_origin": decode(_input(args.producer_origin_file))}
        if args.command == "pack":
            reports = {role: path for role, path in (("core-api", args.core_report), ("operations-collector", args.collector_report)) if path is not None}
            result = create_bundle(args.output_dir, reports=reports, docker=Docker(), **arguments)
        else:
            result = verify_bundle(args.bundle_dir, expected_manifest_sha256=args.optional_manifest_sha256, **arguments)
        print(json.dumps({"manifestSha256": result["manifestSha256"], "components": result["manifest"]["components"],
                          "deploymentAuthorized": False, "independentProducerApiAdmissionRequired": True}, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"state": "held", "errorType": type(error).__name__, "deploymentAuthorized": False}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
