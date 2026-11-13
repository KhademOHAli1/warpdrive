"""Read-only stop witness for the two accepted private installed Web slots."""

import calendar
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
from ipaddress import IPv4Address, IPv4Interface
import os
from pathlib import Path
import re
import stat
from urllib.parse import parse_qsl, urlsplit

from installed_web_runtime import ALIAS, DATABASE, ID, NETWORKS, NO_OWNER_ENV, installed_profile, verify_candidate
from installed_web_successor import _document
from recovery import RecoveryError, absolute, open_path, require
from web_switch import SwitchError, _route, _runtime, content_hash


INSTALLED_ROOT = Path("/root/warpdrive-deployment")
SECRET_UID = 1000
_SLOTS = {"active", "previous"}
_MEDIA_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
_TIME = re.compile(r"(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z\Z")
_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}\Z")
_DB_NAME = re.compile(r"[a-z][a-z0-9_]{0,62}\Z")
_FORBIDDEN_DATABASE_ENV_PREFIXES = ("PG", "DATABASE_", "MIGRATION_")
_DSN_OPTIONS = {
    "sslmode": re.compile(r"disable|allow|prefer|require|verify-ca|verify-full"),
    "application_name": re.compile(r"[a-zA-Z0-9_.-]{1,64}"),
    "connect_timeout": re.compile(r"[1-9]|[1-5][0-9]|60"),
}
_FILE_INPUTS = {
    "DATABASE_URL": "database_url",
    "AUTH_SECRET": "auth_secret",
    "GOOGLE_OAUTH_CLIENT_SECRET": "google_oauth_client_secret",
    "MINIO_SECRET_KEY": "storage_app_secret",
    "TOKEN_ENCRYPTION_KEY": "token_encryption_key",
    "WS_TICKET_SECRET": "ws_ticket_secret",
}


def _matches(pattern, value):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def _timestamp(value):
    match = _TIME.fullmatch(value) if isinstance(value, str) else None
    require(match is not None, "Exact Web process time required")
    stamp, fraction = match.groups()
    return calendar.timegm(datetime.fromisoformat(stamp).timetuple()) * 10**9 + int((fraction or "").ljust(9, "0"))


def _metadata(info):
    return [info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def _read_bounded(path, maximum, *, private=None):
    with os.fdopen(open_path(path), "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 < info.st_size <= maximum,
                "Exact bounded installed Web file required")
        if private is not None:
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == private,
                    "Exact private Web secret file required")
        raw = source.read(info.st_size + 1)
        witness = _metadata(info)
        require(len(raw) == info.st_size and witness == _metadata(os.fstat(source.fileno())) == _metadata(path.lstat()),
                "Private Web secret changed during readback")
    return raw, {"path": str(path), "metadata": witness, "sha256": sha256(raw).hexdigest()}


def _read_secret(path, group, mode):
    return _read_bounded(path, 16 * 1024, private=(SECRET_UID, group, mode))


def _resolver_witness(row):
    paths = {key: absolute(row.get(key)) for key in ("HostsPath", "ResolvConfPath")}
    require(len(set(paths.values())) == 2, "Web resolver files are ambiguous")
    result = {}
    for key, path in paths.items():
        raw, witness = _read_bounded(path, 64 * 1024)
        require(all(byte in {9, 10, 13} or 32 <= byte < 127 for byte in raw), "Web resolver file encoding is unobserved")
        rows = [line.split("#", 1)[0].split() for line in raw.decode("ascii").splitlines()]
        if key == "HostsPath":
            require(not any("postgres" in {value.rstrip(".").casefold() for value in fields[1:]} for fields in rows),
                    "Web hosts file overrides the private database alias")
        else:
            require({fields[1] for fields in rows if len(fields) >= 2 and fields[0] == "nameserver"} == {"127.0.0.11"},
                    "Web must use the observed Docker resolver")
        # Docker may rewrite its own runtime hosts/resolver files at stop. The
        # paths remain pinned and both observed contents must pass admission.
        result[key] = {"path": witness["path"], "sha256": witness["sha256"]}
    return result


def _secret_witness(profile, runtime_secret, database_role, database_name):
    values, mounts = profile["environment"], profile["mounts"]
    require(not any(values.get(key) for key in NO_OWNER_ENV)
            and not any(value and (key.startswith(_FORBIDDEN_DATABASE_ENV_PREFIXES)
                                  and key != "DATABASE_URL_FILE") for key, value in values.items()),
            "Web may only derive database authority from its pinned runtime secret")
    mounted = {mount["Target"]: mount["Source"] for mount in mounts}
    for key, value in values.items():
        if key.endswith("_FILE") and value:
            require(key.removesuffix("_FILE") in _FILE_INPUTS, "Unsupported Web secret file override")
    require(runtime_secret.is_relative_to(INSTALLED_ROOT / "private")
            and runtime_secret.name == "runtime-database-url" and runtime_secret.parent != INSTALLED_ROOT / "private",
            "Runtime database secret is outside installed private authority")
    found = {}
    for variable, filename in _FILE_INPUTS.items():
        target = "/run/secrets/" + filename
        require(not values.get(variable) and values.get(variable + "_FILE") == target,
                "Web secret does not use its exact restricted bind authority")
        path = absolute(mounted[target])
        storage = filename == "storage_app_secret"
        expected = runtime_secret if target == DATABASE else INSTALLED_ROOT / "exported-secrets" / filename
        require(path == expected, "Web secret source is outside its exact installed path")
        raw, found[filename] = _read_secret(path, 0 if storage else SECRET_UID, 0o440 if storage else 0o400)
        if target == DATABASE:
            text = raw.decode("utf-8").rstrip("\n")
            require(text and all(32 < ord(char) < 127 for char in text), "Invalid private database connection input")
            dsn = urlsplit(text)
            query = parse_qsl(dsn.query, keep_blank_values=True, strict_parsing=True, max_num_fields=3)
            require(dsn.scheme in {"postgres", "postgresql"} and dsn.netloc.rsplit("@", 1)[-1] in {"postgres", "postgres:5432"}
                    and dsn.username == database_role and bool(dsn.password) and dsn.path == "/" + database_name
                    and "#" not in text and all(key in _DSN_OPTIONS and _matches(_DSN_OPTIONS[key], option) for key, option in query)
                    and len({key for key, _ in query}) == len(query),
                    "Private Web database connection differs from the admitted role or bridge")
    return found


def _chain_runtime(chain, pin):
    require(type(chain) is dict and chain.get("targetKey") == "pitant-warpdrive" and _matches(ID, pin)
            and content_hash(chain) == pin, "Exact admitted installed Web chain required")
    result = {}
    for side in sorted(_SLOTS):
        item = chain[side]
        slot, alias = item["slot"], item["alias"]
        runtime, route = slot["runtime"], slot["route"]
        _runtime(runtime)
        _route(route)
        require(_matches(ALIAS, alias) and runtime["name"] == alias and route["runtimeId"] == runtime["runtimeId"]
                and route["generation"] == "wd-" + runtime["sourceRevision"], "Private Web chain runtime differs")
        result[side] = runtime
    require(all(result["active"][key] != result["previous"][key] for key in ("runtimeId", "name", "imageId", "sourceRevision"))
            and result["active"]["schemaSha256"] == result["previous"]["schemaSha256"],
            "Both Web slots must be distinct and share the accepted schema")
    return result


def _observe_rows(rows, *, chain, chain_sha256, network_ids, runtime_secret, database_role, database_name, cold):
    require(type(rows) is dict and set(rows) == _SLOTS and type(network_ids) is dict and set(network_ids) == set(NETWORKS)
            and all(_matches(ID, identifier) for identifier in network_ids.values()) and len(set(network_ids.values())) == 2
            and _matches(_DB_NAME, database_role) and _matches(_DB_NAME, database_name) and database_role != "postgres",
            "Exact installed slot and private database pins required")
    runtimes = _chain_runtime(chain, chain_sha256)
    runtime_secret = absolute(str(runtime_secret))
    found, endpoints = {}, {}
    for side, runtime in runtimes.items():
        row, alias = rows[side], runtime["name"]
        profile = installed_profile(row, image_id=runtime["imageId"], revision=runtime["sourceRevision"],
                                    network_ids=network_ids, runtime_secret=str(runtime_secret))
        expected = _document(profile, image=runtime["imageId"], revision=runtime["sourceRevision"], alias=alias)
        observed = verify_candidate(row, expected, alias=alias, network_ids=network_ids, runtime_secret=str(runtime_secret),
                                    require_ready=not cold)
        require({**observed, "schemaSha256": runtime["schemaSha256"]} == {**runtime, "running": not cold}
                and observed["running"] is (not cold), "Installed Web static runtime changed")
        host, state, manifest = row["HostConfig"], row["State"], row["ImageManifestDescriptor"]
        require(type(manifest) is dict and manifest.get("digest") == runtime["imageId"]
                and manifest.get("platform") == {"os": "linux", "architecture": "amd64"}
                and manifest.get("mediaType") in _MEDIA_TYPES and type(manifest.get("size")) is int
                and 0 < manifest["size"] <= 128 * 1024, "Exact native Web image manifest required")
        require(not any(host.get(key) for key in ("Dns", "DnsOptions", "DnsSearch", "UsernsMode", "DeviceRequests"))
                and host.get("PidMode") in (None, "", "private"), "Web slot has alternate network or host authority")
        require(state.get("Dead") is False and not state.get("Error"), "Installed Web state is not stable")
        started = _timestamp(state.get("StartedAt"))
        require(type(state.get("Pid")) is int and (state["Pid"] == 0 if cold else state["Pid"] > 1),
                "Installed Web process identity differs")
        if cold:
            require(state.get("Status") == "exited" and type(state.get("ExitCode")) is int and state["ExitCode"] == 0
                    and _timestamp(state.get("FinishedAt")) >= started, "Installed Web slot did not stop cleanly")
        found[side] = {"runtimeId": row["Id"], "alias": alias, "startedAt": state["StartedAt"],
                       "restartCount": row["RestartCount"], "imageManifest": deepcopy(manifest),
                       "nativeConfigSha256": content_hash({"config": row["Config"], "host": host,
                                                            "mounts": sorted(row["Mounts"], key=lambda item: item["Destination"])}),
                       "secrets": _secret_witness(profile, runtime_secret, database_role, database_name),
                       "resolver": _resolver_witness(row)}
        endpoints[side] = {name: dict(endpoint) for name, endpoint in row["NetworkSettings"]["Networks"].items()}
    require(found["active"]["secrets"] == found["previous"]["secrets"], "Accepted Web slots have different secrets authority")
    return found, endpoints


def _network_witness(networks, network_ids, endpoints, slots, *, cold):
    require(type(networks) is dict and set(networks) == set(NETWORKS), "Both installed Web bridge objects required")
    result = {}
    for name in NETWORKS:
        network = networks[name]
        require(network.get("Id") == network_ids[name] and network.get("Name") == name
                and network.get("Driver") == "bridge" and network.get("Scope") == "local",
                "Installed Web bridge authority differs")
        members = network.get("Containers")
        require(type(members) is dict and len(members) <= 32 and all(_matches(ID, identifier) for identifier in members),
                "Unknown installed Web bridge membership")
        config = {key: network.get(key) for key in ("Id", "Name", "Driver", "Scope", "Internal", "Labels", "IPAM", "Options")}
        live = {}
        for side, slot in slots.items():
            identifier, alias, endpoint = slot["runtimeId"], slot["alias"], endpoints[side][name]
            dns = endpoint.get("DNSNames") or []
            require(type(dns) is list and len(dns) <= 2 and set(dns) <= {alias, identifier[:12]},
                    "Private Web slot has an alternate DNS alias")
            for peer_id, item in members.items():
                peer_name = item.get("Name")
                require(_matches(_NAME, peer_name) and (peer_name.casefold() != alias or peer_id == identifier),
                        "Installed Web bridge alias has a competing peer")
            if cold:
                require(identifier not in members and endpoint.get("EndpointID") == "" and endpoint.get("IPAddress") == ""
                        and not endpoint.get("GlobalIPv6Address"), "Cold Web slot retains a live network endpoint")
                continue
            member = members[identifier]
            address = IPv4Address(endpoint["IPAddress"])
            require(address.is_private and IPv4Interface(member["IPv4Address"]).ip == address and member.get("Name") == alias
                    and _matches(ID, endpoint.get("EndpointID")) and member.get("EndpointID") == endpoint["EndpointID"],
                    "Running Web bridge member differs from its endpoint")
            live[side] = {"networkId": network_ids[name], "endpointId": endpoint["EndpointID"], "ipv4": str(address)}
        if not cold:
            require(all(live["active"][key] != live["previous"][key] for key in ("endpointId", "ipv4")),
                    "Both Web slots must have distinct live bridge endpoints")
        result[name] = {"configurationSha256": content_hash(config), "slots": live}
    return result


def observe_installed_web_slots_before_stop(rows, networks, *, chain, chain_sha256, network_ids,
                                            runtime_secret, database_role, database_name):
    """Capture private pre-stop facts for independent pinning by the hold controller."""
    try:
        slots, endpoints = _observe_rows(rows, chain=chain, chain_sha256=chain_sha256, network_ids=network_ids,
                                        runtime_secret=runtime_secret, database_role=database_role, database_name=database_name,
                                        cold=False)
        return {"schemaVersion": 1, "kind": "installed-web-before-stop", "chainSha256": chain_sha256,
                "databaseRole": database_role, "databaseName": database_name,
                "slots": {side: {**slot, "pid": rows[side]["State"]["Pid"]} for side, slot in slots.items()},
                "bridges": _network_witness(networks, network_ids, endpoints, slots, cold=False)}
    except (AttributeError, KeyError, OSError, TypeError, ValueError, RecursionError, SwitchError) as error:
        raise RecoveryError("Running installed Web stop witness could not be admitted") from error


def observe_installed_cold_web_slots(rows, networks, *, chain, chain_sha256, before_stop, before_stop_sha256,
                                     network_ids, runtime_secret, database_role, database_name):
    """Read the exact two cold slots under an external hold, without modifying the installation.

    The caller retains the shared installed locks and independently admits all
    relevant Docker rows, resolves competing aliases and keeps other writers
    stopped. A missing native NetworkID or a nonzero exit deliberately holds.
    """
    try:
        require(type(before_stop) is dict and set(before_stop) == {"schemaVersion", "kind", "chainSha256", "databaseRole",
                "databaseName", "slots", "bridges"} and type(before_stop["schemaVersion"]) is int
                and before_stop["schemaVersion"] == 1 and before_stop["kind"] == "installed-web-before-stop"
                and before_stop["chainSha256"] == chain_sha256 and before_stop["databaseRole"] == database_role
                and before_stop["databaseName"] == database_name and _matches(ID, before_stop_sha256)
                and content_hash(before_stop) == before_stop_sha256, "Exact independently pinned Web stop witness required")
        slots, endpoints = _observe_rows(rows, chain=chain, chain_sha256=chain_sha256, network_ids=network_ids,
                                        runtime_secret=runtime_secret, database_role=database_role, database_name=database_name,
                                        cold=True)
        current = _network_witness(networks, network_ids, endpoints, slots, cold=True)
        require(type(before_stop["slots"]) is dict and set(before_stop["slots"]) == _SLOTS
                and type(before_stop["bridges"]) is dict and set(before_stop["bridges"]) == set(NETWORKS),
                "Incomplete Web stop witness")
        for name, network in current.items():
            previous = before_stop["bridges"][name]
            require(type(previous) is dict and set(previous) == {"configurationSha256", "slots"}
                    and previous["configurationSha256"] == network["configurationSha256"]
                    and type(previous["slots"]) is dict and set(previous["slots"]) == _SLOTS,
                    "Installed Web bridge changed after stop")
            for endpoint in previous["slots"].values():
                require(type(endpoint) is dict and set(endpoint) == {"networkId", "endpointId", "ipv4"}
                        and endpoint["networkId"] == network_ids[name] and _matches(ID, endpoint["endpointId"])
                        and IPv4Address(endpoint["ipv4"]).is_private, "Incomplete installed Web pre-stop bridge endpoint")
        for side, slot in slots.items():
            previous = before_stop["slots"][side]
            resolver = previous["resolver"]
            require(type(resolver) is dict and set(resolver) == set(slot["resolver"])
                    and all(type(item) is dict and set(item) == {"path", "sha256"} and _matches(ID, item["sha256"])
                            and item["path"] == slot["resolver"][key]["path"] for key, item in resolver.items()),
                    "Installed Web resolver path authority changed after stop")
            require(type(previous) is dict and type(previous.get("pid")) is int and previous["pid"] > 1
                    and previous == {**slot, "pid": previous["pid"], "resolver": resolver},
                    "Installed Web runtime, secret or start identity changed after hold")
            slot["finishedAt"] = rows[side]["State"]["FinishedAt"]
        return {"roots": sorted(item["path"] for item in slots["active"]["secrets"].values()),
                "witness": {"chainSha256": chain_sha256, "beforeStopSha256": before_stop_sha256,
                            "slots": slots, "bridges": current}}
    except (AttributeError, KeyError, OSError, TypeError, ValueError, RecursionError, SwitchError) as error:
        raise RecoveryError("Stopped installed Web slots could not be admitted") from error
