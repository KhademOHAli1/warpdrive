"""Publish retained, tested native images without rebuilding or authorizing deployment.

The caller reconstructs the candidate with bundle.load_bundle and loads its verified
archive first. Registry credentials belong to Docker's existing credential mechanism,
never arguments or journal payloads. The durable journal is a recovery record with
checksum/binding validation, not a cryptographic signature or a substitute for trusted
storage. Candidate tags must also be protected from external overwrite by registry policy.
"""

from __future__ import annotations

from contextlib import contextmanager
import copy
from dataclasses import dataclass
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Protocol

from candidate import COMPONENTS, PENDING, SMOKE_CHECKS
from image_smoke import Docker
from registry_absence import AbsenceError, confirm_absent


REVISION = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
ATTEMPT = re.compile(r"[a-z0-9][a-z0-9_.-]{0,63}\Z")
PATH_COMPONENT = re.compile(r"[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*\Z")
HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\Z")
MANIFEST_TYPES = {
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
}
STATES = {"PENDING", "INTENT", "UNKNOWN", "VERIFIED"}


class RegistryError(RuntimeError):
    """Publication rejected without exposing command arguments or registry credentials."""


class RegistryConflict(RegistryError):
    """A definite existing remote object conflicts with the tested artifact."""


class PromotionUnknown(RegistryError):
    """A durable push intent cannot yet be independently reconciled; do not replay it."""


@dataclass(frozen=True)
class RemoteImage:
    digest: str
    manifest: dict[str, Any]


class RegistryAdapter(Protocol):
    def inspect_local(self, image_id: str) -> dict[str, Any]: ...
    def resolve_tag(self, tag: str) -> RemoteImage | None: ...
    def fetch_manifest(self, immutable_ref: str) -> dict[str, Any]: ...
    def push(self, image_id: str, tag: str) -> None: ...


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RegistryError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def decode_json(text: str) -> Any:
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "duplicate JSON property rejected")
            value[key] = item
        return value
    try:
        return json.loads(text, object_pairs_hook=unique)
    except (ValueError, TypeError) as error:
        raise RegistryError("invalid JSON evidence") from error


def validate_repository_prefix(value: str) -> str:
    require(isinstance(value, str) and 1 <= len(value) <= 230,
            "explicit registry/repository prefix required")
    require("/" in value and not any(character in value for character in "@?#\\ \t\r\n"),
            "invalid registry/repository prefix")
    host, path = value.split("/", 1)
    parts = host.split(":")
    require(len(parts) <= 2 and bool(parts[0]), "invalid registry host")
    hostname = parts[0]
    require(all(HOST_LABEL.fullmatch(label) for label in hostname.split(".")), "invalid registry host")
    require("." in hostname or len(parts) == 2 or hostname == "localhost",
            "registry host must be explicit")
    if len(parts) == 2:
        require(bool(re.fullmatch(r"[0-9]{1,5}", parts[1]))
                and 1 <= int(parts[1]) <= 65535, "invalid registry port")
    require(bool(path) and all(PATH_COMPONENT.fullmatch(part) for part in path.split("/")),
            "invalid repository path")
    return value


def candidate_tag(repository_prefix: str, component: str, revision: str, image_id: str) -> str:
    validate_repository_prefix(repository_prefix)
    require(component in COMPONENTS, "unknown image component")
    require(isinstance(revision, str) and bool(REVISION.fullmatch(revision)), "invalid source revision")
    require(isinstance(image_id, str) and bool(DIGEST.fullmatch(image_id)), "invalid tested image ID")
    repository = f"{repository_prefix}-{component}"
    require(len(repository) <= 255, "repository name is too long")
    tag = f"candidate-{revision}-{image_id.removeprefix('sha256:')}"
    require(len(tag) <= 128, "candidate tag is too long")
    return f"{repository}:{tag}"


def _nonroot(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    user = value.split(":", 1)[0]
    return user not in {"", "root"} and not (user.isdigit() and int(user) == 0)


def _validate_candidate(candidate: dict, revision: str, provenance: dict) -> None:
    require(isinstance(revision, str) and bool(REVISION.fullmatch(revision)), "invalid expected revision")
    require(isinstance(candidate, dict) and type(candidate.get("schemaVersion")) is int
            and candidate["schemaVersion"] in {1, 2} and candidate.get("kind") == "warpdrive-image-candidate",
            "reconstructed image candidate required")
    require(candidate.get("revision") == revision and candidate.get("platform") == "linux/amd64",
            "candidate source/platform mismatch")
    if candidate["schemaVersion"] == 2:
        require(candidate.get("releaseRevision") == revision, "candidate release revision mismatch")
        inputs = candidate.get("inputProvenance")
        require(isinstance(inputs, dict) and set(inputs) == {"state", "receiptSha256", "inputPolicySha256"}
                and inputs["state"] == "current-source-inputs-bound"
                and all(isinstance(inputs[key], str) and HASH.fullmatch(inputs[key])
                        for key in ("receiptSha256", "inputPolicySha256")), "bound component input provenance required")
    require(candidate.get("deploymentAuthorized") is False and candidate.get("compatibility") == "unassessed",
            "candidate must retain deployment and compatibility boundaries")
    qualification = candidate.get("qualification")
    require(isinstance(qualification, dict) and qualification.get("state") == "image-smoke-passed"
            and isinstance(qualification.get("reportSha256"), str)
            and bool(HASH.fullmatch(qualification["reportSha256"]))
            and qualification.get("checks") == list(SMOKE_CHECKS)
            and isinstance(qualification.get("limitations"), list) and qualification["limitations"],
            "complete image-smoke qualification required")
    gates = candidate.get("pendingGates")
    require(isinstance(gates, list) and all(isinstance(item, str) and item for item in gates)
            and len(gates) == len(set(gates)) and set(PENDING).issubset(gates),
            "candidate pending gates must remain explicit")
    require(candidate["schemaVersion"] != 2 or "independently-qualified-component-reuse" in gates,
            "fresh-build v2 does not qualify retained component reuse")
    components = candidate.get("components")
    require(isinstance(components, dict) and set(components) == set(COMPONENTS), "all tested Core images required")
    for name in COMPONENTS:
        component = components[name]
        require(isinstance(component, dict) and isinstance(component.get("imageId"), str)
                and bool(DIGEST.fullmatch(component["imageId"])) and _nonroot(component.get("runtimeUser"))
                and component.get("registryRef") is None, f"{name}: invalid tested image identity")
        if candidate["schemaVersion"] == 2:
            require(component.get("sourceRevision") == revision
                    and isinstance(component.get("inputSha256"), str) and HASH.fullmatch(component["inputSha256"])
                    and component.get("inputPolicySha256") == candidate["inputProvenance"]["inputPolicySha256"],
                    f"{name}: fresh-build source/input identity differs")
    require(isinstance(provenance, dict) and set(provenance) == {"archiveSha256", "bundleManifestSha256"}
            and all(isinstance(value, str) and HASH.fullmatch(value) for value in provenance.values()),
            "verified bundle/archive provenance hashes required")


def _validate_local(adapter: RegistryAdapter, candidate: dict, revision: str) -> None:
    for name in COMPONENTS:
        expected = candidate["components"][name]
        try:
            actual = adapter.inspect_local(expected["imageId"])
        except Exception as error:
            raise RegistryError(f"{name}: tested local image could not be inspected") from error
        require(isinstance(actual, dict) and actual.get("Id") == expected["imageId"]
                and actual.get("Os") == "linux" and actual.get("Architecture") == "amd64",
                f"{name}: local image identity/platform differs from tested candidate")
        config = actual.get("Config") or {}
        require(isinstance(config, dict) and config.get("User") == expected["runtimeUser"]
                and _nonroot(config.get("User"))
                and isinstance(config.get("Labels"), dict)
                and config["Labels"].get("org.opencontainers.image.revision") == revision,
                f"{name}: local image source/user differs from tested candidate")


def _manifest_config(manifest: Any) -> str:
    require(isinstance(manifest, dict) and type(manifest.get("schemaVersion")) is int
            and manifest["schemaVersion"] == 2 and manifest.get("mediaType") in MANIFEST_TYPES
            and "manifests" not in manifest, "single native image manifest required")
    config = manifest.get("config")
    require(isinstance(config, dict) and isinstance(config.get("digest"), str)
            and bool(DIGEST.fullmatch(config["digest"])), "image manifest config digest required")
    return config["digest"]


def _verified_remote(adapter: RegistryAdapter, tag: str, image_id: str) -> dict | None:
    try:
        remote = adapter.resolve_tag(tag)
    except RegistryConflict:
        raise
    except Exception as error:
        raise RegistryError("registry tag resolution is indeterminate") from error
    if remote is None:
        return None
    require(isinstance(remote, RemoteImage) and isinstance(remote.digest, str)
            and bool(DIGEST.fullmatch(remote.digest)), "registry did not return an immutable manifest digest")
    if _manifest_config(remote.manifest) != image_id:
        raise RegistryConflict("existing candidate tag has different image content")
    immutable = f"{tag.rsplit(':', 1)[0]}@{remote.digest}"
    try:
        manifest = adapter.fetch_manifest(immutable)
    except Exception as error:
        raise RegistryError("immutable registry manifest could not be independently read") from error
    if _manifest_config(manifest) != image_id:
        raise RegistryConflict("immutable registry manifest differs from tested image")
    if canonical(manifest) != canonical(remote.manifest):
        raise RegistryConflict("tag resolution and immutable manifest differ")
    return {"registryRef": immutable, "manifestCanonicalSha256": content_hash(manifest)}


class DockerRegistryAdapter:
    """Docker CLI transport using the already admitted, pinned local Unix context.

    Buildx's documented .Manifest JSON digest is registry identity. Raw JSON is used
    only to inspect config, never pretty-printed/rehashed to invent a registry digest.
    """

    def __init__(self, docker: Docker | None = None):
        self.docker = docker or Docker()

    def inspect_local(self, image_id: str) -> dict[str, Any]:
        result = self.docker.json(["image", "inspect", image_id])
        require(isinstance(result, list) and len(result) == 1, "one local image inspection required")
        return result[0]

    def resolve_tag(self, tag: str) -> RemoteImage | None:
        result = self.docker.run(
            ["buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", tag],
            timeout=60, check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.lower()
            denied = any(term in detail for term in (
                "unauthorized", "forbidden", "denied", "authentication", "timeout", "timed out",
                "connection", "certificate", "tls", "lookup", "no such host",
            ))
            # Buildx resolves through HEAD and can collapse the registry's error
            # body into plain "not found". Confirm a structured V2 GET response;
            # neither that CLI text nor a generic HTTP 404 establishes absence.
            if not denied and re.search(r"\b(?:manifest[ _]unknown|not found|404)\b", detail):
                environment = getattr(self.docker, "environment", None)
                require(isinstance(environment, dict), "admitted Docker credential environment required")
                try:
                    confirm_absent(tag, environment=environment, runner=self.docker.runner)
                except AbsenceError as error:
                    raise RegistryError(str(error)) from error
                return None
            raise RegistryError("registry tag resolution is indeterminate")
        metadata = decode_json(result.stdout)
        require(isinstance(metadata, dict) and isinstance(metadata.get("digest"), str)
                and bool(DIGEST.fullmatch(metadata["digest"])), "registry manifest descriptor lacks digest")
        immutable = f"{tag.rsplit(':', 1)[0]}@{metadata['digest']}"
        return RemoteImage(metadata["digest"], self.fetch_manifest(immutable))

    def fetch_manifest(self, immutable_ref: str) -> dict[str, Any]:
        result = self.docker.run(
            ["buildx", "imagetools", "inspect", "--raw", immutable_ref], timeout=60,
        )
        return decode_json(result.stdout)

    def push(self, image_id: str, tag: str) -> None:
        self.docker.run(["image", "tag", image_id, tag])
        self.docker.run(["image", "push", tag], timeout=600)


def _read(path: Path) -> dict:
    require(not path.is_symlink() and path.stat().st_size <= 1024 * 1024, "unsafe evidence file")
    value = decode_json(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), "invalid evidence document")
    return value


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_exclusive(path: Path, value: dict) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(canonical(value) + b"\n")
        output.flush()
        os.fsync(output.fileno())
    _fsync_directory(path.parent)


@contextmanager
def _journal_lock(path: Path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RegistryError("another publisher owns this promotion journal") from error
        yield
    finally:
        os.close(descriptor)


class _Journal:
    def __init__(self, path: Path, binding: dict):
        self.path = path
        if path.exists():
            self.envelope = _read(path)
            require(set(self.envelope) == {"payload", "sha256"}, "invalid promotion journal envelope")
            self.payload = copy.deepcopy(self.envelope["payload"])
            require(isinstance(self.payload, dict) and self.envelope["sha256"] == content_hash(self.payload),
                    "promotion journal checksum mismatch")
            require(set(self.payload) == {"schemaVersion", "kind", "binding", "components"}
                    and type(self.payload["schemaVersion"]) is int and self.payload["schemaVersion"] == 1
                    and self.payload["kind"] == "warpdrive-registry-promotion-journal"
                    and self.payload["binding"] == binding, "promotion journal binding mismatch")
            rows = self.payload["components"]
            require(isinstance(rows, dict) and set(rows) == set(COMPONENTS), "invalid journal components")
            unfinished = False
            ambiguous = False
            pending_seen = False
            for name in COMPONENTS:
                row = rows[name]
                require(isinstance(row, dict) and set(row) == {
                    "state", "tag", "imageId", "registryRef", "manifestCanonicalSha256",
                } and isinstance(row["state"], str) and row["state"] in STATES
                        and row["tag"] == binding["components"][name]["tag"]
                        and row["imageId"] == binding["components"][name]["imageId"], "invalid journal component")
                if row["state"] == "VERIFIED":
                    require(not unfinished, "inconsistent partial promotion journal")
                    prefix = f"{row['tag'].rsplit(':', 1)[0]}@"
                    require(isinstance(row["registryRef"], str) and row["registryRef"].startswith(prefix)
                            and bool(DIGEST.fullmatch(row["registryRef"][len(prefix):]))
                            and isinstance(row["manifestCanonicalSha256"], str)
                            and bool(HASH.fullmatch(row["manifestCanonicalSha256"])), "invalid verified journal receipt")
                else:
                    unfinished = True
                    require(row["registryRef"] is None and row["manifestCanonicalSha256"] is None,
                            "unverified journal row contains registry evidence")
                    if row["state"] in {"INTENT", "UNKNOWN"}:
                        require(not ambiguous and not pending_seen, "inconsistent unresolved promotion intent")
                        ambiguous = True
                    else:
                        pending_seen = True
        else:
            self.payload = {
                "schemaVersion": 1, "kind": "warpdrive-registry-promotion-journal", "binding": binding,
                "components": {
                    name: {"state": "PENDING", "tag": binding["components"][name]["tag"],
                           "imageId": binding["components"][name]["imageId"], "registryRef": None,
                           "manifestCanonicalSha256": None}
                    for name in COMPONENTS
                },
            }
            self.envelope = {"payload": copy.deepcopy(self.payload), "sha256": content_hash(self.payload)}
            _write_exclusive(path, self.envelope)

    def save(self) -> None:
        require(_read(self.path) == self.envelope, "promotion journal changed during publication")
        updated = {"payload": copy.deepcopy(self.payload), "sha256": content_hash(self.payload)}
        descriptor, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        temporary_path = Path(temporary)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(canonical(updated) + b"\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_path, self.path)
            _fsync_directory(self.path.parent)
        finally:
            temporary_path.unlink(missing_ok=True)
        self.envelope = updated


def promote_candidate(
    candidate: dict, *, expected_revision: str, repository_prefix: str, attempt_id: str,
    journal_path: Path, output_path: Path, bundle_provenance: dict[str, str],
    adapter: RegistryAdapter | None = None,
) -> dict:
    """Publish tested IDs once; reconcile uncertain outcomes without replaying pushes."""
    _validate_candidate(candidate, expected_revision, bundle_provenance)
    validate_repository_prefix(repository_prefix)
    require(isinstance(attempt_id, str) and bool(ATTEMPT.fullmatch(attempt_id)), "invalid publication attempt ID")
    journal_path, output_path = Path(journal_path), Path(output_path)
    require(journal_path.resolve() != output_path.resolve(), "journal and output must be separate files")
    require(not journal_path.is_symlink() and not output_path.is_symlink(), "evidence paths must not be symlinks")
    journal_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    transport = adapter or DockerRegistryAdapter()
    _validate_local(transport, candidate, expected_revision)
    binding = {
        "candidateSha256": content_hash(candidate), "revision": expected_revision,
        "repositoryPrefix": repository_prefix, "attemptId": attempt_id,
        "bundleProvenance": copy.deepcopy(bundle_provenance),
        "components": {
            name: {"imageId": candidate["components"][name]["imageId"],
                   "tag": candidate_tag(repository_prefix, name, expected_revision,
                                        candidate["components"][name]["imageId"])}
            for name in COMPONENTS
        },
    }
    lock_path = journal_path.with_name(journal_path.name + ".lock")
    with _journal_lock(lock_path):
        require(not output_path.exists() or journal_path.exists(), "output exists without a promotion journal")
        journal = _Journal(journal_path, binding)
        rows = journal.payload["components"]
        require(not output_path.exists() or all(row["state"] == "VERIFIED" for row in rows.values()),
                "output exists for an incomplete promotion")
        # Read all destinations before any new external write. A conflict in a later
        # component must not partially publish an otherwise fresh candidate.
        resolved = {}
        for name in COMPONENTS:
            row = rows[name]
            try:
                remote = _verified_remote(transport, row["tag"], row["imageId"])
            except Exception as error:
                if row["state"] in {"INTENT", "UNKNOWN"}:
                    row["state"] = "UNKNOWN"
                    journal.save()
                    raise PromotionUnknown(f"{name}: prior push outcome remains unresolved") from error
                raise
            if row["state"] in {"INTENT", "UNKNOWN"} and remote is None:
                row["state"] = "UNKNOWN"
                journal.save()
                raise PromotionUnknown(f"{name}: prior push outcome is absent or indeterminate; replay prohibited")
            if row["state"] == "VERIFIED":
                if remote != {key: row[key] for key in ("registryRef", "manifestCanonicalSha256")}:
                    raise RegistryConflict(f"{name}: verified candidate tag changed or disappeared")
            resolved[name] = remote
        for name in COMPONENTS:
            row = rows[name]
            if row["state"] == "VERIFIED":
                continue
            remote = resolved[name]
            if remote is None:
                # Narrow the race window immediately before persisting the intent.
                remote = _verified_remote(transport, row["tag"], row["imageId"])
            if remote is None:
                row["state"] = "INTENT"
                journal.save()
                try:
                    transport.push(row["imageId"], row["tag"])
                    remote = _verified_remote(transport, row["tag"], row["imageId"])
                    if remote is None:
                        raise RegistryError("push returned without independently visible manifest")
                except Exception as error:
                    row["state"] = "UNKNOWN"
                    journal.save()
                    raise PromotionUnknown(f"{name}: push outcome requires independent reconciliation") from error
            row.update(remote)
            row["state"] = "VERIFIED"
            journal.save()
        result = copy.deepcopy(candidate)
        result["kind"] = "warpdrive-registry-candidate"
        for name in COMPONENTS:
            result["components"][name].update({
                "registryRef": rows[name]["registryRef"], "sourceRevision": expected_revision,
                "manifestCanonicalSha256": rows[name]["manifestCanonicalSha256"],
            })
        result["provenance"] = {
            **bundle_provenance, "candidateSha256": binding["candidateSha256"],
            "smokeReportSha256": candidate["qualification"]["reportSha256"],
            "promotionJournalSha256": journal.envelope["sha256"],
        }
        result["publication"] = {
            "state": "immutable-registry-configs-verified", "attemptId": attempt_id,
            "repositoryPrefix": repository_prefix,
        }
        if output_path.exists():
            require(_read(output_path) == result, "existing output differs from verified promotion")
        else:
            _write_exclusive(output_path, result)
        return result
