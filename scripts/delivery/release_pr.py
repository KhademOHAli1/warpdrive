"""Offline proposal checks only; exact-main acceptance/publication remain release.py gates."""
from __future__ import annotations

import argparse
import hashlib
import json
import re

from release_gates import TECHNICAL_KINDS, agent_identity, https_evidence, nonempty, repository_path
from release_support import GateError, SHA, load_candidate_json, run, scope_hash, version_tuple


def validate_plan(package, plan, archive, items, mapping, policy):
    if plan.get("release_track") not in (None, "core", "mail"):
        raise GateError("Unknown release track")
    if plan.get("schema_version") != 1 or package.get("version") != plan.get("version"):
        raise GateError("Active release plan must match the package version")
    version = version_tuple(plan["version"])
    if plan.get("release_track") != "mail":
        if version[:2] == (1, 5) or version == (1, 6, 0):
            raise GateError("Reserved mail versions require the mail release track")
        return
    if plan != archive:
        raise GateError("Active MAIL plan must equal its per-version archive")
    mode = plan.get("mail_mode")
    if ((mode == "incremental" and (version[:2] != (1, 5) or version[2] < 1))
            or (mode == "programme" and plan["version"] != policy["programme_version"])
            or mode not in {"incremental", "programme"}):
        raise GateError("MAIL mode/version does not follow the committed release policy")
    numbers = plan.get("issues")
    if (not isinstance(numbers, list) or not numbers
            or any(type(number) is not int or number < 1 for number in numbers)
            or len(numbers) != len(set(numbers))
            or type(plan.get("milestone")) is not int or plan["milestone"] < 1):
        raise GateError("MAIL proposal requires unique issues and a positive milestone")
    primary = plan.get("primary_issue")
    canonical = plan.get("canonical_id")
    if (type(primary) is not int or primary not in numbers or canonical not in items
            or mapping.get(canonical, {}).get("number") != primary):
        raise GateError("MAIL primary issue does not match its canonical identity")
    reverse = {value["number"]: key for key, value in mapping.items()}
    if any(number not in reverse or reverse[number] not in items for number in numbers):
        raise GateError("MAIL proposal contains an unregistered issue")
    if mode == "incremental":
        mail = [reverse[number] for number in numbers if items[reverse[number]]["module"] == "mail"]
        if mail != [canonical] or items[canonical]["kind"] not in {"task", "deliverable", "bug", "maintenance"}:
            raise GateError("A MAIL patch must select exactly one bounded mail deliverable")
    elif canonical != policy["programme_id"] or items[canonical]["kind"] != "programme":
        raise GateError("MAIL programme version requires the full canonical programme")


def validate_review(review, item, eligibility, candidate, read_blob, is_ancestor, human_only=()):
    """Verify source evidence without inventing an accepting principal or acceptance attestation."""
    if item.get("kind") not in TECHNICAL_KINDS or item["id"] in human_only:
        raise GateError("This scope retains human acceptance")
    if (not isinstance(eligibility, dict) or eligibility.get("classification") != "bounded_technical"
            or eligibility.get("acceptance_sha256") != scope_hash(item)
            or not nonempty(eligibility.get("rationale"))):
        raise GateError("This exact canonical technical scope has no committed agent opt-in")
    required = eligibility.get("required_source_paths")
    if (not isinstance(required, list) or not required or any(not isinstance(path, str) for path in required)
            or len(required) != len(set(required))):
        raise GateError("Technical eligibility must declare unique required source paths")
    for path in required:
        repository_path(path)
    if (review.get("schema_version") != 1 or review.get("review_type") != "independent_source_review"
            or review.get("result") != "accepted" or review.get("canonical_id") != item["id"]
            or review.get("acceptance_sha256") != scope_hash(item)
            or not review.get("summary") or not review.get("limitations")):
        raise GateError("Source review must accept the whole current canonical scope and state its limits")
    agent_identity(review.get("reviewer_agent"))
    reviewed = review.get("reviewed_revision")
    if not isinstance(reviewed, str) or not SHA.fullmatch(reviewed) or not is_ancestor(reviewed, candidate):
        raise GateError("Source review must identify an ancestor revision")
    criteria = review.get("criteria")
    expected = {f"AC{n}" for n in range(1, len(item["acceptance"]) + 1)}
    if (not isinstance(criteria, list) or len(criteria) != len(expected)
            or any(not isinstance(clause, dict) or clause.get("result") != "passed"
                   or not isinstance(clause.get("evidence"), list) or not clause["evidence"]
                   or not all(https_evidence(url) for url in clause["evidence"]) for clause in criteria)
            or {clause.get("id") for clause in criteria} != expected):
        raise GateError("Source review must cover every acceptance clause exactly once")
    pins = review.get("source_pins")
    if not isinstance(pins, list) or not pins:
        raise GateError("Source review needs unchanged source pins")
    seen = set()
    for pin in pins:
        if (not isinstance(pin, dict) or set(pin) != {"path", "sha256"}
                or not isinstance(pin.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", pin["sha256"])):
            raise GateError("Invalid source pin")
        path = repository_path(pin.get("path"))
        if path in seen or path.startswith("docs/delivery/technical-reviews/"):
            raise GateError("Source review cannot duplicate pins or pin another review")
        seen.add(path)
        for cut in {reviewed, candidate}:
            if hashlib.sha256(read_blob(cut, path)).hexdigest() != pin["sha256"]:
                raise GateError(f"Reviewed source changed at {cut}: {path}")
    if not set(eligibility["required_source_paths"]).issubset(seen):
        raise GateError("Source review omits a required scoped path")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="")
    args = parser.parse_args()
    candidate = run("git", "rev-parse", "HEAD").strip()
    if args.base and args.base != "0" * 40 and not SHA.fullmatch(args.base):
        raise GateError("Base revision must be a complete Git SHA")
    base = args.base if args.base and args.base != "0" * 40 else run("git", "rev-parse", "HEAD^").strip()
    read = lambda path: load_candidate_json(candidate, path)
    plan = read("docs/delivery/releases/next.json")
    items = {item["id"]: item for item in read("docs/delivery/roadmap.json")["items"]}
    mapping = read("docs/delivery/issue-map.json")["issues"]
    policy = read("docs/delivery/mail-release-policy.json")
    archive_path = f"docs/delivery/releases/mail/{plan['version']}.json"
    archive = read(archive_path) if plan.get("release_track") == "mail" else None
    validate_plan(read("package.json"), plan, archive, items, mapping, policy)
    changed = set(run("git", "diff", "--name-only", base, candidate, "--").splitlines())
    # Historical accepted inventories do not become new acceptance claims on every feature push.
    proposal_changed = bool(changed & {"docs/delivery/releases/next.json", archive_path})
    technical_policy = read("docs/delivery/technical-acceptance-policy.json")
    eligibility = technical_policy["items"]
    human_only = set(technical_policy["human_only_ids"]) | set(
        read("docs/delivery/release-policy.json")["initial_journey_ids"].values())
    review_paths = run("git", "ls-tree", "-r", "--name-only", candidate, "--", "docs/delivery/technical-reviews").splitlines()
    validated = set()
    for path in review_paths:
        if not path.endswith(".json"):
            continue
        review = read(path)
        canonical = review.get("canonical_id")
        active = proposal_changed and canonical == plan.get("canonical_id")
        if path not in changed and not active:
            continue
        if canonical not in eligibility or canonical not in items:
            raise GateError(f"New/active source review lacks explicit technical eligibility: {path}")
        validate_review(
            review, items[canonical], eligibility[canonical], candidate,
            lambda cut, source: run("git", "show", f"{cut}:{source}", binary=True),
            lambda ancestor, descendant: run("git", "merge-base", "--is-ancestor", ancestor, descendant) == "",
            human_only,
        )
        validated.add(canonical)
    primary = plan.get("canonical_id")
    if proposal_changed and primary in eligibility and primary not in validated:
        raise GateError("A new technical release proposal needs its full-scope independent source review")
    print(json.dumps({"result": "passed", "revision": candidate, "version": plan["version"],
                      "source_reviews_checked": sorted(validated),
                      "limits": "Pre-merge proposal coherence only. No issue acceptance, main CI, publication or deployment attested."}))


if __name__ == "__main__":
    try:
        main()
    except (GateError, KeyError, TypeError, ValueError) as error:
        raise SystemExit(str(error)) from error
