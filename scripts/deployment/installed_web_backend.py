"""Bracket an installed Web operation with exact protected Docker witnesses."""
from __future__ import annotations

from installed_web_runtime import ID, require
from installed_web_schema import read_schema
from web_switch import content_hash


RUNNING = {"edge", "postgres", "storage", "worker", "realtime"}
COMPONENTS = RUNNING | {"migrator"}


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


def observe_backend(docker, pins, *, schema_reader=read_schema):
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
    schema_sha = schema_reader(witnesses["postgres"]["id"])
    return {"schemaSha256": schema_sha, "processes": witnesses,
            "backendFingerprint": content_hash({"schemaSha256": schema_sha, "processes": witnesses})}
