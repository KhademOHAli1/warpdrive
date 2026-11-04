"""Live CodeQL finding gate for a fresh draft/publication, never historical acceptance."""
from __future__ import annotations

import urllib.parse

from release_support import GateError, SHA

MAIN_REF = "refs/heads/main"
CATEGORIES = {"/language:javascript-typescript", "/language:actions", "/language:python"}


def require_selected_main(api, repo, revision):
    ref = api.request(f"repos/{repo}/git/ref/heads/main")
    if (not isinstance(ref, dict) or ref.get("ref") != MAIN_REF
            or not isinstance(ref.get("object"), dict) or ref["object"].get("type") != "commit"
            or ref["object"].get("sha") != revision):
        raise GateError("Fresh release CodeQL results require the selected revision to remain the current main tip")


def verify_release_code_scanning(api, repo, revision):
    if not isinstance(revision, str) or not SHA.fullmatch(revision):
        raise GateError("Release CodeQL results require a full immutable revision")
    require_selected_main(api, repo, revision)
    # GitHub documents named refs. Raw-SHA queries returned HTTP 200 and empty
    # results in the retained readback, so emptiness from those queries is no proof.
    query = urllib.parse.urlencode({"ref": MAIN_REF, "tool_name": "CodeQL"})
    # Bound this metadata read to the latest 100 rows. Missing selected-commit
    # coverage fails closed; never substitute an old or other-branch analysis.
    analyses = api.request(f"repos/{repo}/code-scanning/analyses?{query}&per_page=100")
    if not isinstance(analyses, list) or any(not isinstance(a, dict) for a in analyses):
        raise GateError("CodeQL analysis response is malformed")
    selected = [a for a in analyses if a.get("commit_sha") == revision
                and isinstance(a.get("tool"), dict) and a["tool"].get("name") == "CodeQL"
                and a.get("error") == "" and type(a.get("id")) is int and a["id"] > 0
                and a.get("category") in CATEGORIES]
    if {a["category"] for a in selected} != CATEGORIES:
        raise GateError("CodeQL lacks successful selected-commit results for all three required languages")
    # Validate the raw response before flattening. The historical generic pages()
    # helper can flatten an empty object/string into [], which is not clean proof.
    alerts, page = [], 1
    while True:
        rows = api.request(f"repos/{repo}/code-scanning/alerts?state=open&{query}&per_page=100&page={page}")
        if not isinstance(rows, list):
            raise GateError("CodeQL alert response is malformed")
        alerts.extend(rows)
        if len(rows) < 100:
            break
        page += 1
    for alert in alerts:
        if (not isinstance(alert, dict) or alert.get("state") != "open"
                or not isinstance(alert.get("tool"), dict) or alert["tool"].get("name") != "CodeQL"
                or not isinstance(alert.get("rule"), dict)
                or alert["rule"].get("severity") not in ("none", "note", "warning", "error")
                or alert["rule"].get("security_severity_level") not in (None, "low", "medium", "high", "critical")):
            raise GateError("CodeQL alert identity or severity is malformed")
        if (alert["rule"].get("security_severity_level") in ("high", "critical")
                or alert["rule"]["severity"] == "error"):
            raise GateError("Fresh release has blocking CodeQL findings")
    require_selected_main(api, repo, revision)
    return {"tool": "CodeQL", "revision": revision, "ref": MAIN_REF,
            "analysis_ids": sorted({a["id"] for a in selected}), "categories": sorted(CATEGORIES),
            "open_alerts": len(alerts), "blocking_alerts": 0, "main_bound_before_and_after": True,
            "limit": "Live fresh-release finding snapshot, not historical acceptance, deployment or provider evidence."}
