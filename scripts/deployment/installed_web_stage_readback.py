"""Recover a lost acknowledgement for an already completed private Web stage."""

from __future__ import annotations

import os

from installed_web_chain import _directory
from installed_web_operator import candidate_ready
from installed_web_runtime import ALIAS, ID, require
from installed_web_stage import read_record
from web_switch import content_hash


def _receipts(directory, binding):
    _directory(directory)
    require(read_record(directory / "stage-intent.json") == binding,
            "Private Web stage intent differs from the admitted release")
    ready = read_record(directory / "stage-ready.json")
    require(type(ready) is dict and set(ready) == {*binding, "id", "runtime"}
            and {key: ready[key] for key in binding} == binding
            and isinstance(ready["id"], str) and ID.fullmatch(ready["id"])
            and type(ready["runtime"]) is dict and ready["runtime"].get("runtimeId") == ready["id"],
            "Exact terminal private Web stage receipt required")
    path = directory / "stage-created.json"
    created = None
    if os.path.lexists(path):
        created = read_record(path)
        require(created == {**binding, "id": ready["id"]},
                "Private Web stage creation differs from the ready receipt")
    return ready, created


def _preimage(install, suffix):
    operations = install.state / "web-rollouts"
    _directory(operations)
    operation = f"web-{suffix}"
    for index, path in enumerate(operations.iterdir()):
        require(index < 1000, "Oversized installed Web rollout journal inventory")
        require(path.stem != operation and not path.stem.startswith(operation + "-"),
                "A route phase already belongs to this private Web stage")
    # Also rejects nonterminal or invalid journals on the shared target.
    install._stage_preimage(check_journals=True)


def _observe_candidate(install, *, ready, document, alias, revision):
    row = install.docker.inspect(ready["id"])
    witness = candidate_ready(install.docker, install.network, alias, document,
                              install.inputs["networkIds"], install.inputs["runtimeSecret"],
                              revision, install.inputs["version"], row)
    state = row["State"]
    require(witness is not None and content_hash(witness) == content_hash(ready["runtime"])
            and type(state.get("Pid")) is int and state["Pid"] > 0
            and isinstance(state.get("StartedAt"), str) and bool(state["StartedAt"]),
            "Staged Web process, configuration or direct health differs")
    return state["Pid"], state["StartedAt"]


def read_stage_acknowledgement(install, *, loaded, alias, revision, release):
    """Return native stage response fields without creating, starting or loading.

    The caller must already hold the existing production and rollout locks, pin
    the InstalledWebSuccessor and alias to this operation, and verify the exact
    import, publication, loaded image, and original installation authority.
    Missing or mismatched terminal evidence leaves the operation unresolved.
    """
    require(isinstance(alias, str) and ALIAS.fullmatch(alias), "Exact private Web stage alias required")
    require(type(release) is dict and release.get("revision") == revision,
            "Exact admitted private Web release revision required")
    suffix = alias.removeprefix("warpdrive-web-")
    document, backend = install._candidate_document(loaded, alias, revision)
    _preimage(install, suffix)
    directory = install.operation / "candidate"
    binding = {"kind": "warpdrive-private-web-stage", "alias": alias,
               "configSha256": content_hash(document), "qualificationSha256": content_hash(release)}
    ready, created = _receipts(directory, binding)
    initial = _observe_candidate(install, ready=ready, document=document, alias=alias, revision=revision)
    require(install._retained()[0] == backend, "Protected backend changed during private Web stage observation")
    _preimage(install, suffix)
    final = _observe_candidate(install, ready=ready, document=document, alias=alias, revision=revision)
    require(initial == final and _receipts(directory, binding) == (ready, created),
            "Private Web stage changed during readback")
    return {"state": "private-ready", "sourceRevision": revision, "candidateId": ready["id"],
            "backendFingerprint": backend["backendFingerprint"]}
