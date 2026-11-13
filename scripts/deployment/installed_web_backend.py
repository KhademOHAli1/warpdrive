"""Bracket an installed Web operation with exact protected Docker witnesses."""
from __future__ import annotations

from hashlib import sha256
from http.client import HTTPException, parse_headers
from io import BytesIO
from ipaddress import IPv4Address, IPv4Interface, IPv4Network
from pathlib import PurePosixPath
import re
import socket
import time
from urllib.parse import parse_qsl, urlsplit

from component_inputs import decode
from installed_docker import DockerNativeError
from installed_web_runtime import ID, IMAGE, NETWORKS, REVISION, WebRuntimeError, environment, require
from installed_web_schema import read_schema
from web_switch import content_hash


RUNNING = {"edge", "postgres", "storage", "worker", "realtime"}
COMPONENTS = RUNNING | {"migrator"}
_CORE_PORT = 3010
_CORE_COMMAND = ["bun", "--no-env-file", "dist/core-api.mjs"]
_CORE_PIN = {"id", "name", "imageReference", "imageId", "imageConfigDigest", "manifest", "manifestJson",
             "sourceRevision", "project", "pid", "startedAt", "restartCount", "configSha256", "ingress", "database"}
_CORE_ENDPOINT = {"networkId", "endpointId", "ipv4"}
_CORE_NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,62}\Z")
_ALIAS = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
_IMAGE_REFERENCE = re.compile(r"[a-z0-9.-]+(?::[0-9]{1,5})?(?:/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}\Z")
_MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
_CONFIG_TYPES = {"application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"}
_NATIVE_PLATFORM = {"os": "linux", "architecture": "amd64"}
_PRIVATE_RANGES = tuple(IPv4Network(item) for item in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
_PROBE_SECONDS = 3
_PROBE_MAX = 8192


def process_witness(row, *, running):
    state = row["State"]
    require(ID.fullmatch(row["Id"]) and state["Running"] is running and not state["OOMKilled"]
            and not state["Restarting"] and not state["Paused"]
            and state["Status"] == ("running" if running else "exited")
            and (running or state["ExitCode"] == 0), "Protected installed process state differs")
    labels = row["Config"].get("Labels") or {}
    config_hash = content_hash({"config": row["Config"], "host": row["HostConfig"],
                                "mounts": sorted(row["Mounts"], key=lambda mount: mount["Destination"])})
    return {"id": row["Id"], "name": row["Name"], "imageId": row["Image"], "pid": state["Pid"],
            "startedAt": state["StartedAt"], "finishedAt": state["FinishedAt"], "restartCount": row["RestartCount"],
            "configSha256": config_hash, "project": labels.get("com.docker.compose.project"),
            "service": labels.get("com.docker.compose.service")}


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _private_ipv4(value):
    require(isinstance(value, str), "Exact private Core IPv4 address required")
    address = IPv4Address(value)
    require(str(address) == value and any(address in network for network in _PRIVATE_RANGES),
            "Exact private Core IPv4 address required")
    return value


def _core_manifest(pin):
    manifest = pin["manifest"]
    raw = pin["manifestJson"]
    require(type(manifest) is dict and set(manifest) == {"mediaType", "digest", "size", "platform"}
            and manifest["mediaType"] in _MANIFEST_TYPES and manifest["platform"] == _NATIVE_PLATFORM
            and _matches(IMAGE, manifest["digest"]) and type(manifest["size"]) is int
            and isinstance(raw, str) and 0 < len(raw) <= 128 * 1024,
            "Exact native Core platform manifest required")
    payload = raw.encode("utf-8")
    require(len(payload) == manifest["size"] <= 128 * 1024
            and "sha256:" + sha256(payload).hexdigest() == manifest["digest"]
            and pin["imageReference"].endswith("@" + manifest["digest"]),
            "Core manifest bytes differ from the independent image reference")
    value = decode(payload)
    require(type(value) is dict and value.get("schemaVersion") == 2
            and value.get("mediaType", manifest["mediaType"]) == manifest["mediaType"]
            and not ({"artifactType", "subject"} & value.keys()), "Core OCI manifest differs from the native image")
    config = value.get("config")
    require(type(config) is dict and config.get("mediaType") in _CONFIG_TYPES
            and config.get("digest") == pin["imageConfigDigest"]
            and type(config.get("size")) is int and config["size"] > 0 and not ({"urls", "data"} & config.keys())
            and pin["imageId"] == manifest["digest"],
            "Core image config digest differs from the admitted manifest")
    return manifest


def _validate_core_pin(pin, postgres_id):
    require(type(pin) is dict and set(pin) == _CORE_PIN and _matches(ID, postgres_id)
            and _matches(ID, pin["id"]) and pin["id"] != postgres_id
            and isinstance(pin["name"], str) and pin["name"].startswith("/")
            and _matches(_CORE_NAME, pin["name"][1:]) and _matches(_CORE_NAME, pin["project"])
            and _matches(_IMAGE_REFERENCE, pin["imageReference"]) and len(pin["imageReference"]) <= 255
            and all(_matches(IMAGE, pin[key]) for key in ("imageId", "imageConfigDigest"))
            and _matches(REVISION, pin["sourceRevision"]) and _matches(ID, pin["configSha256"])
            and type(pin["pid"]) is int and pin["pid"] > 1 and isinstance(pin["startedAt"], str)
            and 0 < len(pin["startedAt"]) <= 64 and type(pin["restartCount"]) is int and pin["restartCount"] >= 0,
            "Exact independently pinned Core process and image required")
    for kind in ("ingress", "database"):
        endpoint = pin[kind]
        fields = _CORE_ENDPOINT | ({"alias"} if kind == "ingress" else set())
        require(type(endpoint) is dict and set(endpoint) == fields
                and all(_matches(ID, endpoint[key]) for key in ("networkId", "endpointId")),
                "Exact Core ingress and database endpoints required")
        _private_ipv4(endpoint["ipv4"])
    ingress, database = pin["ingress"], pin["database"]
    require(all(ingress[key] != database[key] for key in _CORE_ENDPOINT) and _matches(_ALIAS, ingress["alias"])
            and ingress["alias"] not in {"localhost", "app", "postgres", "ws", "worker", "minio", "newsletter-engine", "traefik"},
            "Distinct private Core endpoints and route alias required")
    return _core_manifest(pin)


def _network_aliases(endpoint):
    aliases = []
    for name in ("Aliases", "DNSNames"):
        values = endpoint.get(name) or []
        require(type(values) is list and len(values) <= 32
                and all(isinstance(value, str) and value.isascii() and 0 < len(value) <= 255 for value in values),
                "Bounded Docker endpoint aliases required")
        aliases.extend(value.lower().rstrip(".") for value in values)
    return set(aliases)


def _endpoint_aliases(member, endpoint):
    return _network_aliases(endpoint) | {member["Name"][1:].lower().rstrip(".")}


def _core_endpoint(docker, row, kind, pin, postgres_id):
    name = NETWORKS[0 if kind == "ingress" else 1]
    expected = pin[kind]
    network = docker.network(expected["networkId"])
    members = network["Containers"]
    require(network["Name"] == name and network["Id"] == expected["networkId"]
            and network["Driver"] == "bridge" and network["Scope"] == "local"
            and type(members) is dict and 2 <= len(members) <= 20 and row["Id"] in members
            and (kind == "ingress" or postgres_id in members), "Exact bounded Core network inventory required")
    addresses, endpoints = set(), set()
    selected_alias, selected_id = (expected["alias"], row["Id"]) if kind == "ingress" else ("postgres", postgres_id)
    alias_owners = []
    for identifier, item in members.items():
        require(_matches(ID, identifier) and type(item) is dict and _matches(ID, item.get("EndpointID")),
                "Exact Docker network peer identity required")
        address = _private_ipv4(str(IPv4Interface(item["IPv4Address"]).ip))
        require(address not in addresses and item["EndpointID"] not in endpoints,
                "Core network has an ambiguous address or endpoint owner")
        addresses.add(address)
        endpoints.add(item["EndpointID"])
        member = row if identifier == row["Id"] else docker.inspect(identifier)
        endpoint = member["NetworkSettings"]["Networks"][name]
        require(member["Id"] == identifier and member["Name"] == "/" + item["Name"]
                and endpoint["NetworkID"] == expected["networkId"] and endpoint["EndpointID"] == item["EndpointID"]
                and endpoint["IPAddress"] == address, "Docker network inventory and live endpoint disagree")
        if selected_alias in _endpoint_aliases(member, endpoint):
            alias_owners.append(identifier)
        if identifier == row["Id"]:
            require(address == expected["ipv4"] and item["EndpointID"] == expected["endpointId"],
                    "Live Core endpoint differs from its independent pin")
    require(alias_owners == [selected_id], "Core network alias has ambiguous or missing ownership")
    return dict(expected)


def _core_runtime(docker, pin, postgres_id, manifest):
    row = docker.inspect(pin["id"])
    witness = process_witness(row, running=True)
    require(all(witness[key] == pin[key] for key in (
        "id", "name", "imageId", "pid", "startedAt", "restartCount", "configSha256", "project",
    )) and witness["service"] == "core-api" and row.get("ImageManifestDescriptor") == manifest,
        "Retained Core process or platform manifest changed")
    image = docker.request("GET", f"/images/{manifest['digest']}/json?manifests=true")
    require(image["Id"] == pin["imageId"] and image["Os"] == "linux" and image["Architecture"] == "amd64"
            and all(image["Descriptor"][key] == manifest[key] for key in ("digest", "mediaType", "size")),
            "Docker does not attest the admitted retained Core image")
    config, host, settings = row["Config"], row["HostConfig"], row["NetworkSettings"]
    values = environment(config)
    labels = config["Labels"]
    require(config["Image"] == pin["imageReference"] and config["WorkingDir"] == "/app"
            and config["Cmd"] == image["Config"]["Cmd"] == _CORE_COMMAND
            and config["Entrypoint"] == image["Config"]["Entrypoint"]
            and config["User"] == image["Config"]["User"] and config["User"] in {"bun", "1000:1000"}
            and labels.get("org.opencontainers.image.revision") == pin["sourceRevision"]
            and image["Config"]["Labels"].get("org.opencontainers.image.revision") == pin["sourceRevision"]
            and labels.get("traefik.enable") == "false"
            and all(key == "traefik.enable" for key in labels if key.startswith("traefik."))
            and values.get("APP_COMMIT") == pin["sourceRevision"] and values.get("NODE_ENV") == "production"
            and values.get("RUNTIME_COMPONENT") == "core-api" and values.get("CORE_PORT") == str(_CORE_PORT)
            and values.get("CORE_HOST") == "0.0.0.0"
            and not any(values.get(key) for key in ("MIGRATION_DATABASE_URL", "MIGRATION_DATABASE_URL_FILE",
                                                    "POSTGRES_PASSWORD", "POSTGRES_PASSWORD_FILE")),
            "Core runtime role, command or source differs from the admitted image")
    ports = settings.get("Ports") or {}
    require(type(ports) is dict and set(ports) <= {f"{_CORE_PORT}/tcp"}
            and all(binding in (None, []) for binding in ports.values())
            and config.get("ExposedPorts") == {f"{_CORE_PORT}/tcp": {}}
            and set(settings["Networks"]) == set(NETWORKS)
            and host.get("NetworkMode") in set(NETWORKS) | {pin["ingress"]["networkId"], pin["database"]["networkId"]}
            and host.get("PidMode") in (None, "", "private") and host.get("IpcMode") in (None, "", "private")
            and host.get("ReadonlyRootfs") is True and host.get("CapDrop") == ["ALL"] and host.get("Init") is True
            and host.get("SecurityOpt") in (["no-new-privileges:true"], ["no-new-privileges=true"])
            and type(config.get("StopTimeout")) is int and 60 < config["StopTimeout"] <= 180
            and not any(host.get(key) for key in ("Privileged", "PortBindings", "PublishAllPorts", "CapAdd", "Devices",
                                                  "DeviceRequests", "VolumesFrom", "ExtraHosts", "Links", "Dns",
                                                  "DnsOptions", "DnsSearch")),
            "Retained Core has a published port, unexpected network or host authority")
    mounts = row["Mounts"]
    require(type(mounts) is list and len(mounts) <= 32 and not config.get("Volumes"),
            "Bounded private Core mounts required")
    targets = set()
    for mount in mounts:
        target = PurePosixPath(mount["Destination"])
        require(mount["Type"] == "bind" and mount["RW"] is False and mount["Propagation"] == "rprivate"
                and str(target) == mount["Destination"] and target.parent == PurePosixPath("/run/secrets")
                and str(target) not in targets, "Retained Core has an unsupported or writable mount")
        targets.add(str(target))
    dsn, dsn_file = values.get("DATABASE_URL", ""), values.get("DATABASE_URL_FILE", "")
    require((bool(dsn) != bool(dsn_file)) and (not dsn_file or dsn_file in targets),
            "Retained Core database configuration is ambiguous")
    if dsn:
        database = urlsplit(dsn)
        options = parse_qsl(database.query, strict_parsing=True, keep_blank_values=True)
        require(database.scheme in ("postgres", "postgresql") and database.hostname == "postgres"
                and database.port in (None, 5432) and bool(database.username) and len(database.path) > 1
                and not database.fragment and all(key in ("sslmode", "sslnegotiation") for key, _ in options)
                and len({key for key, _ in options}) == len(options),
                "Core database authority differs from the admitted private bridge")
    return {**witness, "imageReference": pin["imageReference"], "imageConfigDigest": pin["imageConfigDigest"],
            "manifest": dict(manifest), "sourceRevision": pin["sourceRevision"],
            **{kind: _core_endpoint(docker, row, kind, pin, postgres_id) for kind in ("ingress", "database")}}


def read_direct_core(address):
    """Check the exact private readiness endpoint within one socket and byte budget."""
    address = _private_ipv4(address)
    deadline = time.monotonic() + _PROBE_SECONDS
    raw = bytearray()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            connection.settimeout(_PROBE_SECONDS)
            connection.connect((address, _CORE_PORT))
            connection.settimeout(max(0.001, deadline - time.monotonic()))
            connection.sendall(f"GET /readyz HTTP/1.1\r\nHost: {address}:{_CORE_PORT}\r\nConnection: close\r\n"
                               "Accept-Encoding: identity\r\n\r\n".encode("ascii"))
            while len(raw) <= _PROBE_MAX and time.monotonic() < deadline:
                connection.settimeout(max(0.001, deadline - time.monotonic()))
                part = connection.recv(min(1024, _PROBE_MAX + 1 - len(raw)))
                if not part:
                    break
                raw.extend(part)
            else:
                return False
        head, boundary, body = bytes(raw).partition(b"\r\n\r\n")
        status, separator, headers = head.partition(b"\r\n")
        if not boundary or not separator or re.fullmatch(rb"HTTP/1\.[01] 200 [\x20-\x7e]{0,64}", status) is None:
            return False
        parsed = parse_headers(BytesIO(headers + b"\r\n\r\n"))
        return (not parsed.defects and parsed.get_all("Content-Type") == ["text/plain; charset=utf-8"]
                and parsed.get_all("Cache-Control") == ["no-store"] and parsed.get_all("Content-Length") == ["2"]
                and parsed.get_all("Transfer-Encoding") is None
                and parsed.get_all("Content-Encoding") in (None, ["identity"]) and body == b"OK")
    except (OSError, HTTPException, ValueError):
        return False


def observe_retained_core(docker, pin, *, postgres_id, probe=read_direct_core):
    """Require the same independent Core identity on both sides of a direct probe."""
    try:
        manifest = _validate_core_pin(pin, postgres_id)
        before = _core_runtime(docker, pin, postgres_id, manifest)
        require(probe(before["ingress"]["ipv4"]) is True, "Exact private Core readiness is unavailable")
        after = _core_runtime(docker, pin, postgres_id, manifest)
        require(before == after, "Retained Core changed during direct readiness")
        return before
    except WebRuntimeError:
        raise
    except (AttributeError, DockerNativeError, KeyError, OSError, TypeError, ValueError):
        raise WebRuntimeError("Malformed or unavailable retained Core readback") from None


def observe_backend(docker, pins, *, schema_reader=read_schema, core_pin=None, core_probe=read_direct_core):
    require(set(pins) == COMPONENTS and all(ID.fullmatch(row["id"]) for row in pins.values())
            and len({row["id"] for row in pins.values()}) == len(COMPONENTS),
            "All protected backend and ingress identities must be independently pinned")
    witnesses = {}
    for component in sorted(pins):
        pin = pins[component]
        observed = process_witness(docker.inspect(pin["id"]), running=component in RUNNING)
        require(all(observed.get(name) == value for name, value in pin.items()),
                "An independently pinned installed process changed")
        witnesses[component] = observed
    if core_pin is not None:
        require(type(core_pin) is dict and core_pin.get("id") not in {row["id"] for row in pins.values()},
                "Retained Core must be distinct from the original protected components")
        witnesses["core"] = observe_retained_core(docker, core_pin, postgres_id=witnesses["postgres"]["id"],
                                                  probe=core_probe)
    schema_sha = schema_reader(witnesses["postgres"]["id"])
    return {"schemaSha256": schema_sha, "processes": witnesses,
            "backendFingerprint": content_hash({"schemaSha256": schema_sha, "processes": witnesses})}
