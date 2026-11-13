"""Bind a repeat presentation proof to exact Git source and a reviewed tooling revision."""
from __future__ import annotations

import re

from candidate import REVISION, require
from component_inputs import content_hash
from web_release_inputs import _git, _tree, _verify_baseline_blobs, source_policy


TOOLING_FILES = frozenset({
    ".github/workflows/production-images.yml",
    ".github/workflows/web-repeat-qualification.yml",
    "eslint.config.mjs",
    "scripts/browser-web-rollout.mjs",
    "scripts/deployment/tsconfig.json",
    "scripts/deployment/first-web-publication.receipt",
    "scripts/deployment/web_push_scope.py",
    "scripts/deployment/test_web_push_scope.py",
    "scripts/deployment/traefik_web_handoff_state.py",
    "scripts/deployment/test_traefik_web_handoff_state.py",
    "scripts/deployment/traefik_web_ownership.py",
    "scripts/deployment/test_traefik_web_ownership.py",
    "scripts/deployment/test_traefik_web_ownership_native.py",
    "scripts/deployment/web_composite_baseline.py",
    "scripts/deployment/test_web_composite_baseline.py",
    "scripts/deployment/web_mixed_image_smoke.py",
    "scripts/deployment/web_presentation_policy.mjs",
    "scripts/deployment/web_presentation_policy.test.mjs",
    "scripts/deployment/web_repeat_presentation.mjs",
})
TOOLING_MODULE = re.compile(r"scripts/deployment/(?:test_)?(?:caddy_web_repeat(?:_native)?|installed_(?:docker|web_[a-z_]+)|web_(?:repeat_[a-z_]+|mixed_repeat))\.py\Z")


def _changes(before, after):
    return sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))


def verify_repeat_presentation_git(root, presentation, *, active_inputs, active_revision, tooling_revision=None):
    """Verify that a reviewed tools commit and the actual candidate have disjoint changes.

    The caller selects the exact trusted tools commit. The Node analyzer supplies
    presentation structure and reachability, and this check independently binds
    its reported blobs and the complete tree delta to that same checkout.
    """
    baseline = presentation["baselineRevision"]
    candidate = presentation["currentRevision"]
    require(all(isinstance(revision, str) and REVISION.fullmatch(revision) for revision in (active_revision, baseline, candidate))
            and baseline == (tooling_revision or active_revision) and baseline != candidate,
            "Repeat presentation source differs from its exact authorized baseline")
    old, source, new = (_tree(root, revision) for revision in (active_revision, baseline, candidate))
    _git(root, "merge-base", "--is-ancestor", active_revision, baseline, allow_empty=True)
    _git(root, "merge-base", "--is-ancestor", baseline, candidate, allow_empty=True)
    _verify_baseline_blobs(root, old, active_inputs)
    rows = presentation["changed"]
    require(_changes(source, new) == [row["path"] for row in rows] and bool(rows),
            "Repeat presentation receipt differs from the exact Git delta")
    for row in rows:
        path = row["path"]
        require(source.get(path) == ("100644", "blob", row["baselineBlob"])
                and new.get(path) == ("100644", "blob", row["currentBlob"]), "Repeat presentation blob or mode differs")
    tooling_paths = _changes(old, source)
    require(set(tooling_paths).isdisjoint(row["path"] for row in rows), "Trusted tooling overlaps the presentation change")
    for path in tooling_paths:
        require((path in TOOLING_FILES or TOOLING_MODULE.fullmatch(path))
                and path in source and source[path][:2] == ("100644", "blob")
                and (path not in old or old[path][:2] == ("100644", "blob")), "Trusted tooling changed a protected source path")
    if tooling_paths:
        require(source_policy(root, active_revision) == source_policy(root, candidate),
                "Repeat tooling changed Engine or installed runtime source policy")
    return {"activeWebRevision": active_revision, "toolingRevision": baseline, "candidateRevision": candidate,
            "toolingPaths": tooling_paths, "toolingSourceSha256": content_hash([
                {"path": path, "before": list(old[path]) if path in old else None, "after": list(source[path])}
                for path in tooling_paths])}
