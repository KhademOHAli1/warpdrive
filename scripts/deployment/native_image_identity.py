"""Verify offline native image identity graphs without granting release authority.

Docker's local ID can identify a config, platform manifest or single-platform
index. These identities remain separate; none is rewritten to resemble another.
The caller supplies independent archive/config/source pins and role metadata.
"""

from hashlib import sha256
import gzip
import json
from pathlib import Path
import re
import tarfile

from candidate import CandidateError
from component_inputs import InputError, decode
from web_candidate import _directory, _opened, _PlainTarMember, _stream_digest


HASH = re.compile(r"[a-f0-9]{64}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
BLOB = re.compile(r"blobs/sha256/[a-f0-9]{64}\Z")
ROLE = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
INDEX_TYPES = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
CONFIG_TYPES = {"application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"}
LAYER_TYPES = {"application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip",
               "application/vnd.oci.image.layer.v1.tar+zstd", "application/vnd.docker.image.rootfs.diff.tar",
               "application/vnd.docker.image.rootfs.diff.tar.gzip", "application/vnd.docker.image.rootfs.diff.tar.zstd"}
MAX_ARCHIVE_BYTES = 8 * 1024**3
MAX_EXPANDED_BYTES = 16 * 1024**3
MAX_MEMBERS = 2048
MAX_JSON_BYTES = 1024**2
MAX_LAYERS = 128
MAX_NODES = 128
MAX_DEPTH = 8
RUNTIME_FIELDS = {"User", "Cmd", "Entrypoint", "WorkingDir", "Env", "Labels", "ExposedPorts", "Volumes", "OnBuild",
                  "Healthcheck", "StopSignal", "StopTimeout", "Shell", "ArgsEscaped", "Hostname", "Domainname", "AttachStdin",
                  "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "NetworkDisabled"}


class IdentityError(ValueError):
    """A fixed offline identity gate failed; no command streams are involved."""


def require(condition, fact):
    if not condition:
        raise IdentityError(fact)


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _digest(raw):
    return "sha256:" + sha256(raw).hexdigest()


def _platform(value):
    require(type(value) is dict and value.get("os") == "linux" and value.get("architecture") == "amd64"
            and value.get("variant") in (None, "", "v1"), "Exactly Linux AMD64 platform required")


def _environment(values):
    require(values is None or type(values) is list, "Image environment must be a list")
    result = {}
    for value in values or []:
        require(type(value) is str and "=" in value and len(value.encode()) <= MAX_JSON_BYTES, "Image environment entry is invalid")
        key, content = value.split("=", 1)
        require(key and key not in result and "\x00" not in value, "Duplicate or invalid image environment key")
        result[key] = content
    return result


def _runtime(config):
    """Normalize image-inspect defaults; retain all relevant runtime field hashes."""
    require(type(config) is dict, "Image config metadata required")
    normalized = {}
    for key in RUNTIME_FIELDS:
        value = config.get(key)
        if key == "Env":
            value = _environment(value)
        elif key in {"Cmd", "Entrypoint", "OnBuild", "Shell"}:
            value = [] if value is None else value
            require(type(value) is list and all(type(item) is str for item in value), "Image command metadata is invalid")
        elif key in {"Labels", "ExposedPorts", "Volumes", "Healthcheck"}:
            value = {} if value is None else value
            require(type(value) is dict, "Image mapping metadata is invalid")
            if key == "Labels":
                require(all(type(label) is str and type(content) is str for label, content in value.items()), "Image labels are invalid")
        elif key in {"User", "WorkingDir", "StopSignal", "Hostname", "Domainname"}:
            value = "" if value is None else value
            require(type(value) is str, "Image string metadata is invalid")
        elif key == "StopTimeout":
            require(value is None or (type(value) is int and value >= 0), "Image stop timeout is invalid")
        else:
            value = False if value is None else value
            require(type(value) is bool, "Image boolean metadata is invalid")
        normalized[key] = value
    return normalized


def _expectations(expected_images):
    require(type(expected_images) is dict and 0 < len(expected_images) <= 4
            and all(_matches(ROLE, role) for role in expected_images), "One to four explicit image roles required")
    result = {}
    for role, expected in expected_images.items():
        require(type(expected) is dict and set(expected) == {"configDigest", "sourceRevision", "metadata"}
                and _matches(DIGEST, expected["configDigest"]) and _matches(REVISION, expected["sourceRevision"]),
                "Independent config/source pins and explicit role metadata required")
        metadata = expected["metadata"]
        require(type(metadata) is dict and "User" in metadata and set(metadata) <= RUNTIME_FIELDS,
                "Explicit supported role metadata and nonroot user required")
        user = metadata["User"]
        require(type(user) is str and re.fullmatch(r"[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?", user)
                and user.split(":", 1)[0] != "root" and not re.fullmatch(r"0+", user.split(":", 1)[0]),
                "Caller must explicitly select a nonroot image user")
        # Validate all supplied field types without introducing defaults into the policy.
        runtime_policy = dict(metadata)
        if "Env" in metadata:
            require(type(metadata["Env"]) is dict and all(type(key) is str and key and "=" not in key and "\x00" not in key
                    and type(value) is str and "\x00" not in value for key, value in metadata["Env"].items()),
                    "Explicit environment bindings must be a string mapping")
            runtime_policy["Env"] = [key + "=" + value for key, value in metadata["Env"].items()]
        normalized = _runtime(runtime_policy)
        result[role] = {**expected, "metadata": {key: normalized[key] for key in metadata}}
    require(len({value["configDigest"] for value in result.values()}) == len(result), "Distinct role config digests required")
    return result


def _role_metadata(actual, expected):
    for key, wanted in expected.items():
        if key in {"Labels", "Env"}:
            require(all(actual[key].get(name) == value for name, value in wanted.items()), "Role image binding differs")
        else:
            require(actual[key] == wanted, "Role image metadata differs")


def _rootfs(config):
    rootfs = config.get("rootfs")
    require(type(rootfs) is dict and rootfs.get("type") == "layers" and type(rootfs.get("diff_ids")) is list
            and 0 < len(rootfs["diff_ids"]) <= MAX_LAYERS and all(_matches(DIGEST, item) for item in rootfs["diff_ids"]),
            "Bounded image RootFS diff IDs required")
    return rootfs["diff_ids"]


def _raw_properties(raw):
    """Preserve nested Go JSON bytes while sorting only the CreateID top map."""
    text, decoder = raw.decode("utf-8", "strict"), json.JSONDecoder()
    result, offset = {}, 1
    require(text.startswith("{"), "Legacy object required")
    while True:
        while offset < len(text) and text[offset].isspace():
            offset += 1
        if text[offset] == "}":
            break
        key, offset = decoder.raw_decode(text, offset)
        require(type(key) is str and key not in result, "Duplicate legacy JSON key")
        while text[offset].isspace():
            offset += 1
        require(text[offset] == ":", "Invalid legacy JSON property")
        offset += 1
        while text[offset].isspace():
            offset += 1
        start = offset
        _, offset = decoder.raw_decode(text, offset)
        result[key] = text[start:offset].encode()
        while text[offset].isspace():
            offset += 1
        if text[offset] == "}":
            break
        require(text[offset] == ",", "Invalid legacy JSON separator")
        offset += 1
    return result


def _legacy_closure(legacy, by_config):
    if not legacy:
        return
    allowed_zero = {"Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce",
                    "Env", "Cmd", "Image", "Volumes", "WorkingDir", "Entrypoint", "OnBuild", "Labels", "ArgsEscaped", "Healthcheck",
                    "StopSignal", "StopTimeout", "Shell", "NetworkDisabled"}

    def zero(value):
        return type(value) is dict and set(value) <= allowed_zero and all(item in (None, False, "", [], {}) for item in value.values())

    intermediate = [item for item in legacy.values() if item[0].get("created") == "1970-01-01T00:00:00Z"
                    and set(item[0]) <= {"id", "parent", "created", "container_config", "os"} and zero(item[0].get("container_config"))]
    zero_values = [item for item in legacy.values() if zero(item[0].get("container_config"))]
    require(zero_values and (intermediate or all(len(_rootfs(value["config"])) == 1 for _, value in by_config.values())),
            "Legacy metadata has no verified epoch/zero-container template")
    template = intermediate[0] if intermediate else zero_values[0]
    zero_config = template[0]["container_config"]
    require(all(item[0]["container_config"] == zero_config for item in intermediate), "Conflicting legacy zero-container projections")
    approved = set()
    v1_fields = {"comment", "created", "container", "container_config", "docker_version", "author", "config", "architecture", "variant", "os", "size"}
    for _, image in by_config.values():
        config = image["config"]
        projection = {key: value for key, value in config.items() if key in v1_fields}
        projection.setdefault("container_config", zero_config)
        projection["os"] = config["os"]
        def same_projection(value):
            value = {key: content for key, content in value.items() if key not in {"id", "parent"}}
            if set(value) != set(projection):
                return False
            for key, expected in projection.items():
                if key in {"config", "container_config"}:
                    if type(value[key]) is not dict or type(expected) is not dict or _runtime(value[key]) != _runtime(expected):
                        return False
                    for field in (set(value[key]) | set(expected)) - RUNTIME_FIELDS:
                        left, right = value[key].get(field), expected.get(field)
                        if left != right and not (left in (None, False, "", [], {}) and right in (None, False, "", [], {})):
                            return False
                elif value[key] != expected:
                    return False
            return True

        tops = [item for item in legacy.values() if same_projection(item[0])]
        require(len(tops) == 1, "Legacy top metadata does not uniquely match selected config projection")
        chain, parent = None, None
        diffs = _rootfs(config)
        for index, diff in enumerate(diffs):
            top = index == len(diffs) - 1
            value, raw = tops[0] if top else template
            chain = diff if chain is None else _digest((chain + " " + diff).encode())
            properties = {key: value for key, value in _raw_properties(raw).items() if key not in {"id", "parent"}}
            if not top:
                properties.pop("os", None)
            properties["layer_id"] = _canonical(chain)
            if parent is not None:
                properties["parent"] = _canonical("sha256:" + parent)
            preimage = b"{" + b",".join(_canonical(key) + b":" + properties[key] for key in sorted(properties)) + b"}"
            identifier = sha256(preimage).hexdigest()
            require(identifier in legacy, "Legacy RootFS-prefix CreateID has no stored metadata")
            stored, _ = legacy[identifier]
            require(stored.get("id") == identifier and stored.get("parent") == parent and stored.get("os") == config["os"]
                    and {key: content for key, content in stored.items() if key not in {"id", "parent"}}
                    == {key: content for key, content in value.items() if key not in {"id", "parent"}},
                    "Legacy id/parent/selected projection differs from RootFS chain")
            approved.add(identifier)
            parent = identifier
    require(approved == set(legacy), "Unreferenced legacy layer metadata")


def _graph(source, size, expected, archive_mode):
    with tarfile.open(fileobj=source, mode="r:", tarinfo=_PlainTarMember) as archive:
        files, names, total = {}, set(), 0
        for member in archive:
            name = member.name.rstrip("/")
            require(len(names) < MAX_MEMBERS and name not in names and 0 <= member.offset_data <= member.offset_data + member.size <= size,
                    "Duplicate, excessive or truncated archive member")
            names.add(name)
            total += member.size
            require(total <= MAX_ARCHIVE_BYTES and total <= size, "Archive aggregate member bytes exceed bound")
            if member.isdir():
                require(member.size == 0 and name in {"blobs", "blobs/sha256"} and member.name in {name, name + "/"},
                        "Unexpected archive directory")
            else:
                require(member.name == name and (name in {"index.json", "manifest.json", "oci-layout"} or _matches(BLOB, name)),
                        "Unexpected or unsafe archive filename")
                files[name] = member
        require(1024 <= size - archive.offset <= 65536, "Invalid archive terminator length")
        source.seek(archive.offset)
        require(not any(source.read(65537)), "Nonzero data follows archive terminator")
        used, checked, nodes, manifests, indexes, active = set(), set(), {}, {}, {}, set()

        def raw(name):
            require(name in files and 0 < files[name].size <= MAX_JSON_BYTES, "Bounded graph metadata blob required")
            with archive.extractfile(files[name]) as stream:
                value = stream.read(MAX_JSON_BYTES + 1)
            require(len(value) == files[name].size, "Graph metadata blob is truncated")
            used.add(name)
            if name.startswith("blobs/"):
                require(_digest(value) == "sha256:" + name.rsplit("/", 1)[1], "Graph metadata digest substitution")
                checked.add(name)
            return value

        layout_raw = raw("oci-layout")
        require(decode(layout_raw) == {"imageLayoutVersion": "1.0.0"}, "OCI layout version differs")
        root_raw = raw("index.json")
        root = decode(root_raw)
        root_digest = _digest(root_raw)

        def descriptor(value, allowed):
            require(type(value) is dict and value.get("mediaType") in allowed and _matches(DIGEST, value.get("digest"))
                    and type(value.get("size")) is int and 0 < value["size"] <= MAX_ARCHIVE_BYTES,
                    "Exact bounded OCI descriptor required")
            name = "blobs/sha256/" + value["digest"][7:]
            require(name in files and files[name].size == value["size"], "Descriptor blob is missing or has different bytes")
            if "platform" in value:
                _platform(value["platform"])
            used.add(name)
            return name

        def walk(document, digest, media_type, byte_count, depth):
            require(depth <= MAX_DEPTH and digest not in active, "Cyclic or excessive OCI graph depth")
            if digest in nodes:
                require(nodes[digest] == {"mediaType": media_type, "size": byte_count}, "Conflicting graph descriptor identity")
                return indexes[digest] if digest in indexes else {manifests[digest]["configDigest"]}
            require(len(nodes) < MAX_NODES and type(document) is dict and type(document.get("schemaVersion")) is int
                    and document["schemaVersion"] == 2 and document.get("mediaType", media_type) == media_type,
                    "Unsupported or excessive OCI image graph")
            require(not {"subject", "artifactType"} & document.keys(), "Detached artifact or subject is not a runtime image")
            nodes[digest] = {"mediaType": media_type, "size": byte_count}
            active.add(digest)
            if media_type in INDEX_TYPES:
                entries = document.get("manifests")
                require(type(entries) is list and 0 < len(entries) <= MAX_NODES and not {"config", "layers"} & document.keys(),
                        "Bounded native image index required")
                found, branch_configs = set(), set()
                for child in entries:
                    name = descriptor(child, INDEX_TYPES | MANIFEST_TYPES)
                    value = raw(name)
                    children = walk(decode(value), child["digest"], child["mediaType"], len(value), depth + 1)
                    require(not branch_configs & children, "Ambiguous selected platform beneath image index")
                    branch_configs.update(children)
                    found.update(children)
                indexes[digest] = found
            else:
                require(media_type in MANIFEST_TYPES and not {"manifests"} & document.keys(), "Native platform manifest required")
                config_descriptor = document.get("config")
                config_path = descriptor(config_descriptor, CONFIG_TYPES)
                config = decode(raw(config_path))
                require(type(config) is dict, "Image config object required")
                _platform(config)
                layers = document.get("layers")
                diff_ids = _rootfs(config)
                require(type(layers) is list and len(layers) == len(diff_ids), "Image manifest and RootFS layer counts differ")
                paths = [descriptor(layer, LAYER_TYPES) for layer in layers]
                config_digest = config_descriptor["digest"]
                require(config_digest in {row["configDigest"] for row in expected.values()}, "Unapproved image config in reachable graph")
                require(not any(row["configDigest"] == config_digest for row in manifests.values()), "Ambiguous platform manifests for selected config")
                manifests[digest] = {"configDigest": config_digest, "config": config, "paths": paths, "layers": layers}
                found = {config_digest}
            active.remove(digest)
            return found

        root_type = root.get("mediaType", "application/vnd.oci.image.index.v1+json") if type(root) is dict else None
        require(root_type in INDEX_TYPES, "Archive root must be an OCI image catalog")
        found = walk(root, root_digest, root_type, len(root_raw), 0)
        selected_configs = {value["configDigest"] for value in expected.values()}
        require(found <= selected_configs and (archive_mode == "docker-save-compatibility" or found == selected_configs),
                "Archive does not contain the exact selected OCI image configs")
        compatibility_raw = raw("manifest.json")
        compatibility = decode(compatibility_raw)
        require(type(compatibility) is list and len(compatibility) == len(expected), "Exact Docker compatibility image inventory required")
        by_config = {value["configDigest"]: (digest, value) for digest, value in manifests.items()}
        seen = set()
        for entry in compatibility:
            require(type(entry) is dict and _matches(BLOB, entry.get("Config")) and type(entry.get("Layers")) is list,
                    "Invalid Docker compatibility manifest")
            config_digest = "sha256:" + entry["Config"].rsplit("/", 1)[1]
            require(config_digest in selected_configs and config_digest not in seen and not entry.get("Parent"),
                    "Detached, duplicate or substituted Docker compatibility image")
            if config_digest in by_config:
                require(entry["Layers"] == by_config[config_digest][1]["paths"], "Docker and OCI image layers differ")
            else:
                require(archive_mode == "docker-save-compatibility", "Docker image has no selected OCI root")
                config = decode(raw(entry["Config"]))
                require(type(config) is dict, "Docker compatibility config required")
                _platform(config)
                diff_ids = _rootfs(config)
                paths = entry["Layers"]
                require(len(paths) == len(diff_ids), "Docker compatibility RootFS layer count differs")
                layers = []
                for path, diff_id in zip(paths, diff_ids):
                    require(_matches(BLOB, path) and path in files and files[path].size > 0 and path != entry["Config"],
                            "Docker compatibility layer is missing or detached")
                    layer_digest = "sha256:" + path.rsplit("/", 1)[1]
                    if layer_digest == diff_id:
                        media_type = "application/vnd.oci.image.layer.v1.tar"
                    else:
                        with archive.extractfile(files[path]) as layer:
                            magic = layer.read(4)
                        require(magic.startswith(b"\x1f\x8b") or magic == b"\x28\xb5\x2f\xfd",
                                "Docker compatibility layer encoding cannot establish its RootFS")
                        media_type = "application/vnd.oci.image.layer.v1.tar+gzip" if magic.startswith(b"\x1f\x8b") else "application/vnd.oci.image.layer.v1.tar+zstd"
                    layers.append({"mediaType": media_type, "digest": layer_digest, "size": files[path].size})
                    used.add(path)
                by_config[config_digest] = (None, {"configDigest": config_digest, "config": config, "paths": paths, "layers": layers})
            if archive_mode == "docker-save-compatibility":
                image = by_config[config_digest][1]
                sources = entry.get("LayerSources")
                require(type(sources) is dict and set(sources) == set(_rootfs(image["config"])), "Exact Docker LayerSources RootFS mapping required")
                for path, diff in zip(image["paths"], _rootfs(image["config"])):
                    require(descriptor(sources[diff], LAYER_TYPES) == path, "Docker LayerSources descriptor differs from ordered layer")
            seen.add(config_digest)
        if archive_mode == "docker-save-compatibility":
            legacy = {}
            for name in sorted(set(files) - used):
                data = raw(name)
                document = decode(data)
                require(type(document) is dict, "Unrooted compatibility metadata is invalid")
                if document.get("mediaType") in MANIFEST_TYPES | {None} and document.get("schemaVersion") == 2 and type(document.get("config")) is dict:
                    config_digest = (document.get("config") or {}).get("digest")
                    require(config_digest in by_config and by_config[config_digest][0] is None,
                            "Unindexed OCI manifest is not a unique selected Docker image")
                    known_types = {node["mediaType"] for node in nodes.values() if node["mediaType"] in MANIFEST_TYPES}
                    require(document.get("mediaType") is not None or len(known_types) == 1, "Unindexed image manifest media type is ambiguous")
                    media_type = document.get("mediaType") or next(iter(known_types))
                    walk(document, "sha256:" + name.rsplit("/", 1)[1], media_type, len(data), 0)
                    value = manifests["sha256:" + name.rsplit("/", 1)[1]]
                    require(value["paths"] == by_config[config_digest][1]["paths"], "Unindexed OCI manifest differs from Docker layer closure")
                    by_config[config_digest] = ("sha256:" + name.rsplit("/", 1)[1], value)
                else:
                    identifier = document.get("id")
                    require(_matches(HASH, identifier) and identifier not in legacy, "Unknown or duplicate unrooted legacy metadata")
                    legacy[identifier] = (document, data)
            _legacy_closure(legacy, by_config)
        require(seen == selected_configs and set(files) == used, "Missing or extra unreachable archive blob")
        blob_names = {name for name in used if _matches(BLOB, name)}
        for name in blob_names - checked:
            with archive.extractfile(files[name]) as stream:
                require(_stream_digest(stream, files[name].size) == name.rsplit("/", 1)[1], "Layer bytes differ from their digest")
        expanded, diff_cache = 0, {}
        for _, value in by_config.values():
            for path, layer, wanted in zip(value["paths"], value["layers"], _rootfs(value["config"])):
                key = (path, layer["mediaType"])
                if key not in diff_cache:
                    if layer["mediaType"].endswith(".tar"):
                        actual = "sha256:" + path.rsplit("/", 1)[1]
                        expanded += files[path].size
                    else:
                        with archive.extractfile(files[path]) as compressed:
                            if layer["mediaType"].endswith(("+gzip", ".gzip")):
                                decoded = gzip.GzipFile(fileobj=compressed, mode="rb")
                            else:
                                try:
                                    from compression.zstd import ZstdFile
                                except ImportError as error:
                                    raise IdentityError("Zstd RootFS verification requires available standard-library support") from error
                                decoded = ZstdFile(compressed, mode="rb")
                            hasher = sha256()
                            with decoded:
                                while chunk := decoded.read(1024**2):
                                    expanded += len(chunk)
                                    require(expanded <= MAX_EXPANDED_BYTES, "Expanded RootFS aggregate exceeds its bound")
                                    hasher.update(chunk)
                            actual = "sha256:" + hasher.hexdigest()
                    require(expanded <= MAX_EXPANDED_BYTES, "Expanded RootFS aggregate exceeds its bound")
                    diff_cache[key] = actual
                require(diff_cache[key] == wanted, "Expanded layer does not match the image RootFS diff ID")
        images = {}
        for role, policy in expected.items():
            manifest_digest, value = by_config[policy["configDigest"]]
            runtime = _runtime(value["config"].get("config"))
            require(runtime["Labels"].get("org.opencontainers.image.revision") == policy["sourceRevision"], "Image source label differs from independent pin")
            _role_metadata(runtime, policy["metadata"])
            candidates = {policy["configDigest"]: {"kind": "config-digest"}}
            if manifest_digest is not None:
                candidates[manifest_digest] = {"kind": "platform-manifest-digest", **nodes[manifest_digest]}
            ancestors = sorted(digest for digest, configs in indexes.items() if configs == {policy["configDigest"]})
            for digest in ancestors:
                candidates[digest] = {"kind": "index-digest", **nodes[digest]}
            images[role] = {"kind": "warpdrive-offline-native-image-identity", "configDigest": policy["configDigest"],
                "manifestDigest": manifest_digest, "indexDigests": ancestors, "sourceRevision": policy["sourceRevision"],
                "platform": "linux/amd64", "runtimeUser": runtime["User"], "rootfsDiffIds": _rootfs(value["config"]),
                "configMetadataSha256": sha256(_canonical(runtime)).hexdigest(), "roleMetadataSha256": sha256(_canonical(policy["metadata"])).hexdigest(),
                "nativeIdentityCandidates": candidates, "deploymentAuthorized": False}
            if len(ancestors) == 1:
                images[role]["indexDigest"] = ancestors[0]
        summary = {"payloadBlobs": {"sha256:" + name.rsplit("/", 1)[1]: files[name].size for name in sorted(blob_names)},
                   "dockerManifestSha256": sha256(compatibility_raw).hexdigest(), "ociLayoutSha256": sha256(layout_raw).hexdigest(),
                   "ociRootConfigDigests": sorted(found), "legacyMetadataBlobsVerified": len(legacy) if archive_mode == "docker-save-compatibility" else 0}
        return images, root_digest, len(blob_names), expanded, summary


def verify_archive(path, *, expected_sha256, expected_bytes, expected_images, archive_mode="strict-oci"):
    path = Path(path)
    require(_matches(HASH, expected_sha256) and type(expected_bytes) is int and 1024 <= expected_bytes <= MAX_ARCHIVE_BYTES,
            "Independent bounded archive SHA-256 and exact byte count required")
    expected = _expectations(expected_images)
    require(archive_mode in {"strict-oci", "docker-save-compatibility"}, "Explicit supported archive graph mode required")
    try:
        with _directory(path.parent) as parent, _opened(parent, path.name, MAX_ARCHIVE_BYTES) as (source, size):
            require(size == expected_bytes and _stream_digest(source, size) == expected_sha256, "Archive differs from independent byte custody pin")
            source.seek(0)
            images, root_digest, blobs, expanded, summary = _graph(source, size, expected, archive_mode)
    except (tarfile.TarError, EOFError, OSError, CandidateError, InputError) as error:
        raise IdentityError("Invalid or inaccessible native image archive") from error
    return {"schemaVersion": 1, "kind": "warpdrive-offline-native-image-graph", "archiveSha256": expected_sha256,
            "archiveBytes": expected_bytes, "archiveIndexDigest": root_digest, "reachableBlobsVerified": blobs,
            "expandedRootfsBytesVerified": expanded, "images": images, "archiveMode": archive_mode, **summary, "deploymentAuthorized": False}


def verify_native_inspection(identity, rows, *, expected_native_id=None):
    require(type(identity) is dict and identity.get("kind") == "warpdrive-offline-native-image-identity"
            and identity.get("deploymentAuthorized") is False and type(rows) is list and len(rows) == 1 and type(rows[0]) is dict,
            "One native inspection and verified archive identity required")
    row = rows[0]
    native = row.get("Id")
    candidates = identity["nativeIdentityCandidates"]
    require(_matches(DIGEST, native) and native in candidates and (expected_native_id is None or native == expected_native_id),
            "Native image ID is not the independently selected archive identity")
    _platform({"os": row.get("Os"), "architecture": row.get("Architecture"), "variant": row.get("Variant")})
    require(row.get("RootFS") == {"Type": "layers", "Layers": identity["rootfsDiffIds"]}, "Native RootFS differs from archive")
    runtime = _runtime(row.get("Config"))
    require(sha256(_canonical(runtime)).hexdigest() == identity["configMetadataSha256"]
            and runtime["Labels"].get("org.opencontainers.image.revision") == identity["sourceRevision"]
            and runtime["User"] == identity["runtimeUser"], "Native image config/source metadata differs from archive")
    descriptor = row.get("Descriptor")
    result = {key: identity[key] for key in ("configDigest", "manifestDigest", "sourceRevision", "platform")}
    if descriptor is not None:
        require(type(descriptor) is dict and descriptor.get("digest") in candidates, "Native Descriptor is detached from selected image graph")
        expected = candidates[descriptor["digest"]]
        require(expected["kind"] != "config-digest" and descriptor.get("mediaType") == expected["mediaType"]
                and type(descriptor.get("size")) is int and descriptor["size"] == expected["size"], "Native Descriptor metadata differs from archive")
        if "platform" in descriptor:
            _platform(descriptor["platform"])
        result["nativeDescriptorDigest"] = descriptor["digest"]
        if expected["kind"] == "index-digest":
            result["indexDigest"] = descriptor["digest"]
    else:
        require(candidates[native]["kind"] == "config-digest", "Manifest/index native IDs require explicit Descriptor readback")
    result.update(nativeImageId=native, nativeImageIdKind=candidates[native]["kind"], deploymentAuthorized=False)
    if candidates[native]["kind"] == "index-digest":
        result["indexDigest"] = native
    elif "indexDigest" in identity:
        result["indexDigest"] = identity["indexDigest"]
    return result
