"""Read-only module proposals, or a trusted-main catalog-only bump pull request.

No merge, release, deployment, force update, branch rewrite or direct-main write
is implemented. A failed mutation is never retried; retain its pending receipt.
"""
from __future__ import annotations

import argparse
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode

import module_versions as versions

REPOSITORY = "KhademOHAli1/warpdrive"
CATALOG = "docs/delivery/module-versions.json"
SHA = re.compile(r"[a-f0-9]{40}\Z")
BOT_BRANCH = re.compile(r"automation/module-versions-([a-f0-9]{12})-([a-f0-9]{12})\Z")
MARKER = re.compile(r"<!-- warpdrive:delivery-id:([^\s]+) -->")
MAX_BYTES = 2 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[2]


class Held(RuntimeError):
    pass


class UnknownMutation(Held):
    pass


def require(value, message):
    if not value:
        raise Held(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as output:
        output.write(encoded(value))
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def local(command, root, *, maximum=MAX_BYTES):
    # Git/engine subprocesses receive no GitHub credential.
    require(type(maximum) is int and 0 < maximum <= versions.MAX_JSON, "Bounded local read allowance required")
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(command, cwd=root, env=environment, capture_output=True, timeout=30, check=False)
    require(result.returncode == 0 and len(result.stdout) <= maximum, "Bounded local module analysis failed")
    return result.stdout


def git(root, *arguments, maximum=MAX_BYTES):
    return local(["git", "--no-replace-objects", "-c", "core.fsmonitor=false", *arguments], root, maximum=maximum)


def proposal(root, base, head, changes=None):
    require(SHA.fullmatch(base) and SHA.fullmatch(head), "Full base and source commit SHAs required")
    command = [sys.executable, "-B", str(Path(__file__).with_name("module_versions.py")),
               "--repo", str(root), "plan", "--base", base, "--head", head]
    if changes:
        command += ["--changes", str(changes)]
    value = json.loads(local(command, root))
    require(value.get("kind") == "warpdrive-module-version-proposal" and value.get("schemaVersion") == 1
            and value.get("baseRevision") == base and value.get("sourceRevision") == head
            and value.get("publicationAuthorized") is False and value.get("deploymentAuthorized") is False,
            "Exact non-publishing engine proposal required")
    return value


def review_head(root, branch, base, head):
    """Hold stale bot PRs in an existing required check, without API access."""
    if not branch.startswith("automation/module-versions-"):
        return {"state": "ordinary-feature-pr", "sourceRevision": head}
    match = BOT_BRANCH.fullmatch(branch)
    require(match is not None and SHA.fullmatch(base or "") and SHA.fullmatch(head),
            "Exact module bot branch and PR base/head required")
    parents = git(root, "rev-list", "--parents", "-n", "1", head).decode().split()
    require(parents == [head, base] and match[1] == base[:12],
            "Module bot PR is stale or its source parent changed; close it and re-propose from current main")
    message = git(root, "show", "-s", "--format=%B", head).decode()
    source_pins = re.findall(r"^Source-Revision: ([a-f0-9]{40})$", message, re.MULTILINE)
    proposal_pins = re.findall(r"^Proposal-SHA256: ([a-f0-9]{64})$", message, re.MULTILINE)
    require(source_pins == [base] and len(proposal_pins) == 1 and proposal_pins[0][:12] == match[2],
            "Module bot PR source/proposal markers differ; close it and re-propose")
    changed = git(root, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", base, head, "--")
    require(changed == ("M\t" + CATALOG + "\n").encode(), "Module bot PR may change only the existing catalog")
    original = git(root, "show", base + ":" + CATALOG)
    proposed = git(root, "show", head + ":" + CATALOG)
    require(versions.updated_catalog_bytes(original, versions.decode(proposed)) == proposed,
            "Module bot PR may change only version tokens and must preserve catalog formatting")
    return {"state": "current-main-catalog-only-bot-pr", "sourceRevision": base, "reviewHead": head}


class GitHub:
    """Finite REST requests through gh; no pagination, implicit retries or host selection."""
    def __init__(self, receipt):
        self.receipt = Path(receipt)
        self.deadline = time.monotonic() + 180
        self.calls = 0
        if self.receipt.exists():
            require(json.loads(self.receipt.read_bytes()).get("state") != "pending",
                    "Unresolved mutation receipt: independently reconcile it before another write")

    def request(self, endpoint, method="GET", payload=None, missing=False):
        require(endpoint.startswith(f"repos/{REPOSITORY}/") and method in {"GET", "POST"},
                "Only fixed-repository reads and additive bot writes are supported")
        self.calls += 1
        remaining = self.deadline - time.monotonic()
        require(self.calls <= 40 and remaining > 0, "GitHub request budget exhausted")
        mutation = method != "GET"
        receipt = {"schemaVersion": 1, "state": "pending", "method": method, "endpoint": endpoint,
                   "payloadSha256": sha256(encoded(payload)).hexdigest()}
        if mutation:
            save(self.receipt, receipt)
        command = ["gh", "api", "--hostname", "github.com", "--include", "--method", method,
                   "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint]
        if payload is not None:
            command += ["--input", "-"]
        try:
            result = subprocess.run(command, input=encoded(payload) if payload is not None else None,
                                    capture_output=True, timeout=min(20, remaining), check=False)
            require(len(result.stdout) <= MAX_BYTES, "GitHub response exceeds bound")
            header, body = result.stdout.replace(b"\r\n", b"\n").split(b"\n\n", 1)
            status = int(header.splitlines()[0].split()[1])
            if status == 404 and missing and not mutation:
                return None
            require(result.returncode == 0 and 200 <= status < 300, "GitHub request was not successful")
            return json.loads(body)
        except (OSError, subprocess.TimeoutExpired, ValueError, IndexError, Held) as error:
            if mutation:
                raise UnknownMutation("Mutation outcome unresolved; retain mutation-state.json, reread remote state, no retry") from error
            raise Held("GitHub read failed; no mutation retry was performed") from error

    def verified(self):
        value = json.loads(self.receipt.read_bytes())
        value["state"] = "verified"
        save(self.receipt, value)


def endpoint(path):
    return f"repos/{REPOSITORY}/{path}"


def main_pin(api, head):
    value = api.request(endpoint("git/ref/heads/main"))
    require(value.get("ref") == "refs/heads/main" and value.get("object") == {"type": "commit", "sha": head,
            "url": f"https://api.github.com/repos/{REPOSITORY}/git/commits/{head}"},
            "Main moved or its commit identity differs; regenerate the proposal")


def branch_sha(value, branch):
    require(type(value) is dict and value.get("ref") == "refs/heads/" + branch
            and value.get("object", {}).get("type") == "commit"
            and SHA.fullmatch(value.get("object", {}).get("sha", "")), "Exact bot branch commit required")
    return value["object"]["sha"]


def pull_requests(api, branch):
    query = urlencode({"state": "all", "head": REPOSITORY.split("/")[0] + ":" + branch,
                       "base": "main", "per_page": 100})
    values = api.request(endpoint("pulls?" + query))
    require(type(values) is list and len(values) < 100 and len(values) <= 1,
            "Ambiguous or truncated bot pull-request search; reconcile manually")
    return values


def catalog_only(plan, current_raw):
    current = versions.validate_registry(versions.decode(current_raw))
    proposed = plan["proposedCatalog"]
    require(type(proposed) is dict and set(proposed) == set(current)
            and set(proposed["modules"]) == set(current["modules"]), "Bot may only change existing module versions")
    expected = json.loads(json.dumps(current))
    for name, module in expected["modules"].items():
        item = plan["modules"][name]
        require(item["currentVersion"] == module["version"], "Proposal does not match current source catalog")
        module["version"] = item["proposedVersion"]
    require(proposed == expected, "Bot proposal changes catalog scope or non-version metadata")
    # The bot must retain repository formatting as well as catalog semantics.
    # This writes only the exact module-version JSON tokens in trusted Git bytes.
    return versions.updated_catalog_bytes(current_raw, proposed)


def verify_branch(api, branch, commit, source, raw):
    require(branch_sha(api.request(endpoint("git/ref/heads/" + branch)), branch) == commit,
            "Bot branch moved; no rewrite is permitted")
    value = api.request(endpoint("git/commits/" + commit))
    require(value.get("sha") == commit and [item.get("sha") for item in value.get("parents", [])] == [source],
            "Bot branch does not have the exact source parent")
    diff = api.request(endpoint(f"compare/{source}...{commit}?per_page=100"))
    files = diff.get("files", [])
    require(diff.get("total_commits") == 1 and len(files) == 1
            and files[0].get("filename") == CATALOG and files[0].get("status") == "modified",
            "Bot branch must contain exactly one catalog-only commit")
    content = api.request(endpoint(f"contents/{CATALOG}?ref={commit}"))
    require(content.get("path") == CATALOG and content.get("encoding") == "base64"
            and base64.b64decode(content["content"], validate=False) == raw, "Remote catalog bytes differ")


def verify_pr(api, number, branch, commit, source, body):
    value = api.request(endpoint("pulls/" + str(number)))
    require(value.get("number") == number and value.get("state") == "open" and not value.get("merged_at")
            and value.get("head", {}).get("ref") == branch and value["head"].get("sha") == commit
            and value["head"].get("repo", {}).get("full_name") == REPOSITORY
            and value.get("base", {}).get("ref") == "main" and value["base"].get("sha") == source
            and value["base"].get("repo", {}).get("full_name") == REPOSITORY
            and value.get("body") == body and value.get("auto_merge") is None,
            "Existing/read-back PR differs from exact source, branch, proposal or review-only policy")
    return value


def open_proposal(api, plan, current_raw, issue, registered):
    if not plan["hasChanges"]:
        return {"state": "no-module-bump-required", "sourceRevision": plan["sourceRevision"]}
    source = plan["sourceRevision"]
    require(SHA.fullmatch(source) and type(issue) is int and issue > 0, "Source SHA and canonical issue required")
    raw = catalog_only(plan, current_raw)
    digest = sha256(encoded({"source": source, "base": plan["baseRevision"], "catalog": plan["proposedCatalog"]})).hexdigest()
    branch = "automation/module-versions-" + source[:12] + "-" + digest[:12]
    body = (f"Source module version proposal for `{source}`.\n\nRefs #{issue}\n\n"
            f"<!-- warpdrive:module-version-proposal:{digest} -->\n\n"
            "Changes only source module SemVer metadata. Normal review and existing checks apply.\n"
            "This PR does not publish, merge, deploy, qualify compatibility or relabel installed images.\n")
    main_pin(api, source)
    canonical_issue = api.request(endpoint("issues/" + str(issue)))
    identities = MARKER.findall(canonical_issue.get("body") or "")
    require(canonical_issue.get("number") == issue and "pull_request" not in canonical_issue
            and len(identities) == 1 and identities[0] in registered,
            "Bump commit issue must have one registered canonical delivery identity")
    reference = api.request(endpoint("git/ref/heads/" + branch), missing=True)
    existing = pull_requests(api, branch)
    if reference:
        commit = branch_sha(reference, branch)
        verify_branch(api, branch, commit, source, raw)
        require(len(existing) == 1, "Existing bot branch has no unique PR; reconcile pending mutation, do not recreate")
        result = verify_pr(api, existing[0]["number"], branch, commit, source, body)
        return {"state": "existing-pull-request-verified", "number": result["number"], "url": result["html_url"]}
    require(not existing, "PR exists without its expected branch; reconcile manually")
    source_commit = api.request(endpoint("git/commits/" + source))
    require(source_commit.get("sha") == source and SHA.fullmatch(source_commit.get("tree", {}).get("sha", "")),
            "Exact source commit/tree required")
    main_pin(api, source)
    blob = api.request(endpoint("git/blobs"), "POST", {"encoding": "base64", "content": base64.b64encode(raw).decode()})
    require(SHA.fullmatch(blob.get("sha", "")), "Blob mutation acknowledgement incomplete")
    observed = api.request(endpoint("git/blobs/" + blob["sha"]))
    require(base64.b64decode(observed["content"]) == raw, "Created blob readback differs")
    api.verified()
    tree = api.request(endpoint("git/trees"), "POST", {"base_tree": source_commit["tree"]["sha"],
        "tree": [{"path": CATALOG, "mode": "100644", "type": "blob", "sha": blob["sha"]}]})
    require(SHA.fullmatch(tree.get("sha", "")), "Tree mutation acknowledgement incomplete")
    require(api.request(endpoint("git/trees/" + tree["sha"])).get("sha") == tree["sha"], "Created tree readback differs")
    api.verified()
    created = api.request(endpoint("git/commits"), "POST", {"message": f"chore: bump source module versions\n\nRefs #{issue}\n\nSource-Revision: {source}\nProposal-SHA256: {digest}",
        "tree": tree["sha"], "parents": [source]})
    commit = created.get("sha", "")
    require(SHA.fullmatch(commit), "Commit mutation acknowledgement incomplete")
    observed = api.request(endpoint("git/commits/" + commit))
    require(observed.get("sha") == commit and observed.get("tree", {}).get("sha") == tree["sha"]
            and [item.get("sha") for item in observed.get("parents", [])] == [source], "Created commit readback differs")
    api.verified()
    main_pin(api, source)
    api.request(endpoint("git/refs"), "POST", {"ref": "refs/heads/" + branch, "sha": commit})
    verify_branch(api, branch, commit, source, raw)
    api.verified()
    main_pin(api, source)
    require(not pull_requests(api, branch), "A PR appeared concurrently; reread without another mutation")
    created = api.request(endpoint("pulls"), "POST", {"title": "chore: bump source module versions", "head": branch,
        "base": "main", "body": body, "draft": False, "maintainer_can_modify": False})
    require(type(created.get("number")) is int, "PR mutation acknowledgement incomplete")
    result = verify_pr(api, created["number"], branch, commit, source, body)
    api.verified()
    return {"state": "pull-request-opened-and-verified", "number": result["number"], "url": result["html_url"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("propose", "open-pr", "review-check"))
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--base")
    parser.add_argument("--head", required=True)
    parser.add_argument("--branch", default="", help="Exact PR head branch for the read-only review guard")
    intent = parser.add_mutually_exclusive_group()
    intent.add_argument("--changes", type=Path)
    intent.add_argument("--changes-json")
    parser.add_argument("--issue", type=int, default=529)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        require(SHA.fullmatch(args.head), "Full source SHA required")
        if args.mode == "review-check":
            result = review_head(args.repo, args.branch, args.base, args.head)
            save(args.output / "result.json", result)
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.mode == "open-pr":
            require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY
                    and os.environ.get("GITHUB_REF") == "refs/heads/main"
                    and os.environ.get("GITHUB_EVENT_NAME") in {"push", "workflow_dispatch"}
                    and os.environ.get("GITHUB_SHA") == args.head
                    and git(args.repo, "rev-parse", "HEAD").decode().strip() == args.head,
                    "Writes require exact trusted main workflow code and source head")
        base = args.base or git(args.repo, "log", "-1", "--format=%H", args.head, "--", CATALOG).decode().strip()
        if args.changes_json:
            require(len(args.changes_json.encode()) <= 65536, "Bounded explicit bump intent required")
            args.changes = args.output / "changes.json"
            save(args.changes, json.loads(args.changes_json))
        plan = proposal(args.repo, base, args.head, args.changes)
        save(args.output / "proposal.json", plan)
        if args.mode == "propose":
            result = {"state": "proposal-only", "hasChanges": plan["hasChanges"], "sourceRevision": args.head}
        elif not plan["hasChanges"]:
            result = {"state": "no-module-bump-required", "sourceRevision": args.head}
        else:
            current_raw = git(args.repo, "show", args.head + ":" + CATALOG)
            roadmap = versions.decode(git(args.repo, "show", args.head + ":docs/delivery/roadmap.json",
                                          maximum=versions.MAX_JSON))
            result = open_proposal(GitHub(args.output / "mutation-state.json"), plan, current_raw, args.issue,
                                   {item["id"] for item in roadmap["items"]})
        save(args.output / "result.json", result)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Held, OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.TimeoutExpired) as error:
        pending = args.output / "mutation-state.json"
        unresolved = pending.exists() and json.loads(pending.read_bytes()).get("state") == "pending"
        save(args.output / "result.json", {"state": "unresolved-mutation" if unresolved else "held",
                                          "reason": str(error), "retryPerformed": False})
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
