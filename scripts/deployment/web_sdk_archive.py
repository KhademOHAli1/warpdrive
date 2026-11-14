"""Project one tested SDK Web image from an authenticated ordinary full bundle.

This is a transport projection, not component-reuse or installation admission.
The original bundle, image identities, qualification and pending gates stay intact.
No image build, layer recompression, Docker operation or remote request occurs.
"""

from contextlib import contextmanager
from hashlib import sha256
import io
import os
from pathlib import Path
import re
import secrets
import stat
import tarfile

import component_inputs as inputs
import native_image_identity as native
import publication_gate
from installed_web_stage import _publish_record
from bundle import ARCHIVE as FULL_ARCHIVE, INPUT_RECEIPT, MANIFEST, MAX_METADATA_BYTES
from candidate import COMPONENTS
import web_candidate as web
from web_sdk_full_receipt import KIND as SDK_INPUT_KIND, validate_web_sdk_full_receipt


KIND = "warpdrive-sdk-web-archive-projection"
POLICY = "sdk-full-bundle-one-web-native-closure-v1"
MAX_ORIGINAL_BYTES = native.MAX_ARCHIVE_BYTES
MAX_OUTPUT_BYTES = web.MAX_ARCHIVE_BYTES
MAX_SOURCE_MEMBERS = native.MAX_MEMBERS
HASH = re.compile(r"[a-f0-9]{64}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
BLOB = re.compile(r"blobs/sha256/[a-f0-9]{64}\Z")


class ProjectionError(ValueError):
    """Projection held; no installed or backend qualification is implied."""


def require(condition, message):
    if not condition:
        raise ProjectionError(message)


def _hash(raw):
    return sha256(raw).hexdigest()


def _match(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def _metadata(parent, name, expected):
    with web._opened(parent, name, MAX_METADATA_BYTES) as (source, size):
        raw = source.read(MAX_METADATA_BYTES + 1)
        require(len(raw) == size and _hash(raw) == expected, "Full-bundle metadata changed after admission")
        return inputs.decode(raw)


def _members(archive, source, size):
    """Only an already graph-verified, bounded plain OCI/Docker tar is reread."""
    files, names, total = {}, set(), 0
    for item in archive:
        name = item.name.rstrip("/")
        require(len(names) < MAX_SOURCE_MEMBERS and name not in names
                and 0 <= item.offset_data <= item.offset_data + item.size <= size,
                "Duplicate, excessive or truncated source member")
        names.add(name)
        total += item.size
        require(total <= MAX_ORIGINAL_BYTES and total <= size, "Source aggregate byte limit exceeded")
        if item.isdir():
            require(item.size == 0 and name in {"blobs", "blobs/sha256"}
                    and item.name in {name, name + "/"}, "Unexpected source directory")
        else:
            require(item.isfile() and item.name == name and
                    (name in {"index.json", "manifest.json", "oci-layout"} or _match(BLOB, name)),
                    "Unsafe source archive member")
            files[name] = item
    require(1024 <= size - archive.offset <= 65536, "Invalid source tar terminator")
    source.seek(archive.offset)
    require(not any(source.read(65537)), "Nonzero source tar trailer")
    return files


def _tar_json(archive, files, name):
    require(name in files and 0 < files[name].size <= native.MAX_JSON_BYTES, "Bounded selected metadata required")
    with archive.extractfile(files[name]) as source:
        raw = source.read(native.MAX_JSON_BYTES + 1)
    require(len(raw) == files[name].size and _hash(raw) == name.rsplit("/", 1)[1],
            "Selected metadata digest differs")
    return raw, inputs.decode(raw)


def _descriptor(value, allowed, files):
    require(type(value) is dict and set(value) <= {"mediaType", "digest", "size", "annotations"}
            and value.get("mediaType") in allowed and _match(DIGEST, value.get("digest"))
            and type(value.get("size")) is int and value["size"] > 0,
            "Self-contained selected image descriptor required")
    annotations = value.get("annotations", {})
    require(type(annotations) is dict and all(type(k) is str and type(v) is str for k, v in annotations.items()),
            "Invalid selected descriptor annotations")
    name = "blobs/sha256/" + value["digest"][7:]
    require(name in files and files[name].size == value["size"], "Selected descriptor blob missing or resized")
    return name


class _BoundedWriter:
    def __init__(self, output):
        self.output = output

    def write(self, raw):
        require(self.output.tell() + len(raw) <= MAX_OUTPUT_BYTES, "Projected Web archive exceeds its byte limit")
        return self.output.write(raw)

    def tell(self):
        return self.output.tell()


def _tar_entry(archive, name, size, source):
    item = tarfile.TarInfo(name)
    item.size, item.mode, item.mtime = size, 0o600, 0
    item.uid = item.gid = 0
    item.uname = item.gname = ""
    archive.addfile(item, source)


def _write_projection(source, size, output, identity, manifest_digest):
    source.seek(0)
    with tarfile.open(fileobj=source, mode="r:", tarinfo=web._PlainTarMember) as archive:
        files = _members(archive, source, size)
        manifest_path = "blobs/sha256/" + manifest_digest[7:]
        raw_manifest, manifest = _tar_json(archive, files, manifest_path)
        descriptor = identity["nativeIdentityCandidates"][manifest_digest]
        require(descriptor["kind"] == "platform-manifest-digest" and descriptor["size"] == len(raw_manifest)
                and type(manifest) is dict and manifest.get("schemaVersion") == 2
                and manifest.get("mediaType", descriptor["mediaType"]) == descriptor["mediaType"]
                and not {"subject", "artifactType", "manifests"} & manifest.keys(),
                "Exact existing Web platform manifest required")
        config_path = _descriptor(manifest.get("config"), native.CONFIG_TYPES, files)
        require(config_path == "blobs/sha256/" + identity["configDigest"][7:], "Selected Web config differs")
        layers = manifest.get("layers")
        require(type(layers) is list and 0 < len(layers) <= native.MAX_LAYERS, "Bounded selected Web layers required")
        layer_paths = [_descriptor(layer, native.LAYER_TYPES, files) for layer in layers]
        closure = {manifest_path, config_path, *layer_paths}
        metadata = {
            "index.json": inputs.canonical({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [{"mediaType": descriptor["mediaType"], "digest": manifest_digest,
                    "size": len(raw_manifest), "platform": {"os": "linux", "architecture": "amd64"}}]}),
            "manifest.json": inputs.canonical([{"Config": config_path, "RepoTags": [], "Layers": layer_paths}]),
            "oci-layout": inputs.canonical({"imageLayoutVersion": "1.0.0"}),
        }
        require(len(closure) + len(metadata) <= web.MAX_TAR_MEMBERS
                and sum(files[name].size for name in closure) + sum(map(len, metadata.values())) < MAX_OUTPUT_BYTES,
                "Selected Web closure exceeds output limits")
        with tarfile.open(fileobj=_BoundedWriter(output), mode="w", format=tarfile.USTAR_FORMAT) as target:
            for name in sorted(set(metadata) | closure):
                if name in metadata:
                    _tar_entry(target, name, len(metadata[name]), io.BytesIO(metadata[name]))
                else:
                    with archive.extractfile(files[name]) as payload:
                        _tar_entry(target, name, files[name].size, payload)
        return [layer["digest"] for layer in layers]


@contextmanager
def _private_output_parent(path):
    """Hold the caller-owned directory; only the final archive name is published."""
    parent = path.parent
    require(path.is_absolute() and parent == parent.resolve(strict=True)
            and path.name == web.ARCHIVE, "Canonical private destination named web-image.tar required")
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        require(before.st_uid == os.geteuid() and stat.S_IMODE(before.st_mode) == 0o700,
                "Owned mode0700 projection destination directory required")
        yield descriptor
        after = parent.lstat()
        require((before.st_dev, before.st_ino, before.st_mode) == (after.st_dev, after.st_ino, after.st_mode),
                "Projection destination directory changed")
    finally:
        os.close(descriptor)


def project_downloaded_sdk_web_archive(directory, destination, *, admission, expected_admission_sha256,
        expected_revision, expected_bundle_manifest_sha256, expected_archive_sha256, expected_archive_bytes,
        expected_images, expected_web_manifest_digest, archive_mode="docker-save-compatibility"):
    """Return an explicit projection receipt after atomically publishing one Web tar.

    ``expected_images`` contains independent config/source/role metadata for all
    four tested roles, as required by native_image_identity.verify_archive.
    The API admission and its digest must already be authenticated by the caller.
    The returned loader-compatible image uses the config digest deliberately;
    original tested native IDs and transport custody are retained separately.
    """
    directory, destination = Path(directory), Path(destination)
    require(_match(HASH, expected_admission_sha256) and type(admission) is dict
            and len(inputs.canonical(admission)) <= MAX_METADATA_BYTES
            and inputs.content_hash(admission) == expected_admission_sha256,
            "Independent sealed publication admission pin required")
    require(_match(HASH, expected_bundle_manifest_sha256) and _match(HASH, expected_archive_sha256)
            and type(expected_archive_bytes) is int and 1024 <= expected_archive_bytes <= MAX_ORIGINAL_BYTES
            and _match(DIGEST, expected_web_manifest_digest), "Exact original custody and Web manifest pins required")
    require(type(expected_images) is dict and set(expected_images) == set(COMPONENTS),
            "Independent four-role native image expectations required")
    require(not destination.is_relative_to(directory) and not directory.is_relative_to(destination.parent),
            "Original and projected transport directories must be distinct")
    loaded = publication_gate.verify_downloaded(admission, directory, expected_revision=expected_revision)
    candidate = loaded["candidate"]
    require(candidate.get("schemaVersion") == 3 and candidate.get("kind") == "warpdrive-image-candidate"
            and set(candidate.get("components", {})) == set(COMPONENTS)
            and candidate.get("deploymentAuthorized") is False, "Ordinary schema3 full four-image candidate required")
    require(loaded["provenance"] == {"archiveSha256": expected_archive_sha256,
            "bundleManifestSha256": expected_bundle_manifest_sha256}, "Original bundle custody differs")
    with web._directory(directory) as parent:
        manifest = _metadata(parent, MANIFEST, expected_bundle_manifest_sha256)
        require(manifest["schemaVersion"] == 3 and manifest["kind"] == "warpdrive-tested-image-bundle",
                "Original full-bundle kind must remain explicit")
        sdk = _metadata(parent, INPUT_RECEIPT, manifest["files"][INPUT_RECEIPT]["sha256"])
        require(sdk.get("kind") == SDK_INPUT_KIND, "A genuine full SDK source input receipt is required")
        validate_web_sdk_full_receipt(sdk, expected_revision=expected_revision)
        archive_path = directory / FULL_ARCHIVE
        graph = native.verify_archive(archive_path, expected_sha256=expected_archive_sha256,
            expected_bytes=expected_archive_bytes, expected_images=expected_images, archive_mode=archive_mode)
        for role, tested in candidate["components"].items():
            identity = graph["images"][role]
            require(identity["sourceRevision"] == tested.get("sourceRevision", expected_revision)
                    and tested["imageId"] in identity["nativeIdentityCandidates"], "Tested native image is detached from archived role")
            with web._directory(directory / "inspections") as inspections:
                rows = _metadata(inspections, role + ".json", manifest["files"]["inspections/" + role + ".json"]["sha256"])
            native.verify_native_inspection(identity, rows, expected_native_id=tested["imageId"])
        identity = graph["images"]["web"]
        require(identity["manifestDigest"] == expected_web_manifest_digest,
                "Expected existing Web platform manifest is missing or ambiguous")
        with _private_output_parent(destination) as output_parent:
            temporary = ".web-sdk-projection-" + secrets.token_hex(12)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=output_parent)
            published = False
            try:
                with os.fdopen(descriptor, "wb") as output, web._opened(parent, FULL_ARCHIVE, MAX_ORIGINAL_BYTES) as (source, size):
                    require(size == expected_archive_bytes and web._stream_digest(source, size) == expected_archive_sha256,
                            "Original archive changed before projection")
                    layer_digests = _write_projection(source, size, output, identity, expected_web_manifest_digest)
                    output.flush()
                    os.fsync(output.fileno())
                    source.seek(0)
                    require(web._stream_digest(source, size) == expected_archive_sha256, "Original archive changed during projection")
                temporary_path = destination.parent / temporary
                derived_size = temporary_path.stat().st_size
                with web._opened(output_parent, temporary, MAX_OUTPUT_BYTES) as (source, size):
                    derived_hash = web._stream_digest(source, size)
                    source.seek(0)
                    image = web._archive_image(source, size, identity["configDigest"], expected_revision)
                derived = native.verify_archive(temporary_path, expected_sha256=derived_hash, expected_bytes=derived_size,
                    expected_images={"web": expected_images["web"]}, archive_mode="strict-oci")
                require(derived["images"]["web"]["manifestDigest"] == expected_web_manifest_digest
                        and derived["images"]["web"]["configMetadataSha256"] == identity["configMetadataSha256"]
                        and derived["images"]["web"]["rootfsDiffIds"] == identity["rootfsDiffIds"],
                        "Projected Web native identity differs from the tested original")
                # Use the installed controller's atomic no-replace rename. A
                # stopped publisher cannot leave a loader-rejected second link.
                _publish_record(output_parent, temporary, destination.name)
                published = True
                os.fsync(output_parent)
                require(os.stat(destination.name, dir_fd=output_parent, follow_symlinks=False).st_nlink == 1,
                        "Projected archive must have one private link")
            finally:
                try:
                    os.unlink(temporary, dir_fd=output_parent)
                except FileNotFoundError:
                    pass
                # A published file is retained if final acknowledgement fails;
                # callers must inspect it rather than automatically retry.
                if not published:
                    os.fsync(output_parent)
    return {"schemaVersion": 1, "kind": KIND, "policy": POLICY, "sourceRevision": expected_revision,
        "platform": "linux/amd64", "original": {"kind": manifest["kind"], "schemaVersion": 3,
            "publicationAdmissionSha256": expected_admission_sha256, "origin": loaded["origin"],
            "bundleManifestSha256": expected_bundle_manifest_sha256, "archiveSha256": expected_archive_sha256,
            "archiveSizeBytes": expected_archive_bytes, "testedNativeImageId": candidate["components"]["web"]["imageId"],
            "candidatePendingGates": candidate["pendingGates"]},
        "selectedWeb": {"configDigest": identity["configDigest"], "manifestDigest": expected_web_manifest_digest,
            "layerDigests": layer_digests, "configMetadataSha256": identity["configMetadataSha256"],
            "rootfsDiffIds": identity["rootfsDiffIds"]},
        "derived": {"path": str(destination), "kind": "untagged-single-web-direct-oci-archive",
            "archiveSha256": derived_hash, "archiveSizeBytes": derived_size},
        "image": image, "provenance": {"archiveSha256": derived_hash, "archiveSizeBytes": derived_size,
            "bundleManifestSha256": expected_bundle_manifest_sha256},
        "projectionOnly": True, "backendReuseQualified": False, "installationAuthorized": False,
        "deploymentAuthorized": False}
