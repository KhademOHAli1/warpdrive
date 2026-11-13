"""Build and observe the private, restartable Caddy Web relay profile."""
from __future__ import annotations

import json
import os
import re
import stat

from caddy_web_config import ADMIN_SOCKET
from component_inputs import decode
from installed_web_runtime import require
from web_switch import content_hash


UID = 10001
PORT = 8080
INGRESS = "pitant-warpdrive-ingress"
OWNER_LABEL = "warpdrive.private-ingress.operation"
ALIAS = re.compile(r"warpdrive-web-relay-[a-f0-9]{12}\Z")
IMAGE = re.compile(r"sha256:[a-f0-9]{64}\Z")
NETWORK_ID = re.compile(r"[a-f0-9]{64}\Z")
SOCKET_DIR = "/run/warpdrive-admin"
AUTOSAVE_DIR = "/var/lib/warpdrive-caddy"
AUTOSAVE_FILE = "caddy/autosave.json"
START = ("umask 077; test -s /var/lib/warpdrive-caddy/caddy/autosave.json; "
         "cp /usr/bin/caddy /run/warpdrive/caddy; exec /run/warpdrive/caddy run --resume")
TMPFS = {"/tmp": "rw,noexec,nosuid,nodev,size=16m,mode=1777",
         "/run/warpdrive": "rw,exec,nosuid,nodev,size=128m,mode=0700,uid=10001,gid=10001"}


def _directory(path, uid):
    info = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, uid, 0o700),
            "Exact private relay directory required")
    return info


def _fsync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _witness(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def seed_autosave(operation, document):
    """Create the candidate's empty private state and exact durable initial config."""
    _directory(operation, 0)
    require(document["admin"] == {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}},
            "Exact private persistent admin profile required")
    for name in ("socket", "config", "config/caddy"):
        path = operation / name
        path.mkdir(mode=0o700)
        os.chown(path, UID, UID)
        _directory(path, UID)
        _fsync(path.parent)
    destination = operation / "config" / AUTOSAVE_FILE
    raw = json.dumps(document, sort_keys=True, allow_nan=False, separators=(",", ":")).encode() + b"\n"
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb") as output:
        os.fchown(output.fileno(), UID, UID)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    _fsync(destination.parent)
    require(content_hash(read_autosave(operation)) == content_hash(document), "Relay seed does not match durable readback")


def read_autosave(operation):
    """Read and sync the actual autosave; an altered, replaced or absent file is unknown."""
    for path in (operation / "config", operation / "config" / "caddy"):
        _directory(path, UID)
    path = operation / "config" / AUTOSAVE_FILE
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) == (UID, UID, 0o600)
                and 0 < before.st_size <= 128 * 1024, "Exact bounded private Caddy autosave required")
        raw = handle.read(before.st_size + 1)
        os.fsync(handle.fileno())
        _fsync(path.parent)
        after = os.fstat(handle.fileno())
        visible = path.lstat()
        require(len(raw) == before.st_size and _witness(before) == _witness(after) == _witness(visible),
                "Caddy autosave changed during independent readback")
    return decode(raw)


def create_document(operation, *, alias, image, ingress_id):
    """Build a request for a single private relay with no published admin or app port."""
    require(ALIAS.fullmatch(alias) and IMAGE.fullmatch(image) and NETWORK_ID.fullmatch(ingress_id),
            "Exact installed relay image, name and ingress network required")
    _directory(operation, 0)
    for path in (operation / "socket", operation / "config"):
        _directory(path, UID)
    mounts = [{"Type": "bind", "Source": str(operation / leaf), "Target": target, "ReadOnly": False}
              for leaf, target in (("socket", SOCKET_DIR), ("config", AUTOSAVE_DIR))]
    return {
        "Image": image, "User": "10001:10001", "Entrypoint": ["/bin/sh"], "Cmd": ["-ec", START],
        "Env": [f"XDG_CONFIG_HOME={AUTOSAVE_DIR}", "XDG_DATA_HOME=/tmp/caddy-data"],
        "Labels": {OWNER_LABEL: alias, "traefik.enable": "false"}, "ExposedPorts": {"8080/tcp": {}},
        "HostConfig": {"NetworkMode": INGRESS, "ReadonlyRootfs": True, "CapDrop": ["ALL"],
                       "SecurityOpt": ["no-new-privileges:true"], "Memory": 192 * 1024**2,
                       "MemorySwap": 192 * 1024**2, "NanoCpus": 500_000_000, "PidsLimit": 64,
                       "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
                       "Tmpfs": dict(TMPFS), "Mounts": mounts},
        "NetworkingConfig": {"EndpointsConfig": {INGRESS: {"NetworkID": ingress_id, "Aliases": [alias]}}},
    }


def verify_relay(row, document, *, alias, ingress_id, manifest, running):
    """Bind the observable socket peer to the exact unadvertised process."""
    state, config, host = row["State"], row["Config"], row["HostConfig"]
    require(row["Image"] == document["Image"] and row["ImageManifestDescriptor"] == manifest
            and manifest["platform"] == {"os": "linux", "architecture": "amd64"}
            and row["Name"] == "/" + alias and NETWORK_ID.fullmatch(row["Id"])
            and state["Status"] == ("running" if running else "created")
            and state["Running"] is running and type(state["Pid"]) is int and (state["Pid"] > 1 if running else state["Pid"] == 0)
            and not any(state.get(key) for key in ("OOMKilled", "Paused", "Restarting"))
            and all(config[key] == document[key] for key in ("User", "Entrypoint", "Cmd"))
            and all(config["Labels"].get(key) == value for key, value in document["Labels"].items())
            and set(document["Env"]) <= set(config["Env"]) and not host.get("PortBindings")
            and not host.get("Privileged") and not host.get("PublishAllPorts")
            and all(host.get(key) == value for key, value in document["HostConfig"].items() if key != "Mounts"),
            "Successor relay process or isolation differs from admitted configuration")
    mounts = {(m["Source"], m["Destination"], m["Type"], m["RW"]) for m in row["Mounts"]}
    require(mounts == {(m["Source"], m["Target"], "bind", True) for m in document["HostConfig"]["Mounts"]},
            "Successor relay has an unexpected bind mount")
    networks = row["NetworkSettings"]["Networks"]
    endpoint = networks[INGRESS]
    require(set(networks) == {INGRESS}
            and endpoint["NetworkID"] in ({ingress_id} if running else {"", ingress_id})
            and endpoint["Aliases"] == [alias] and (not running or endpoint["EndpointID"] and endpoint["IPAddress"]),
            "Successor relay endpoint differs")
    return {"id": row["Id"], "imageId": row["Image"], "pid": state["Pid"], "startedAt": state["StartedAt"],
            "restartCount": row["RestartCount"], "endpointId": endpoint["EndpointID"], "ipv4": endpoint["IPAddress"]}


def verify_running(row, document, *, alias, ingress_id, manifest):
    return verify_relay(row, document, alias=alias, ingress_id=ingress_id, manifest=manifest, running=True)
