"""Read-only storage witness for one independently pinned, stopped installed Caddy relay."""

from contextlib import ExitStack
from hashlib import sha256
import os
from pathlib import Path
import re
import stat

from caddy_web_config import ADMIN_SOCKET
from installed_web_relay import (
    ALIAS, AUTOSAVE_FILE, IMAGE, INGRESS, NETWORK_ID, UID, create_document,
)
from recovery import RecoveryError, absolute, document, no_overlap, open_path, require
from web_switch import content_hash


INSTALLED_PRIVATE_ROOT = Path("/root/warpdrive-deployment/private")
STAGE_NAME = re.compile(r"first-web-release-[a-f0-9]{12}\Z")
_ROOT_UID = 0
_ROOT_GID = 0
_RELAY_UID = UID
_RELAY_GID = UID
_AUTOSAVE_LIMIT = 128 * 1024
_TIMESTAMP = re.compile(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z\Z")
_MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def _matches(pattern, value):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def _file_witness(info):
    return [info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def _directory(stack, name, uid, gid, *, parent=None):
    fd = (open_path(name, _DIR_FLAGS) if parent is None else os.open(name, _DIR_FLAGS, dir_fd=parent))
    stack.callback(os.close, fd)
    info = os.fstat(fd)
    require(stat.S_ISDIR(info.st_mode) and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, 0o700),
            "Installed relay directory authority differs")
    return fd, _file_witness(info)


def _exact_members(fd, names, message):
    with os.scandir(fd) as entries:
        require({entry.name for _, entry in zip(range(len(names) + 1), entries)} == names, message)


def _read_autosave(parent):
    name = Path(AUTOSAVE_FILE).name
    with os.fdopen(os.open(name, _FILE_FLAGS, dir_fd=parent), "rb") as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (_RELAY_UID, _RELAY_GID, 0o600)
                and 0 < info.st_size <= _AUTOSAVE_LIMIT, "Exact private relay autosave file required")
        witness = _file_witness(info)
        raw = handle.read(info.st_size + 1)
        require(len(raw) == info.st_size and _file_witness(os.fstat(handle.fileno())) == witness,
                "Relay autosave changed during inspection")
    require(_file_witness(os.stat(name, dir_fd=parent, follow_symlinks=False)) == witness,
            "Relay autosave path changed during inspection")
    return raw, witness


def _validate_relay(row, expected, *, relay_id, alias, ingress_id, manifest):
    require(type(manifest) is dict and set(manifest) == {"mediaType", "digest", "size", "platform"}
            and manifest.get("mediaType") in _MANIFEST_TYPES and _matches(IMAGE, manifest.get("digest"))
            and type(manifest.get("size")) is int and 0 < manifest["size"] <= 128 * 1024
            and manifest.get("platform") == {"os": "linux", "architecture": "amd64"},
            "Exact independently pinned relay image manifest required")
    config, host, state = row["Config"], row["HostConfig"], row["State"]
    require(row.get("Id") == relay_id and row.get("Name") == "/" + alias and row.get("Image") == expected["Image"]
            and row.get("ImageManifestDescriptor") == manifest,
            "Stopped relay identity differs from its pin")
    require(state.get("Status") == "exited" and type(state.get("Pid")) is int and state["Pid"] == 0
            and state.get("Running") is False and type(state.get("ExitCode")) is int and state["ExitCode"] == 0
            and all(state.get(flag) is False for flag in ("OOMKilled", "Paused", "Restarting", "Dead"))
            and not state.get("Error") and _matches(_TIMESTAMP, state.get("StartedAt"))
            and _matches(_TIMESTAMP, state.get("FinishedAt"))
            and type(row.get("RestartCount")) is int and row["RestartCount"] >= 0,
            "Installed relay must be cleanly stopped")
    require(all(config.get(key) == expected[key] for key in ("User", "Entrypoint", "Cmd", "ExposedPorts"))
            and all(config["Labels"].get(key) == value for key, value in expected["Labels"].items())
            and not any(key.startswith(("com.docker.compose.", "traefik.")) and key not in expected["Labels"]
                        for key in config["Labels"])
            and not config.get("Volumes"), "Installed relay startup or ownership differs")
    env = config.get("Env")
    require(type(env) is list and len(env) <= 64 and all(isinstance(line, str) and "=" in line for line in env),
            "Installed relay environment is ambiguous")
    values = dict(line.split("=", 1) for line in env)
    require(len(values) == len(env) and all(line in env for line in expected["Env"])
            and not any(key.startswith("XDG_") and key not in {"XDG_CONFIG_HOME", "XDG_DATA_HOME"} for key in values),
            "Installed relay state environment differs")
    require(all(host.get(key) == value for key, value in expected["HostConfig"].items() if key != "Mounts")
            and host.get("Mounts") == expected["HostConfig"]["Mounts"]
            and not any(host.get(key) for key in ("Privileged", "PublishAllPorts", "PortBindings", "Binds", "VolumesFrom",
                        "UsernsMode", "Devices", "DeviceRequests", "CapAdd", "ExtraHosts", "Dns", "DnsOptions", "DnsSearch", "Links")),
            "Installed relay create or isolation profile differs")
    networks = row["NetworkSettings"]["Networks"]
    require(type(networks) is dict and set(networks) == {INGRESS}, "Installed relay ingress attachment differs")
    endpoint = networks[INGRESS]
    require(endpoint.get("NetworkID") == ingress_id and endpoint.get("Aliases") == [alias],
            "Installed relay ingress identity differs")
    mounts = row.get("Mounts")
    require(type(mounts) is list and len(mounts) == 2
            and all(mount.get("Type") == "bind" and mount.get("RW") is True
                    and mount.get("Propagation") == "rprivate" for mount in mounts)
            and {(mount.get("Source"), mount.get("Destination")) for mount in mounts}
            == {(mount["Source"], mount["Target"]) for mount in expected["HostConfig"]["Mounts"]},
            "Installed relay needs both exact writable binds")


def _check_peer_source(path):
    # Do not open a peer's special-file source, even with O_NONBLOCK. Socket
    # binds such as Traefik's Docker control are valid and do not alias relay data.
    parent = open_path(path.parent, _DIR_FLAGS)
    try:
        info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        visible = path.lstat()
        require(os.path.samestat(info, visible) and (stat.S_ISDIR(info.st_mode) or stat.S_ISSOCK(info.st_mode)
                or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1)), "Unobserved Docker peer source authority")
    finally:
        os.close(parent)


def _reject_shared_binds(other_rows, relay_id, binds):
    require(type(other_rows) in (list, tuple) and len(other_rows) <= 1023, "Bounded Docker peer inventory required")
    seen = {relay_id}
    for row in other_rows:
        identity, mounts = row.get("Id"), row.get("Mounts")
        require(_matches(NETWORK_ID, identity) and identity not in seen and type(mounts) is list and len(mounts) <= 128,
                "Invalid or duplicate Docker peer inventory")
        seen.add(identity)
        for mount in mounts:
            mount_type = mount.get("Type")
            if mount_type == "tmpfs":
                continue
            require(mount_type in {"bind", "volume"}, "Unobserved Docker peer mount authority")
            path = absolute(mount.get("Source"))
            require(all(no_overlap(path, bind) for bind in binds),
                    "Another Docker container can access installed relay storage")
            _check_peer_source(path)


def observe_installed_cold_relay_storage(row, other_rows, relay_directory, *, relay_id, alias, image_id,
                                        ingress_id, manifest, accepted_route_sha256):
    """Return a single autosave root and storage witness from an already held installation.

    The caller owns the installed hold and supplies the full remaining Docker
    inventory plus independently admitted identity, image and accepted route pins.
    Call on each observation while retaining the existing installation locks.
    The mutable socket and temporary directories are never recovery roots.
    A blank stopped ingress ID, extra autosave siblings or socket residue hold
    until the native cold shape or its separately authorized cleanup is proved.
    """
    try:
        relay = absolute(str(relay_directory))
        require(relay.name == "relay" and relay.parent.parent == INSTALLED_PRIVATE_ROOT
                and _matches(STAGE_NAME, relay.parent.name) and _matches(ALIAS, alias)
                and relay.parent.name.endswith(alias.removeprefix("warpdrive-web-relay-"))
                and _matches(NETWORK_ID, relay_id) and _matches(IMAGE, image_id)
                and _matches(NETWORK_ID, ingress_id) and _matches(NETWORK_ID, accepted_route_sha256),
                "Exact installed relay path and independent pins required")
        with ExitStack() as stack:
            private_fd, private = _directory(stack, INSTALLED_PRIVATE_ROOT, _ROOT_UID, _ROOT_GID)
            operation_fd, operation = _directory(stack, relay.parent.name, _ROOT_UID, _ROOT_GID, parent=private_fd)
            relay_fd, relay_info = _directory(stack, relay.name, _ROOT_UID, _ROOT_GID, parent=operation_fd)
            config_fd, config = _directory(stack, "config", _RELAY_UID, _RELAY_GID, parent=relay_fd)
            socket_fd, socket = _directory(stack, "socket", _RELAY_UID, _RELAY_GID, parent=relay_fd)
            caddy_fd, caddy = _directory(stack, "caddy", _RELAY_UID, _RELAY_GID, parent=config_fd)
            expected = create_document(relay, alias=alias, image=image_id, ingress_id=ingress_id)
            _validate_relay(row, expected, relay_id=relay_id, alias=alias, ingress_id=ingress_id, manifest=manifest)
            _reject_shared_binds(other_rows, relay_id, (relay / "config", relay / "socket"))
            _exact_members(config_fd, {"caddy"}, "Unexpected files in private relay configuration bind")
            _exact_members(caddy_fd, {Path(AUTOSAVE_FILE).name}, "Unexpected files in private Caddy configuration directory")
            _exact_members(socket_fd, set(), "Installed relay socket bind must be empty while stopped")
            raw, autosave = _read_autosave(caddy_fd)
            value = document(raw)
            require(type(value) is dict and value.get("admin") == {"listen": f"unix/{ADMIN_SOCKET}|0600",
                    "config": {"persist": True}} and content_hash(value) == accepted_route_sha256,
                    "Installed relay autosave differs from the accepted route")
            for path, witness in ((INSTALLED_PRIVATE_ROOT, private), (relay.parent, operation), (relay, relay_info),
                                  (relay / "config", config), (relay / "socket", socket),
                                  (relay / "config/caddy", caddy), (relay / "config" / AUTOSAVE_FILE, autosave)):
                descriptor = open_path(path)
                try:
                    require(_file_witness(os.fstat(descriptor)) == witness,
                            "Installed relay storage changed during inspection")
                finally:
                    os.close(descriptor)
            return {"root": str(relay / "config" / AUTOSAVE_FILE), "excludedSocketDirectory": str(relay / "socket"),
                    "witness": {"relayId": relay_id, "alias": alias, "imageId": image_id,
                                "imageManifest": manifest.copy(), "ingressId": ingress_id, "acceptedRouteSha256": accepted_route_sha256,
                                "createProfileSha256": content_hash(expected), "autosaveSha256": sha256(raw).hexdigest(),
                                "autosave": autosave, "socket": socket, "config": config, "caddy": caddy,
                                "relay": relay_info, "operation": operation, "private": private,
                                "startedAt": row["State"]["StartedAt"], "finishedAt": row["State"]["FinishedAt"],
                                "restartCount": row["RestartCount"]}}
    except (AttributeError, KeyError, OSError, TypeError, ValueError, RecursionError) as error:
        raise RecoveryError("Installed cold relay storage could not be admitted") from error
