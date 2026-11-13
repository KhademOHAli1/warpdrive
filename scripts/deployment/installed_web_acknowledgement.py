"""Read an already recorded native functional Web acknowledgement."""

from installed_web_readback_lock import installed_web_readback_locks
from installed_web_rollout_readback import PHASES, read_accepted_web_rollout
from installed_web_seal_readback import observe_functional_seal, read_seal_acknowledgement
from installed_web_stage_readback import read_stage_acknowledgement
from web_switch import require


def read_functional_acknowledgement(install, *, original, action, loaded, release, alias, revision,
                                    publication_sha256, verify_release, expected_plan_sha256=None):
    """Return the native response only after the exact release is independently pinned.

    The caller authenticates the installed source, import, verified image load and
    original installation authority. `verify_release` can only read and compare
    the pinned publication and import receipts under the held locks.
    """
    require(action in ("stage", *PHASES, "seal") and (action == "seal") == (expected_plan_sha256 is not None),
            "Exact unresolved functional Web phase required")
    with installed_web_readback_locks(original, install.state):
        if action == "stage":
            return read_stage_acknowledgement(install, loaded=loaded, alias=alias, revision=revision, release=release)
        controller = install.controller(loaded=loaded, alias=alias, revision=revision, release=release,
                                        verify_release=verify_release)
        if action in PHASES:
            return read_accepted_web_rollout(install, controller, action)
        plan = controller.plan("reapply")
        require(verify_release(plan, initialize=False) is True, "Readback functional Web release authority differs")
        result = read_seal_acknowledgement(install, controller=controller, expected_plan_sha256=expected_plan_sha256,
                                           loaded=loaded, release=release, publication_sha256=publication_sha256,
                                           observe_installed=lambda: observe_functional_seal(install, plan))
        require(verify_release(plan, initialize=False) is True, "Readback functional Web release authority changed")
        return result
