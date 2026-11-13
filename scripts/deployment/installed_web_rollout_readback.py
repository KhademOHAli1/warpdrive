"""Read back an already accepted installed Web route without replaying a switch."""

from copy import deepcopy
from json import loads
import os
import time

from caddy_web_config import PROBE_REQUEST_HEADER, PROBE_RESPONSE_HEADER
from installed_web_chain import _admit_journals, _directory, _state
from installed_web_probe import (
    HEALTH_PATH, IDENTITY_PATH, _identity_matches, _request, _unique,
)
from web_rollout import _read_target, _receipt, _record, _validate
from web_switch import SwitchHeld, _sustained, canonical, require


PHASES = ("promote", "rollback", "reapply")


def read_public_web_health(install, revision):
    """Observe the exact public generation through the pinned relay using only GET."""
    health = _request(install.web, "GET", HEALTH_PATH, {"Cache-Control": "no-cache"}, read_body=True)
    if health is None or health.status != 200:
        return False
    media = health.values("Content-Type")
    if (len(media) != 1 or media[0].split(";", 1)[0].strip().lower() != "application/json"
            or health.values("Content-Encoding") not in ((), ("identity",))):
        return False
    try:
        value = loads(health.body.decode("utf-8"), object_pairs_hook=_unique)
    except (ValueError, RecursionError):
        return False
    if type(value) is not dict or set(value) != {"ok"} or value["ok"] is not True:
        return False
    identity = _request(install.web, "GET", IDENTITY_PATH,
                        {PROBE_REQUEST_HEADER: install.relay_alias, "Cache-Control": "no-cache",
                         "Accept": "application/json"}, read_body=True)
    return (_identity_matches(identity, revision, install.inputs["version"]) is True
            and identity.values(PROBE_RESPONSE_HEADER) == (install.relay_alias,))


def _plans(install, controller):
    plans = tuple(controller.plan(phase) for phase in PHASES)
    promote, rollback, reapply = plans
    for plan in plans:
        _validate(plan)
    operation = promote["operationId"]
    chain = install.chain
    require(tuple(plan["operationId"] for plan in plans) == (operation, operation + "-rollback", operation + "-reapply")
            and chain["acceptedOperationId"] not in {plan["operationId"] for plan in plans}
            and all(plan["targetKey"] == chain["targetKey"] and plan["backendFingerprint"] == chain["backendFingerprint"]
                    and plan["qualificationSha256"] == promote["qualificationSha256"] for plan in plans)
            and promote["before"] == chain["active"]["slot"]
            and promote["after"] == rollback["before"] == reapply["after"]
            and rollback["after"] == reapply["before"]
            and rollback["after"]["runtime"] == promote["before"]["runtime"]
            and rollback["after"]["route"]["fingerprint"] != promote["before"]["route"]["fingerprint"],
            "Exact installed Web promotion, rollback and reapply plans required")
    return plans


def _accepted_state(state, plans, index):
    selected = plans[index]
    operations = state / "web-rollouts"
    _directory(operations)
    _admit_journals(operations, selected)
    for plan in plans[:index + 1]:
        require(_state(operations / (plan["operationId"] + ".json")) == {"plan": plan, "state": "accepted"},
                "Exact earlier and selected accepted Web journals required")
    require(all(not os.path.lexists(operations / (plan["operationId"] + ".json")) for plan in plans[index + 1:]),
            "A later Web phase supersedes the requested acknowledgement")
    require(_state(state / "accepted-web-generation.json") == _record(selected, selected["after"]),
            "Accepted Web generation pointer differs from the requested phase")


def read_accepted_web_rollout(install, controller, phase, *, clock=time.monotonic, sleep=time.sleep):
    """Reconstruct the receipt for the current, durably accepted native phase.

    The caller authenticates the installation, staged artifact and controller
    and holds the existing installation and target locks. The installed target
    brackets live Caddy and autosave reads and re-observes the pinned runtimes.
    No controller mutation or synthetic POST belongs to this readback.
    """
    require(phase in PHASES and controller._state_dir == install.state,
            "Exact installed Web phase and shared target state required")
    plans = _plans(install, controller)
    index = PHASES.index(phase)
    plan = plans[index]
    _accepted_state(install.state, plans, index)
    target = controller._target(phase)
    require(target.verify_qualification(deepcopy(plan), initialize=False) is True,
            "Installed Web readback qualification is unavailable")
    route = plan["after"]["route"]

    def check_route():
        actual, stable = _read_target(target, plan)
        require(stable and actual == route, "Accepted Web route or runtime changed during readback")

    retained = plan["before"]
    expected_health = {"generation": retained["route"]["generation"],
                       "runtimeId": retained["runtime"]["runtimeId"], "healthy": True}

    def sample():
        check_route()
        health = target.observe_health(deepcopy(retained), proxied=False)
        if health != expected_health or health["healthy"] is not True:
            raise SwitchHeld("Retained Web direct health is unavailable during readback")
        if not read_public_web_health(install, plan["after"]["runtime"]["sourceRevision"]):
            raise SwitchHeld("Accepted Web public GET health is unavailable during readback")
        check_route()
        return True

    _sustained(sample, clock, sleep)
    require(target.verify_qualification(deepcopy(plan), initialize=False) is True,
            "Installed Web readback qualification changed")
    _accepted_state(install.state, plans, index)
    check_route()
    require(canonical(controller.plan(phase)) == canonical(plan), "Installed Web phase plan changed during readback")
    return _receipt(plan, "accepted")
