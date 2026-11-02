"""Deterministic release notes, archives, checksums, and uploaded-asset verification."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from release_support import GateError, run

def notes(evidence):
    rows = [f"# Warpdrive {evidence['version']}", "", f"Revision: `{evidence['revision']}`", f"Milestone: [{evidence['milestone']['title']}]({evidence['milestone']['url']})", "", "## Accepted deliveries", ""]
    rows += [f"- [#{i['number']} {i['title']}]({i['url']}): [acceptance]({i['acceptance']['comment']})" for i in evidence["issues"]]
    rows += ["", "## Included commits", ""]
    rows += [f"- [{c['sha'][:12]}]({c['url']}) {c['subject']} ({', '.join('#' + str(n) for n in c['issues'])})" for c in evidence["commits"]]
    broad = [(c["sha"], n) for c in evidence["commits"] for n in c.get("contributes_to", [])]
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

