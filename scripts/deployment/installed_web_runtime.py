"""Prepare an unadvertised Web slot from the verified installed Web profile."""
from __future__ import annotations

from copy import deepcopy
import re
from pathlib import PurePosixPath

from web_switch import content_hash


IMAGE = re.compile(r"sha256:[a-f0-9]{64}\Z")
ID = re.compile(r"[a-f0-9]{64}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
ALIAS = re.compile(r"warpdrive-web-[a-f0-9]{12}\Z")
NETWORKS = ("pitant-warpdrive-ingress", "pitant-warpdrive_backend")
DATABASE = "/run/secrets/database_url"
MOUNT_TARGETS = frozenset({DATABASE, "/run/secrets/auth_secret", "/run/secrets/google_oauth_client_secret",
                           "/run/secrets/storage_app_secret", "/run/secrets/token_encryption_key",
                           "/run/secrets/ws_ticket_secret"})
NO_OWNER_ENV = ("DATABASE_URL", "MIGRATION_DATABASE_URL", "MIGRATION_DATABASE_URL_FILE",
                "POSTGRES_PASSWORD", "POSTGRES_PASSWORD_FILE")
OWNER_LABEL = "warpdrive.private-web-slot"
COMMAND = ["bun", "node_modules/next/dist/bin/next", "start"]
ENTRYPOINT = ["/usr/local/bin/docker-entrypoint.sh"]
HOST_KEYS = ("CapDrop", "CgroupnsMode", "Init", "IpcMode", "LogConfig", "Memory",
             "MemorySwap", "NanoCpus", "PidsLimit", "SecurityOpt", "ShmSize")


class WebRuntimeError(ValueError):
    """A candidate or incumbent no longer matches its admitted runtime profile."""


def require(condition, message):
    if not condition:
        raise WebRuntimeError(message)


def environment(config):
    rows = config["Env"]
    require(isinstance(rows, list) and all(isinstance(row, str) and "=" in row
            and not any(character in row for character in ("\0", "\r", "\n")) for row in rows),
            "Bounded installed Web environment required")
    values = dict(row.split("=", 1) for row in rows)
    require(len(values) == len(rows) <= 80
            and all(re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", key) and len(value) <= 4096
                    for key, value in values.items()), "Ambiguous installed Web environment")
    return values


def mount_config(row, runtime_secret):
    hosts = row["HostConfig"]["Mounts"]
    live = row["Mounts"]
    require(isinstance(hosts, list) and isinstance(live, list) and len(hosts) == len(live) == len(MOUNT_TARGETS),
            "Exact restricted Web bind mounts required")
    specs = {}
    for mount in hosts:
        source, target = mount["Source"], mount["Target"]
        source_path = PurePosixPath(source)
        require(target in MOUNT_TARGETS and target not in specs and mount["Type"] == "bind"
                and mount.get("ReadOnly") is True and source_path.is_absolute()
                and ".." not in source_path.parts and str(source_path) == source
                and (target != DATABASE or source == runtime_secret)
                and not ({"database_url", "postgres_admin_password", "migration_database_url"}
                         & set(source_path.parts[-1:]))
                and set(mount) <= {"Type", "Source", "Target", "ReadOnly", "BindOptions"}
                and mount.get("BindOptions", {}).get("Propagation", "rprivate") == "rprivate",
                "Unexpected Web mount or owner credential access")
        specs[target] = deepcopy(mount)
    require(set(specs) == MOUNT_TARGETS and
            {(item["Destination"], item["Source"], item["Type"], item["RW"], item["Propagation"]) for item in live}
            == {(target, mount["Source"], "bind", False, "rprivate") for target, mount in specs.items()},
            "Installed Web mount readback differs from its profile")
    return [specs[target] for target in sorted(specs)]


def installed_profile(row, *, image_id, revision, network_ids, runtime_secret, created=False):
    config, host = row["Config"], row["HostConfig"]
    values = environment(config)
    require(row["Image"] == image_id and config["Image"] == image_id
            and config["User"] == "1000:1000" and config["WorkingDir"] == "/app"
            and config["Cmd"] == COMMAND and config["Entrypoint"] == ENTRYPOINT
            and config["StopTimeout"] == 40 and not config.get("Volumes")
            and config.get("ExposedPorts") == {"3000/tcp": {}}
            and values.get("RUNTIME_COMPONENT") == "web" and values.get("NODE_ENV") == "production"
            and values.get("APP_COMMIT") == revision and values.get("APP_VERSION") == ""
            and values.get("NEXT_DEPLOYMENT_ID") == "wd-" + revision
            and values.get("DATABASE_URL_FILE") == DATABASE and all(values.get(key, "") == "" for key in NO_OWNER_ENV)
            and values.get("HOSTNAME") == "0.0.0.0" and values.get("PORT") == "3000"
            and not any(host.get(key) for key in ("Privileged", "PortBindings", "PublishAllPorts", "Binds",
                    "CapAdd", "Devices", "VolumesFrom", "ExtraHosts", "Links")),
            "Installed Web command, source, database access or privilege profile differs")
    networks = row["NetworkSettings"]["Networks"]
    require(set(networks) == set(network_ids) == set(NETWORKS)
            and all(network["NetworkID"] in ({network_ids[name], ""} if created else {network_ids[name]})
                    for name, network in networks.items()),
            "Installed Web private networks differ")
    limits = {key: deepcopy(host[key]) for key in HOST_KEYS}
    require(limits["CapDrop"] == ["ALL"] and limits["Init"] is True and limits["IpcMode"] == "private"
            and limits["CgroupnsMode"] == "private" and limits["Memory"] == 1536 * 1024**2
            and limits["MemorySwap"] == 3 * 1024**3 and limits["NanoCpus"] == 2_000_000_000
            and limits["PidsLimit"] == 256 and limits["ShmSize"] == 64 * 1024**2
            and limits["SecurityOpt"] == ["no-new-privileges:true"]
            and limits["LogConfig"] == {"Type": "json-file", "Config": {"max-file": "3", "max-size": "10m"}},
            "Installed Web operating limits differ")
    health = deepcopy(config["Healthcheck"])
    require(health == {
        "Test": ["CMD", "bun", "-e",
                 "fetch('http://localhost:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
        "Interval": 15_000_000_000, "Timeout": 5_000_000_000, "StartPeriod": 20_000_000_000, "Retries": 8,
    }, "Installed Web health command differs")
    return {"environment": values, "mounts": mount_config(row, runtime_secret), "limits": limits,
            "healthcheck": health, "networks": deepcopy(network_ids)}


def build_candidate(incumbent, *, incumbent_id, incumbent_image, incumbent_revision, candidate_image,
                    candidate_revision, alias, network_ids, runtime_secret):
    """Return a Docker Engine create document and a fingerprint of its baseline."""
    require(ID.fullmatch(incumbent_id) and all(IMAGE.fullmatch(image) for image in (incumbent_image, candidate_image))
            and all(REVISION.fullmatch(revision) for revision in (incumbent_revision, candidate_revision))
            and candidate_image != incumbent_image and candidate_revision != incumbent_revision and ALIAS.fullmatch(alias)
            and set(network_ids) == set(NETWORKS) and all(ID.fullmatch(value) for value in network_ids.values())
            and len(set(network_ids.values())) == 2 and runtime_secret.startswith("/root/warpdrive-deployment/private/")
            and runtime_secret.endswith("/runtime-database-url"), "Exact installed and candidate Web pins required")
    labels = incumbent["Config"]["Labels"]
    require(incumbent["Id"] == incumbent_id and incumbent["Name"] == "/pitant-warpdrive-app-1"
            and labels.get("com.docker.compose.project") == "pitant-warpdrive"
            and labels.get("com.docker.compose.service") == "app"
            and incumbent["State"]["Status"] == "running" and incumbent["State"]["Health"]["Status"] == "healthy",
            "Original selected Web is unavailable")
    profile = installed_profile(incumbent, image_id=incumbent_image, revision=incumbent_revision,
                                network_ids=network_ids, runtime_secret=runtime_secret)
    before = content_hash(profile)
    values = {**profile["environment"], "APP_COMMIT": candidate_revision, "NEXT_DEPLOYMENT_ID": "wd-" + candidate_revision}
    document = {
        "Image": candidate_image, "User": "1000:1000", "WorkingDir": "/app", "Entrypoint": ENTRYPOINT.copy(),
        "Cmd": COMMAND.copy(), "StopTimeout": 40, "ExposedPorts": {"3000/tcp": {}}, "Healthcheck": profile["healthcheck"],
        "Env": [f"{key}={value}" for key, value in sorted(values.items())],
        "Labels": {OWNER_LABEL: alias, "traefik.enable": "false"},
        "HostConfig": {**profile["limits"], "NetworkMode": NETWORKS[0], "Mounts": profile["mounts"],
                       "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0}},
        "NetworkingConfig": {"EndpointsConfig": {
            name: {"NetworkID": network_ids[name], "Aliases": [alias]} for name in NETWORKS
        }},
    }
    return document, before


def verify_candidate(row, document, *, alias, network_ids, runtime_secret, require_ready=False, created=False):
    """Verify native runtime readback without emitting its environment or mounts."""
    require(ID.fullmatch(row["Id"]) and row["Name"] == "/" + alias
            and row["ImageManifestDescriptor"]["digest"] == document["Image"],
            "Native candidate Web manifest or runtime identity differs")
    config, host, state = row["Config"], row["HostConfig"], row["State"]
    values = environment({"Env": document["Env"]})
    actual = installed_profile(row, image_id=document["Image"], revision=values["APP_COMMIT"],
                               network_ids=network_ids, runtime_secret=runtime_secret, created=created)
    labels = config["Labels"]
    require(actual["environment"] == values and actual["mounts"] == document["HostConfig"]["Mounts"]
            and actual["healthcheck"] == document["Healthcheck"]
            and all(actual["limits"][key] == document["HostConfig"][key] for key in HOST_KEYS)
            and all(labels.get(key) == value for key, value in document["Labels"].items())
            and all(not name.startswith(("com.docker.compose.", "traefik.")) or name == "traefik.enable" for name in labels)
            and host["RestartPolicy"] == document["HostConfig"]["RestartPolicy"]
            and host["NetworkMode"] == document["HostConfig"]["NetworkMode"],
            "Candidate runtime configuration differs from admitted Web slot")
    endpoints = row["NetworkSettings"]["Networks"]
    require(all(endpoint.get("Aliases") == [alias]
                and endpoint.get("NetworkID") in ({network_ids[name], ""} if created else {network_ids[name]})
                for name, endpoint in endpoints.items()), "Candidate Web alias or network differs")
    require(type(row["RestartCount"]) is int and not state["OOMKilled"] and not state["Restarting"] and not state["Paused"],
            "Candidate Web has an invalid native process state")
    if require_ready:
        require(state["Running"] and state["Status"] == "running" and state["Health"]["Status"] == "healthy"
                and row["RestartCount"] == 0 and all(endpoint.get("EndpointID") for endpoint in endpoints.values()),
                "Candidate Web has no stable healthy process")
    return {"runtimeId": row["Id"], "name": alias, "imageId": row["Image"], "sourceRevision": values["APP_COMMIT"],
            "configSha256": content_hash(actual), "restartCount": row["RestartCount"], "running": state["Running"]}
