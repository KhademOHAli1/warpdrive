"""Import one authenticated tested Web archive on the installed containerd daemon."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import shutil
import stat
import subprocess
import sys
import tarfile
import time

import component_inputs as inputs
import web_candidate as candidate
from web_switch import canonical, content_hash


JOURNAL = "installed-web-image-load.json"
MAX_READ = 2 * 1024**2
DISK_RESERVE = 4 * 1024**3
DOCKER_SOCKET = Path("/run/docker.sock")
SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
DANGLING = [["<none>", "<none>", "<none>"]]
UNTAGGED = (DANGLING, [["<none>", "<none>", ""]])


class WebImageError(ValueError):
    """The requested local image transport is outside its admitted scope."""


class WebImageUnknown(WebImageError):
    """A load may have taken effect. Only reconciliation may follow."""


def require(condition, reason):
    if not condition:
        raise WebImageError(reason)


def _daemon_pin(value):
    require(isinstance(value, dict) and set(value) == {"serverId", "socketDevice", "socketInode"}
            and isinstance(value["serverId"], str) and re.fullmatch(r"[a-zA-Z0-9:_-]{1,128}", value["serverId"])
            and type(value["socketDevice"]) is int and value["socketDevice"] >= 0
            and type(value["socketInode"]) is int and value["socketInode"] > 0,
            "Independent exact daemon and socket identity pins required")


class LocalDocker:
    """Fixed local Linux socket and bounded read/one-load command set."""

    def __init__(self, *, containerd_root):
        require(sys.platform == "linux" and os.geteuid() == 0, "Native Linux root Docker access required")
        self.socket = self._socket_identity()
        self.containerd_root = Path(containerd_root)
        self.storage = self._storage_identity(self.containerd_root)
        self.binary = shutil.which("docker", path=SYSTEM_PATH)
        require(self.binary and Path(self.binary).is_absolute(), "System Docker client required")

    @staticmethod
    def _socket_identity():
        require(DOCKER_SOCKET.resolve(strict=True) == DOCKER_SOCKET, "Canonical local Docker socket required")
        directory = DOCKER_SOCKET.parent.lstat()
        info = DOCKER_SOCKET.lstat()
        require(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0 and not stat.S_IMODE(directory.st_mode) & 0o022
                and stat.S_ISSOCK(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and not stat.S_IMODE(info.st_mode) & 0o007, "Protected system Docker socket required")
        return (info.st_dev, info.st_ino)

    def _command(self, *args):
        require(self._socket_identity() == self.socket, "Docker socket identity changed")
        return [self.binary, "--host", "unix://" + str(DOCKER_SOCKET), *args]

    @staticmethod
    def _storage_identity(path):
        require(path.is_absolute() and path.resolve(strict=True) == path, "Canonical daemon storage path required")
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not stat.S_IMODE(info.st_mode) & 0o022,
                "Protected daemon storage directory required")
        return (info.st_dev, info.st_ino)

    def _read(self, *args):
        deadline = time.monotonic() + 12
        raw = bytearray()
        with subprocess.Popen(self._command(*args), env={"PATH": SYSTEM_PATH}, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    while True:
                        remaining = deadline - time.monotonic()
                        require(remaining > 0 and selector.select(remaining), "Docker read exceeded its deadline")
                        chunk = os.read(child.stdout.fileno(), min(65536, MAX_READ + 1 - len(raw)))
                        if not chunk:
                            break
                        raw.extend(chunk)
                        require(len(raw) <= MAX_READ, "Docker read exceeded its output bound")
                require(child.wait(timeout=max(0, deadline - time.monotonic())) == 0, "Docker read failed")
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=3)
        return bytes(raw)

    def _info(self):
        fields = ("ID", "OSType", "Architecture", "DockerRootDir", "DriverStatus")
        template = "\n".join("{{json ." + field + "}}" for field in fields)
        server, system, arch, root, driver = map(inputs.decode, self._read("info", "--format", template).splitlines())
        require(system == "linux" and arch in {"x86_64", "amd64"}
                and isinstance(driver, list) and ["driver-type", "io.containerd.snapshotter.v1"] in driver
                and isinstance(root, str) and Path(root).is_absolute(), "Native Linux/amd64 containerd image store required")
        require(self._socket_identity() == self.socket, "Docker socket changed during observation")
        identity = {"serverId": server, "socketDevice": self.socket[0], "socketInode": self.socket[1]}
        _daemon_pin(identity)
        return identity, root

    def identity(self):
        return self._info()[0]

    def admit_capacity(self, expected_daemon, size):
        identity, root = self._info()
        root = Path(root)
        self._storage_identity(root)
        require(identity == expected_daemon and self._storage_identity(self.containerd_root) == self.storage
                and all(shutil.disk_usage(path).free >= DISK_RESERVE + 2 * size for path in (root, self.containerd_root)),
                "Docker identity or image-load disk reserve is unavailable")

    def inventory(self):
        raw = self._read("image", "ls", "--all", "--digests", "--no-trunc", "--format", "{{json .}}")
        rows = {}
        for line in raw.splitlines():
            row = inputs.decode(line)
            # Some unrelated local images have no named registry digest in
            # Docker 29. Preserve that distinction in the inventory witness.
            values = tuple(row[key] for key in ("Repository", "Tag", "Digest"))
            require(candidate.IMAGE_ID.fullmatch(row["ID"]) and all(isinstance(value, str) and 0 < len(value) <= 512
                    for value in values[:2]) and isinstance(values[2], str) and len(values[2]) <= 512,
                    "Invalid local Docker inventory row")
            rows.setdefault(row["ID"], set()).add(values)
        return {digest: [list(item) for item in sorted(values)] for digest, values in rows.items()}

    def inspect(self, digest):
        return inputs.decode(self._read("image", "inspect", digest))

    def load(self, source):
        result = subprocess.run(self._command("image", "load", "--platform", candidate.PLATFORM, "--quiet"),
                                env={"PATH": SYSTEM_PATH}, stdin=source, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=300, check=False)
        require(result.returncode == 0, "Docker image load acknowledgement unavailable")


def _archive_facts(source, size, expected, image):
    require(size == expected["archiveSizeBytes"] and candidate._stream_digest(source, size) == expected["archiveSha256"],
            "Held Web archive differs from admitted bytes")
    source.seek(0)
    config_id = image["imageId"]
    require(candidate._archive_image(source, size, config_id, image["sourceRevision"]) == image,
            "Held Web archive differs from the tested config")
    source.seek(0)
    with tarfile.open(fileobj=source, mode="r:", tarinfo=candidate._PlainTarMember) as archive:
        def metadata(name):
            item = archive.getmember(name)
            require(item.isfile() and 0 < item.size <= candidate.MAX_METADATA_BYTES, "Bounded OCI metadata required")
            with archive.extractfile(item) as stream:
                raw = stream.read(candidate.MAX_METADATA_BYTES + 1)
            require(len(raw) == item.size, "Truncated OCI metadata")
            return inputs.decode(raw)

        index = metadata("index.json")
        descriptor, = index["manifests"]
        require(set(index) <= {"schemaVersion", "mediaType", "manifests"}
                and index.get("mediaType", "application/vnd.oci.image.index.v1+json") == "application/vnd.oci.image.index.v1+json"
                and set(descriptor) <= {"digest", "size", "mediaType", "platform"}
                and descriptor.get("platform") in (None, {"os": "linux", "architecture": "amd64"}),
                "One direct unannotated native OCI descriptor required")
        manifest = metadata("blobs/sha256/" + descriptor["digest"][7:])
        config = metadata("blobs/sha256/" + config_id[7:])
        require(not ({"artifactType", "subject"} & manifest.keys())
                and all(not ({"urls", "data"} & item.keys()) for item in (manifest["config"], *manifest["layers"])),
                "Self-contained OCI descriptors required")
        return {"descriptor": descriptor, "config": config}


def _inspect(docker, facts):
    descriptor = facts["descriptor"]
    rows = docker.inspect(descriptor["digest"])
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "One exact native Web image required")
    row = rows[0]
    native, expected = row["Config"], facts["config"]
    require(row["Id"] == descriptor["digest"] and all(row["Descriptor"][key] == descriptor[key]
                    for key in ("digest", "mediaType", "size"))
            and row["Os"] == expected["os"] == "linux" and row["Architecture"] == expected["architecture"] == "amd64"
            and row.get("RepoTags") in (None, []) and row.get("RepoDigests") in (None, [])
            and row["RootFS"]["Type"] == expected["rootfs"]["type"]
            and row["RootFS"]["Layers"] == expected["rootfs"]["diff_ids"]
            and all(native.get(key) == expected["config"].get(key) for key in
                    ("User", "Env", "Labels", "Cmd", "Entrypoint", "WorkingDir", "ExposedPorts", "StopSignal", "Healthcheck"))
            and not native.get("Volumes"), "Local native Web runtime metadata differs from the tested image")


@contextmanager
def _state_directory(path):
    require(path.is_absolute() and path == path.resolve(strict=True), "Canonical load state directory required")
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700
                and os.path.samestat(info, path.lstat()), "Owned mode0700 image-load state required")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield descriptor
        current = path.lstat()
        require(os.path.samestat(info, current) and current.st_uid == info.st_uid and current.st_mode == info.st_mode,
                "Protected image-load state directory changed")
    finally:
        os.close(descriptor)


def _journal_read(fd, binding):
    with candidate._opened(fd, JOURNAL, MAX_READ) as (source, size):
        info = os.fstat(source.fileno())
        require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o600, "Private image-load journal required")
        raw = source.read(size + 1)
    value = inputs.decode(raw)
    require(len(raw) == size and isinstance(value, dict) and set(value) == {"payload", "sha256"}
            and content_hash(value["payload"]) == value["sha256"], "Image-load journal checksum differs")
    journal = value["payload"]
    require(set(journal) == {"binding", "state", "before"} and journal["binding"] == binding
            and journal["state"] in {"intent", "verified"} and isinstance(journal["before"], dict),
            "Image-load journal binding or state differs")
    return journal


def _journal_write(fd, journal, *, create=False):
    raw = canonical({"payload": journal, "sha256": content_hash(journal)}) + b"\n"
    require(len(raw) <= MAX_READ, "Image-load journal exceeds its byte bound")
    temporary = ".installed-web-load-" + secrets.token_hex(12)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    with os.fdopen(os.open(temporary, flags, 0o600, dir_fd=fd), "wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    try:
        if create:
            os.link(temporary, JOURNAL, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        else:
            os.replace(temporary, JOURNAL, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=fd)
        except FileNotFoundError:
            pass
        os.fsync(fd)


def _install(docker, fd, source, size, facts, binding, reconcile):
    identity, digest = binding["daemon"], binding["manifestDigest"]
    require(docker.identity() == identity, "Local Docker daemon differs from the pin")
    inventory = docker.inventory()
    require(isinstance(inventory, dict) and len(inventory) <= 5000, "Bounded Docker inventory required")
    if JOURNAL in os.listdir(fd):
        journal = _journal_read(fd, binding)
        if journal["state"] != "verified" and not reconcile:
            raise WebImageUnknown("Prior load intent requires read-only reconciliation")
    else:
        require(not reconcile, "No retained Web image-load attempt to reconcile")
        journal = {"binding": binding, "state": "intent", "before": inventory}
        if digest not in inventory:
            docker.admit_capacity(identity, size)
            require(docker.identity() == identity and docker.inventory() == inventory, "Docker changed before image load")
            _journal_write(fd, journal, create=True)
            try:
                source.seek(0)
                docker.load(source)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                raise WebImageUnknown("Web image-load outcome unresolved; reconcile without replay") from None
        else:
            require(inventory[digest] in UNTAGGED, "Existing native image has tags or conflicting inventory")
            _inspect(docker, facts)
            require(docker.identity() == identity and docker.inventory() == inventory, "Docker changed before image adoption")
            journal["state"] = "verified"
            _journal_write(fd, journal, create=True)

    try:
        observed = docker.inventory()
        candidate_rows = observed.get(digest)
        require(candidate_rows in UNTAGGED
                and observed == (journal["before"] | {digest: candidate_rows}),
                "Native Web image or unrelated Docker inventory differs")
        _inspect(docker, facts)
        require(docker.identity() == identity and docker.inventory() == observed, "Docker changed during image readback")
        if not reconcile and journal["state"] == "intent":
            _journal_write(fd, {**journal, "state": "verified"})
    except (OSError, ValueError, RuntimeError, TypeError, KeyError, subprocess.SubprocessError):
        raise WebImageUnknown("Web image-load readback unresolved; reconcile without replay") from None
    return {"schemaVersion": 1, "kind": "warpdrive-installed-web-image-load", "state": "verified", **binding,
            "beforeInventorySha256": content_hash(journal["before"]), "afterInventorySha256": content_hash(observed),
            "imageId": digest, "deploymentAuthorized": False}


def load_installed_web_image(directory, *, state_dir, docker, expected_revision, expected_manifest_sha256,
                             baseline_revision, baseline_manifest_sha256, expected_origin, expected_daemon,
                             reconcile=False):
    """Load once or reconcile against one already authenticated Web artifact.

    The caller owns the protected directory and selects a stable state directory
    for this archive and daemon. The daemon is only written by image load.
    """
    _daemon_pin(expected_daemon)
    admitted = candidate.load_web_bundle(directory, expected_revision=expected_revision,
                                         expected_manifest_sha256=expected_manifest_sha256, baseline_revision=baseline_revision,
                                         baseline_manifest_sha256=baseline_manifest_sha256, expected_origin=expected_origin)
    return load_verified_web_archive(directory, state_dir=state_dir, docker=docker, image=admitted["candidate"]["image"],
        provenance=admitted["provenance"], baseline_revision=baseline_revision, baseline_manifest_sha256=baseline_manifest_sha256,
        origin=expected_origin, expected_daemon=expected_daemon, reconcile=reconcile)


def load_verified_web_archive(directory, *, state_dir, docker, image, provenance, baseline_revision,
                              baseline_manifest_sha256, origin, expected_daemon, reconcile=False):
    """Load a private archive after its versioned artifact verifier has admitted it."""
    _daemon_pin(expected_daemon)
    require(type(reconcile) is bool and not state_dir.is_relative_to(directory) and not directory.is_relative_to(state_dir),
            "Distinct protected bundle and state directories required")
    require(candidate.REVISION.fullmatch(image["sourceRevision"]) and candidate.REVISION.fullmatch(baseline_revision)
            and image["sourceRevision"] != baseline_revision and inputs.HASH.fullmatch(baseline_manifest_sha256)
            and inputs.HASH.fullmatch(provenance["bundleManifestSha256"]), "Exact admitted Web and baseline provenance required")
    with candidate._directory(directory) as parent, _state_directory(state_dir) as fd:
        root = os.fstat(parent)
        require(root.st_uid == os.geteuid() and stat.S_IMODE(root.st_mode) == 0o700, "Owned mode0700 Web bundle required")
        with candidate._opened(parent, candidate.ARCHIVE, candidate.MAX_ARCHIVE_BYTES) as (source, size):
            info = os.fstat(source.fileno())
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) in {0o400, 0o600}, "Private Web archive required")
            facts = _archive_facts(source, size, provenance, image)
            binding = {"sourceRevision": image["sourceRevision"], "bundleManifestSha256": provenance["bundleManifestSha256"],
                       "baselineRevision": baseline_revision, "baselineManifestSha256": baseline_manifest_sha256,
                       "origin": origin, "archiveSha256": provenance["archiveSha256"], "archiveSizeBytes": size,
                       "testedConfigDigest": image["imageId"], "manifestDigest": facts["descriptor"]["digest"],
                       "daemon": expected_daemon}
            return _install(docker, fd, source, size, facts, binding, reconcile)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("load", "reconcile"))
    for key in ("bundle-dir", "state-dir", "containerd-root"):
        parser.add_argument("--" + key, type=Path, required=True)
    for key in ("expected-revision", "expected-manifest-sha256", "baseline-revision", "baseline-manifest-sha256",
                "repository", "event", "expected-daemon-id"):
        parser.add_argument("--" + key, required=True)
    for key in ("run-id", "run-attempt", "expected-socket-device", "expected-socket-inode"):
        parser.add_argument("--" + key, type=int, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = load_installed_web_image(args.bundle_dir, state_dir=args.state_dir,
            docker=LocalDocker(containerd_root=args.containerd_root),
            expected_revision=args.expected_revision, expected_manifest_sha256=args.expected_manifest_sha256,
            baseline_revision=args.baseline_revision, baseline_manifest_sha256=args.baseline_manifest_sha256,
            expected_origin={"kind": "github-actions", "repository": args.repository, "runId": args.run_id,
                             "runAttempt": args.run_attempt, "event": args.event, "ref": "refs/heads/main"},
            expected_daemon={"serverId": args.expected_daemon_id, "socketDevice": args.expected_socket_device,
                             "socketInode": args.expected_socket_inode}, reconcile=args.action == "reconcile")
    except (OSError, ValueError, RuntimeError, TypeError, KeyError, RecursionError, tarfile.TarError, subprocess.SubprocessError):
        print("Installed Web image load held. Preserve the journal and verify exact local evidence.", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
