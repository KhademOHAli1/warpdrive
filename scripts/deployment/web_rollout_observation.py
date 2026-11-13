"""Project authenticated native Web rollout results into safe operations facts."""

from web_rollout import _receipt, _validate
from web_switch import content_hash, require


def web_rollout_observation(plan, receipt, *, explicit_rollback=False):
    """Call with the admitted plan and its actual controller/readback result.

    None represents an unknown acknowledgement. It supplies no accepted
    revision, and the caller must keep the underlying rollout held.
    """
    _validate(plan)
    require(type(explicit_rollback) is bool, "Exact native rollout action required")
    observation = {"kind": "deployment", "component": "web"}
    if receipt is None:
        return {**observation, "outcome": "unknown", "state": "unknown", "reason": "submission_unknown",
                "sourceRevision": None, "proofSha256": None}
    require(type(receipt) is dict and receipt.get("state") in ("accepted", "rolled-back", "rejected"),
            "A native terminal Web rollout receipt is required")
    state = receipt["state"]
    require(receipt == _receipt(plan, state), "Native rollout receipt and admitted plan differ")
    outcome = "rolled_back" if state == "rolled-back" or (explicit_rollback and state == "accepted") else state
    healthy = outcome == "accepted"
    return {
        **observation,
        "outcome": outcome,
        "state": "healthy" if healthy else "failed",
        "reason": "ok" if healthy else "operation_failed",
        "sourceRevision": receipt["acceptedGeneration"][3:],
        "proofSha256": content_hash(receipt),
    }
