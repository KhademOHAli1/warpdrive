"""Deterministic release notes, archives, checksums, and uploaded-asset verification."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from release_support import GateError, run

PUBLICATION_BODY_MAX_BYTES = 120000

def notes(evidence):
    rows = [f"# Warpdrive {evidence['version']}", "", f"Revision: `{evidence['revision']}`", f"Milestone: [{evidence['milestone']['title']}]({evidence['milestone']['url']})", "", "## Accepted deliveries", ""]
    if evidence.get("release_track") == "mail":
        rows[2:2] = ["<!-- warpdrive:release-track:mail -->", f"MAIL {evidence['mail_mode']} release; primary issue #{evidence['primary_issue']}.", "This publication accepts only the recorded scope; a technical patch does not accept the full mail programme or a human user journey.", ""]
    rows += [f"- [#{i['number']} {i['title']}]({i['url']}): [acceptance]({i['acceptance']['comment']})" for i in evidence["issues"]]
    if evidence.get("release_track") == "mail":
        context = evidence.get("unreleased_context", [])
        if context:
            rows += ["", "## Unreleased source context", "",
                     "The source snapshot retains this history. These issues are not accepted or released by this publication and receive no publication updates."]
            rows += [f"- [#{i['number']} {i['title']}]({i['url']}): UNRELEASED context; source issue state `{i['source_state']}`; source origins: {', '.join(i.get('source_context_origins', ['unclassified']))}." for i in context]
        fresh_context = [c for c in evidence["commits"] if c.get("fresh_production_context")]
        if fresh_context:
            rows += ["", "## Newly integrated, unaccepted production source", "",
                     "The source archive includes the following newly integrated production changes outside this task's accepted scope. They are not historical baseline context. Their presence does not accept or complete their issues, the full MAIL programme, or a human journey."]
            rows += [f"- [{c['sha'][:12]}]({c['url']}) {c['subject']} — UNRELEASED scope: {', '.join('#' + str(n) for n in sorted(set(c['unreleased_issues'] + c['unreleased_contributions'])))}." for c in fresh_context]
        if evidence.get("programme_coverage"):
            rows += ["", "## Verified full MAIL programme coverage", "",
                     "Previously released tasks keep their original milestones and publication receipts."]
            rows += [f"- [#{i['number']} {i['title']}]({i['url']}): [full-scope acceptance]({i['acceptance']['comment']})" for i in evidence["programme_coverage"]]
        rows += ["", "## Complete source-history ledger", ""]
        for commit in evidence["commits"]:
            released = ", ".join("#" + str(n) for n in commit["released_issues"]) or "none"
            unreleased = ", ".join("#" + str(n) for n in sorted(set(commit["unreleased_issues"] + commit["unreleased_contributions"]))) or "none"
            origin = commit.get("unreleased_context_origin")
            origin_note = f"; context origin: {origin}" if origin else ""
            rows += [f"- [{commit['sha'][:12]}]({commit['url']}) {commit['subject']} — released scope: {released}; UNRELEASED context: {unreleased}{origin_note}."]
    else:
        rows += ["", "## Included commits", ""]
        rows += [f"- [{c['sha'][:12]}]({c['url']}) {c['subject']} ({', '.join('#' + str(n) for n in c['issues'])})" for c in evidence["commits"]]
    broad = [] if evidence.get("release_track") == "mail" else [(c["sha"], n) for c in evidence["commits"] for n in c.get("contributes_to", [])]
    if broad:
        rows += ["", "## Contributions to unfinished roadmap scope", ""]
        rows += [f"- `{sha[:12]}` contributes to #{number}; this is not a full-scope completion claim." for sha, number in broad]
    pulls = {p["number"]: p for c in evidence["commits"] for p in c.get("pull_requests", [])}
    if pulls:
        rows += ["", "## Included pull requests", ""]
        rows += [f"- [#{p['number']} {p['title']}]({p['url']})" for p in pulls.values()]
    rows += ["", "## Validation", ""]
    rows += [f"- [{c['workflow']}]({c['url']}): {', '.join(c['jobs'])}" for c in evidence["ci"]]
    rows += ["", "Deployment and real provider/installation acceptance remain separate operational actions. See traceability.json for acceptance evidence and limitations.", ""]
    return "\n".join(rows)

def publication_notes(evidence, full_notes=None):
    """Bound the GitHub body while retaining the complete notes as a release asset."""
    full = notes(evidence) if full_notes is None else full_notes
    if len(full.encode("utf-8")) <= PUBLICATION_BODY_MAX_BYTES:
        return full
    base = f"https://github.com/{evidence['repository']}/releases/download/v{evidence['version']}"
    rows = [f"# Warpdrive {evidence['version']}", "",
            f"Revision: `{evidence['revision']}`", ""]
    if evidence.get("release_track") == "mail":
        rows += ["<!-- warpdrive:release-track:mail -->",
                 f"MAIL {evidence['mail_mode']} release; primary issue #{evidence['primary_issue']}."]
        if evidence["mail_mode"] == "incremental":
            rows += ["This task release does not accept the full MAIL programme. "
                     "Technical acceptance alone is not human user-journey acceptance."]
    rows += ["", "## Accepted deliveries", ""]
    rows += [f"- [#{item['number']}]({item['url']})" +
             (f" (`{item['id']}`)" if item.get("id") else "")
             for item in evidence["issues"]]
    if evidence.get("unreleased_context"):
        rows += ["", "## Unaccepted source in this archive", "",
                 "The source archive physically includes source context outside these accepted deliveries. "
                 "Unselected issues are not accepted, completed or released by this publication. "
                 "Any newly integrated context is disclosed as new, not historical. "
                 "All original issue references, context and the complete commit ledger remain in the linked artifacts."]
    rows += ["", "## Complete release evidence", "",
             "The complete notes are attached without truncation; this summary stays within the publication size budget.",
             f"- [Full release notes]({base}/release-notes.md)",
             f"- [Complete traceability and acceptance evidence]({base}/traceability.json)",
             f"- [Artifact checksums]({base}/SHA256SUMS)", "",
             "Deployment and real provider/installation acceptance remain separate operational actions.", ""]
    summary = "\n".join(rows)
    if len(summary.encode("utf-8")) > PUBLICATION_BODY_MAX_BYTES:
        raise GateError("Publication summary exceeds 120000 UTF-8 bytes; accepted scope cannot be truncated")
    return summary

def artifacts(evidence, destination):
    out = Path(destination)
    allowed = {"traceability.json", "release-notes.md", "VERSION", "SHA256SUMS", f"warpdrive-{evidence['version']}-source.tar.gz"}
    out.mkdir(parents=True, exist_ok=True)
    if any(p.name not in allowed or not p.is_file() or p.is_symlink() for p in out.iterdir()):
        raise GateError("Release output contains unrelated files or symlinks; use a dedicated directory")
    (out / "traceability.json").write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    (out / "release-notes.md").write_text(notes(evidence))
    (out / "VERSION").write_text(evidence["version"] + "\n")
    archive = run("git", "archive", "--format=tar", f"--prefix=warpdrive-{evidence['version']}/", evidence["revision"], binary=True)
    import gzip
    (out / f"warpdrive-{evidence['version']}-source.tar.gz").write_bytes(gzip.compress(archive, mtime=0))
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    (out / "SHA256SUMS").write_text("".join(f"{digest(p)}  {p.name}\n" for p in sorted(out.iterdir()) if p.is_file() and p.name != "SHA256SUMS"))
    return out

def verify_uploaded_assets(directory, assets):
    expected = {p.name: (p.stat().st_size, "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()) for p in Path(directory).iterdir() if p.is_file()}
    actual = {a["name"]: (a["size"], a.get("digest")) for a in assets}
    if expected != actual:
        raise GateError("Uploaded release assets do not match prepared names, sizes, and SHA256 digests")

