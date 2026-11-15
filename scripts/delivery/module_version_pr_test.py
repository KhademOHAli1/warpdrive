"""Offline bot boundaries plus cumulative proposal tests in temporary Git repos."""
from copy import deepcopy
import base64
import json
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import module_version_pr as bot

SOURCE, TREE, BLOB, COMMIT, NEW_TREE = (digit * 40 for digit in "abcde")


def fixture():
    current = {"schemaVersion": 1, "kind": bot.versions.KIND, "versionMeaning": bot.versions.MEANING,
        "baselineSourceRevision": "a" * 40,
        "modules": {"web": {"name": "Web", "kind": "application", "version": "1.7.1",
                            "paths": ["src/"], "dependencies": []}},
        "sharedPaths": [{"paths": ["package.json"], "modules": ["web"]}],
        "ignoredPaths": [bot.CATALOG, "docs/delivery/releases/"],
        "ignoreVersionOnlyChanges": ["package.json"]}
    proposed = deepcopy(current)
    proposed["modules"]["web"]["version"] = "1.7.2"
    return current, {"schemaVersion": 1, "kind": "warpdrive-module-version-proposal", "sourceRevision": SOURCE,
        "baseRevision": "f" * 40, "hasChanges": True, "proposedCatalog": proposed,
        "modules": {"web": {"currentVersion": "1.7.1", "proposedVersion": "1.7.2"}},
        "publicationAuthorized": False, "deploymentAuthorized": False}


class FakeGitHub:
    def __init__(self, source=SOURCE):
        self.source = source
        self.calls = []
        self.branch = None
        self.pr = None
        self.raw = None
        self.issue = {"number": 529, "body": "<!-- warpdrive:delivery-id:integration/OSS-011 -->"}
        self.lost_pr_ack = False
        self.diff_files = [{"filename": bot.CATALOG, "status": "modified"}]
        self.main = source

    def verified(self):
        pass

    def request(self, endpoint, method="GET", payload=None, missing=False):
        self.calls.append((endpoint, method, payload))
        path = endpoint.removeprefix(f"repos/{bot.REPOSITORY}/")
        if method == "POST":
            if path == "git/blobs":
                self.raw = base64.b64decode(payload["content"])
                return {"sha": BLOB}
            if path == "git/trees":
                if payload["tree"] != [{"path": bot.CATALOG, "mode": "100644", "type": "blob", "sha": BLOB}]:
                    raise AssertionError("Non-catalog tree write")
                return {"sha": NEW_TREE}
            if path == "git/commits":
                if payload["parents"] != [self.source] or "Refs #529" not in payload["message"]:
                    raise AssertionError("Missing exact parent or traceability")
                return {"sha": COMMIT}
            if path == "git/refs":
                if not payload["ref"].startswith("refs/heads/automation/module-versions-"):
                    raise AssertionError("Write outside bot branch")
                self.branch = payload["ref"].removeprefix("refs/heads/")
                return self.reference(self.branch, COMMIT)
            if path == "pulls":
                if self.lost_pr_ack:
                    raise bot.UnknownMutation("lost PR acknowledgement")
                self.pr = {"number": 12, "state": "open", "merged_at": None, "auto_merge": None,
                    "html_url": f"https://github.com/{bot.REPOSITORY}/pull/12", "body": payload["body"],
                    "head": {"ref": self.branch, "sha": COMMIT, "repo": {"full_name": bot.REPOSITORY}},
                    "base": {"ref": "main", "sha": self.source, "repo": {"full_name": bot.REPOSITORY}}}
                return deepcopy(self.pr)
            raise AssertionError("Unexpected mutation " + path)
        if path == "git/ref/heads/main":
            return self.reference("main", self.main)
        if path == "issues/529":
            return deepcopy(self.issue)
        if path.startswith("git/ref/heads/automation/module-versions-"):
            return self.reference(self.branch, COMMIT) if self.branch else None
        if path.startswith("pulls?"):
            return [deepcopy(self.pr)] if self.pr else []
        if path == "git/commits/" + self.source:
            return {"sha": self.source, "tree": {"sha": TREE}}
        if path == "git/commits/" + COMMIT:
            return {"sha": COMMIT, "tree": {"sha": NEW_TREE}, "parents": [{"sha": self.source}]}
        if path == "git/blobs/" + BLOB or path.startswith("contents/" + bot.CATALOG):
            return {"sha": BLOB, "path": bot.CATALOG, "encoding": "base64", "content": base64.b64encode(self.raw).decode()}
        if path == "git/trees/" + NEW_TREE:
            return {"sha": NEW_TREE}
        if path.startswith("compare/"):
            return {"total_commits": 1, "files": self.diff_files}
        if path == "pulls/12":
            return deepcopy(self.pr)
        raise AssertionError("Unexpected read " + path)

    @staticmethod
    def reference(branch, revision):
        return {"ref": "refs/heads/" + branch, "object": {"type": "commit", "sha": revision,
            "url": f"https://api.github.com/repos/{bot.REPOSITORY}/git/commits/{revision}"}}


class ModuleVersionPrTests(unittest.TestCase):
    def setUp(self):
        self.current, self.plan = fixture()
        # Deliberately preserve compact arrays and noncanonical key order.
        self.raw = (json.dumps(self.current, indent="\t") + "\n").encode().replace(
            b'[\n\t\t\t\t"src/"\n\t\t\t]', b'["src/"]')
        self.api = FakeGitHub()

    def publish(self):
        return bot.open_proposal(self.api, self.plan, self.raw, 529, {"integration/OSS-011"})

    def test_creates_only_catalog_commit_bot_branch_and_reviewed_pr(self):
        self.assertEqual(self.publish()["state"], "pull-request-opened-and-verified")
        writes = [(path.rsplit("/", 1)[-1], payload) for path, method, payload in self.api.calls if method == "POST"]
        self.assertEqual([path for path, _ in writes], ["blobs", "trees", "commits", "refs", "pulls"])
        self.assertEqual(self.api.raw, self.raw.replace(b'"version": "1.7.1"', b'"version": "1.7.2"'))
        self.assertNotEqual(self.api.raw, bot.encoded(self.plan["proposedCatalog"]))
        self.assertFalse(writes[-1][1]["maintainer_can_modify"])

    def test_existing_exact_branch_and_pr_are_verified_without_another_write(self):
        self.publish()
        self.api.calls.clear()
        self.assertEqual(self.publish()["state"], "existing-pull-request-verified")
        self.assertTrue(all(method == "GET" for _, method, _ in self.api.calls))

    def test_metadata_only_proposal_does_not_touch_github(self):
        self.plan["hasChanges"] = False
        self.assertEqual(self.publish()["state"], "no-module-bump-required")
        self.assertEqual(self.api.calls, [])

    def test_feature_pr_review_guard_does_not_analyze_or_use_github(self):
        with patch.object(bot, "git") as git, patch.object(bot, "GitHub") as github:
            result = bot.review_head(Path("/repo"), "codex/feature-work", TREE, SOURCE)
        self.assertEqual(result["state"], "ordinary-feature-pr")
        git.assert_not_called()
        github.assert_not_called()

    def test_bot_review_rejects_multiple_source_parents(self):
        branch = "automation/module-versions-" + TREE[:12] + "-" + "f" * 12
        with patch.object(bot, "git", return_value=f"{SOURCE} {TREE} {COMMIT}\n".encode()) as git:
            with self.assertRaisesRegex(bot.Held, "source parent changed"):
                bot.review_head(Path("/repo"), branch, TREE, SOURCE)
        git.assert_called_once()

    def test_main_drift_holds_before_any_write(self):
        self.api.main = "f" * 40
        with self.assertRaisesRegex(bot.Held, "Main moved"):
            self.publish()
        self.assertFalse(any(method != "GET" for _, method, _ in self.api.calls))

    def test_nonversion_catalog_mutation_is_rejected(self):
        self.plan["proposedCatalog"]["modules"]["web"]["paths"] = ["*"]
        with self.assertRaisesRegex(bot.Held, "non-version"):
            self.publish()
        self.assertEqual(self.api.calls, [])

    def test_unregistered_or_pull_request_issue_holds_before_write(self):
        for issue in ({"number": 529, "body": "<!-- warpdrive:delivery-id:fake -->"},
                      {"number": 529, "body": self.api.issue["body"], "pull_request": {}}):
            self.api.issue = issue
            with self.assertRaisesRegex(bot.Held, "canonical delivery"):
                self.publish()
        self.assertFalse(any(method != "GET" for _, method, _ in self.api.calls))

    def test_unknown_pr_ack_is_not_retried_and_existing_branch_blocks_recreation(self):
        self.api.lost_pr_ack = True
        with self.assertRaises(bot.UnknownMutation):
            self.publish()
        self.assertEqual(sum(method == "POST" and path.endswith("/pulls") for path, method, _ in self.api.calls), 1)
        self.api.calls.clear()
        with self.assertRaisesRegex(bot.Held, "reconcile pending mutation"):
            self.publish()
        self.assertTrue(all(method == "GET" for _, method, _ in self.api.calls))

    def test_existing_branch_with_other_files_is_never_adopted_or_rewritten(self):
        self.publish()
        self.api.calls.clear()
        self.api.diff_files.append({"filename": "src/server/auth.ts", "status": "modified"})
        with self.assertRaisesRegex(bot.Held, "catalog-only"):
            self.publish()
        self.assertTrue(all(method == "GET" for _, method, _ in self.api.calls))

    def test_existing_foreign_closed_or_automerge_pr_holds(self):
        self.publish()
        original = deepcopy(self.api.pr)
        for mutate in (lambda row: row.update(state="closed"), lambda row: row.update(auto_merge={"enabled": True}),
                       lambda row: row["head"]["repo"].update(full_name="someone/fork")):
            self.api.pr = deepcopy(original)
            mutate(self.api.pr)
            with self.assertRaisesRegex(bot.Held, "review-only policy"):
                self.publish()

    def test_mutation_timeout_records_pending_once_and_blocks_local_reentry(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "mutation-state.json"
            api = bot.GitHub(receipt)
            with patch.object(bot.subprocess, "run", side_effect=subprocess.TimeoutExpired("gh", 20)) as run:
                with self.assertRaises(bot.UnknownMutation):
                    api.request(bot.endpoint("pulls"), "POST", {"head": "example"})
            self.assertEqual(run.call_count, 1)
            self.assertEqual(json.loads(receipt.read_bytes())["state"], "pending")
            with self.assertRaisesRegex(bot.Held, "Unresolved mutation"):
                bot.GitHub(receipt)

    def test_read_404_is_distinguished_from_network_or_malformed_read(self):
        with tempfile.TemporaryDirectory() as directory:
            api = bot.GitHub(Path(directory) / "state.json")
            response = subprocess.CompletedProcess([], 1, b'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}', b"")
            with patch.object(bot.subprocess, "run", return_value=response) as run:
                self.assertIsNone(api.request(bot.endpoint("git/ref/heads/example"), missing=True))
            self.assertLessEqual(run.call_args.kwargs["timeout"], 20)
            self.assertIn("github.com", run.call_args.args[0])

    def test_analysis_subprocess_receives_no_write_token(self):
        response = subprocess.CompletedProcess([], 0, b"{}", b"")
        with patch.dict(bot.os.environ, {"GH_TOKEN": "do-not-forward", "GITHUB_TOKEN": "also-secret"}), \
                patch.object(bot.subprocess, "run", return_value=response) as run:
            bot.local(["python3", "trusted.py"], Path("."))
        self.assertNotIn("GH_TOKEN", run.call_args.kwargs["env"])
        self.assertNotIn("GITHUB_TOKEN", run.call_args.kwargs["env"])

    def test_larger_local_read_requires_explicit_bounded_allowance_and_api_stays_small(self):
        payload = b"x" * (bot.MAX_BYTES + 1)
        response = subprocess.CompletedProcess([], 0, payload, b"")
        with patch.object(bot.subprocess, "run", return_value=response):
            with self.assertRaisesRegex(bot.Held, "Bounded local"):
                bot.local(["git", "show", "fixture"], Path("."))
            self.assertEqual(bot.local(["git", "show", "fixture"], Path("."), maximum=bot.versions.MAX_JSON), payload)
            for invalid in (True, 0, bot.versions.MAX_JSON + 1):
                with self.subTest(maximum=invalid), self.assertRaisesRegex(bot.Held, "allowance"):
                    bot.local(["git", "show", "fixture"], Path("."), maximum=invalid)
        with tempfile.TemporaryDirectory() as directory:
            api = bot.GitHub(Path(directory) / "state.json")
            oversized = subprocess.CompletedProcess([], 0, b'HTTP/2.0 200 OK\r\n\r\n' + payload, b"")
            with patch.object(bot.subprocess, "run", return_value=oversized):
                with self.assertRaisesRegex(bot.Held, "GitHub read failed"):
                    api.request(bot.endpoint("git/ref/heads/main"))

    def test_engine_cli_uses_global_repo_and_explicit_bounded_intent(self):
        with patch.object(bot, "local", return_value=json.dumps(self.plan).encode()) as local:
            result = bot.proposal(Path("/repo"), self.plan["baseRevision"], SOURCE, Path("/tmp/intent.json"))
        command = local.call_args.args[0]
        self.assertEqual(command[3:6], ["--repo", "/repo", "plan"])
        self.assertEqual(command[-2:], ["--changes", "/tmp/intent.json"])
        self.assertEqual(result, self.plan)

    def test_no_additional_mutation_follows_a_failed_branch_readback(self):
        original = self.api.request
        def changed(path, method="GET", payload=None, missing=False):
            if method == "GET" and path.endswith("git/ref/heads/" + str(self.api.branch)) and self.api.branch:
                raise bot.Held("branch readback unavailable")
            return original(path, method, payload, missing)
        with patch.object(self.api, "request", side_effect=changed), self.assertRaisesRegex(bot.Held, "readback unavailable"):
            self.publish()
        self.assertFalse(any(method == "POST" and path.endswith("/pulls") for path, method, _ in self.api.calls))

    def test_open_pr_rejects_pull_request_event_before_engine_or_github(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(bot.os.environ, {
                "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": bot.REPOSITORY,
                "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SOURCE, "GITHUB_EVENT_NAME": "pull_request"}), \
                patch.object(bot, "proposal") as plan:
            self.assertEqual(bot.main(["open-pr", "--head", SOURCE, "--output", directory]), 1)
            plan.assert_not_called()

    def test_workflow_scopes_write_to_separate_exact_main_job(self):
        workflow = (bot.ROOT / ".github/workflows/module-versions.yml").read_text()
        self.assertNotIn("pull_request_target", workflow)
        readonly, privileged = workflow.split("  bump-pr:\n", 1)
        self.assertNotIn("GH_TOKEN", readonly)
        self.assertNotIn("contents: write", readonly)
        self.assertNotIn("${{ secrets.", workflow)
        self.assertIn("ref: ${{ github.sha }}", privileged)
        self.assertIn("github.repository == 'KhademOHAli1/warpdrive'", workflow)
        self.assertEqual(workflow.count("contents: write"), 1)
        self.assertEqual(workflow.count("pull-requests: write"), 1)
        self.assertNotIn("automerge", workflow)
        self.assertIn("-p 'module_*_test.py'", readonly)
        required = (bot.ROOT / ".github/workflows/required-quality.yml").read_text().split("  release-pr:\n", 1)[1]
        self.assertIn("name: Release PR validation", required)
        self.assertIn("if: github.event_name == 'pull_request'", required)
        self.assertIn("module_version_pr.py review-check", required)
        self.assertIn("github.event.pull_request.base.sha", required)


class CumulativeProposalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.command("init", "--quiet")
        self.command("config", "user.name", "Module bot tests")
        self.command("config", "user.email", "module-bot@example.invalid")
        self.current, _ = fixture()
        self.write("package.json", {"name": "fixture", "version": "1.7.1", "dependencies": {"x": "1"}})
        self.write("src/index.ts", "export const version = 1;\n")
        self.before_catalog = self.commit("Source before catalog")
        self.write(bot.CATALOG, self.current)
        self.baseline = self.commit("Introduce source module catalog")

    def command(self, *arguments):
        value = subprocess.run(["git", "-C", str(self.root), *arguments], capture_output=True, timeout=10)
        self.assertEqual(value.returncode, 0, value.stderr.decode())
        return value.stdout.decode().strip()

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, indent=2) + "\n" if isinstance(value, dict) else value)

    def commit(self, message):
        self.command("add", "--all")
        self.command("commit", "--quiet", "-m", message)
        return self.command("rev-parse", "HEAD")

    def propose(self, head, base=None):
        output = Path(self.temporary.name) / "proposal"
        args = ["propose", "--repo", str(self.root), "--head", head, "--output", str(output)]
        if base:
            args += ["--base", base]
        with patch("sys.stdout", new=io.StringIO()), patch.object(bot, "GitHub") as github:
            self.assertEqual(bot.main(args), 0)
        github.assert_not_called()
        return json.loads((output / "proposal.json").read_bytes())

    def test_first_catalog_pr_is_a_non_bumping_source_baseline(self):
        plan = self.propose(self.baseline, self.before_catalog)
        self.assertTrue(plan["bootstrap"])
        self.assertFalse(plan["hasChanges"])
        self.assertIsNone(plan["modules"]["web"]["previousVersion"])
        self.assertEqual(plan["modules"]["web"]["proposedVersion"], "1.7.1")

    def test_main_sweep_covers_successive_pushes_and_stops_after_catalog_bump(self):
        self.write("src/first.ts", "first source change\n")
        self.commit("First main push")
        self.write("src/second.ts", "second source change\n")
        head = self.commit("Second main push")
        plan = self.propose(head)
        self.assertEqual(plan["baseRevision"], self.baseline)
        self.assertEqual(plan["modules"]["web"]["changedPaths"], ["src/first.ts", "src/second.ts"])
        self.assertEqual(plan["modules"]["web"]["proposedVersion"], "1.7.2")
        self.write(bot.CATALOG, plan["proposedCatalog"])
        bumped = self.commit("Reviewed catalog-only module bump")
        after = self.propose(bumped)
        self.assertEqual(after["baseRevision"], bumped)
        self.assertFalse(after["hasChanges"])
        self.assertEqual(after["modules"]["web"]["currentVersion"], "1.7.2")

    def test_product_version_only_is_noop_but_real_dependency_change_counts(self):
        self.write("package.json", {"name": "fixture", "version": "1.7.2", "dependencies": {"x": "1"}})
        self.write("docs/delivery/releases/1.7.2.json", {"version": "1.7.2"})
        metadata = self.commit("Product release metadata")
        self.assertFalse(self.propose(metadata)["hasChanges"])
        self.write("package.json", {"name": "fixture", "version": "1.7.2", "dependencies": {"x": "2"}})
        dependency = self.commit("Actual dependency update")
        plan = self.propose(dependency)
        self.assertEqual(plan["baseRevision"], self.baseline)
        self.assertTrue(plan["hasChanges"])
        self.assertEqual(plan["modules"]["web"]["changedPaths"], ["package.json"])

    def large_roadmap(self):
        self.write("docs/delivery/roadmap.json", {"items": [
            {"id": "integration/OSS-011", "description": "r" * 3800000}]})
        size = (self.root / "docs/delivery/roadmap.json").stat().st_size
        self.assertGreater(size, bot.MAX_BYTES)
        self.assertLess(size, bot.versions.MAX_JSON)

    def trusted_open(self, head, output):
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": bot.REPOSITORY,
                       "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": head, "GITHUB_EVENT_NAME": "push"}
        with patch.dict(bot.os.environ, environment), patch("sys.stdout", new=io.StringIO()):
            return bot.main(["open-pr", "--repo", str(self.root), "--head", head, "--output", str(output)])

    def test_trusted_noop_with_real_large_roadmap_never_reads_it_or_constructs_github(self):
        self.large_roadmap()
        head = self.commit("Large committed roadmap without source impact")
        output = Path(self.temporary.name) / "trusted-noop"
        with patch.object(bot, "GitHub") as github, patch.object(bot, "git", wraps=bot.git) as git:
            self.assertEqual(self.trusted_open(head, output), 0)
        github.assert_not_called()
        self.assertFalse(any("roadmap.json" in str(call) for call in git.call_args_list))
        self.assertEqual(json.loads((output / "result.json").read_bytes()),
                         {"state": "no-module-bump-required", "sourceRevision": head})
        self.assertFalse(json.loads((output / "proposal.json").read_bytes())["hasChanges"])
        self.assertFalse((output / "mutation-state.json").exists())

    def test_trusted_affected_cli_reads_large_roadmap_and_only_uses_mock_api(self):
        self.large_roadmap()
        self.write("src/changed.ts", "Actual module implementation change\n")
        head = self.commit("Module source change with large committed roadmap")
        output = Path(self.temporary.name) / "trusted-affected"
        api = FakeGitHub(source=head)
        with patch.object(bot, "GitHub", return_value=api), patch.object(bot, "git", wraps=bot.git) as git:
            self.assertEqual(self.trusted_open(head, output), 0)
        reads = [call for call in git.call_args_list if "roadmap.json" in str(call)]
        self.assertEqual(len(reads), 1)
        self.assertEqual(reads[0].args, (self.root, "show", head + ":docs/delivery/roadmap.json"))
        self.assertEqual(reads[0].kwargs, {"maximum": bot.versions.MAX_JSON})
        self.assertEqual(json.loads((output / "result.json").read_bytes())["state"], "pull-request-opened-and-verified")
        self.assertTrue(json.loads((output / "proposal.json").read_bytes())["hasChanges"])
        self.assertEqual(len([call for call in api.calls if call[1] == "POST"]), 5)
        self.assertEqual(json.loads(api.raw)["modules"]["web"]["version"], "1.7.2")

    def test_bot_review_requires_current_source_parent_and_version_only_tokens(self):
        proposal_id = "f" * 64
        branch = "automation/module-versions-" + self.baseline[:12] + "-" + proposal_id[:12]
        changed = deepcopy(self.current)
        changed["modules"]["web"]["version"] = "1.7.2"
        self.write(bot.CATALOG, changed)
        head = self.commit("chore: bump source module versions\n\nSource-Revision: " + self.baseline +
                           "\nProposal-SHA256: " + proposal_id)
        self.assertEqual(bot.review_head(self.root, branch, self.baseline, head)["state"],
                         "current-main-catalog-only-bot-pr")
        for base, bad_branch in ((head, branch), (self.baseline, branch + "-extra"),
                                 (self.baseline, "automation/module-versions-" + "0" * 12 + "-" + "f" * 12)):
            with self.subTest(base=base, branch=bad_branch), self.assertRaises(bot.Held):
                bot.review_head(self.root, bad_branch, base, head)
        self.write("src/extra.ts", "Other source must not enter a bot bump\n")
        foreign = self.commit("Source change on an existing module bot branch")
        with self.assertRaisesRegex(bot.Held, "stale"):
            bot.review_head(self.root, branch, self.baseline, foreign)

    def test_bot_review_rejects_nonversion_formatting_or_scope_changes(self):
        changed = deepcopy(self.current)
        changed["modules"]["web"]["version"] = "1.7.2"
        # Same semantics, different JSON indentation is outside bot ownership.
        (self.root / bot.CATALOG).write_bytes(bot.encoded(changed))
        head = self.commit("chore: bump source module versions\n\nSource-Revision: " + self.baseline +
                           "\nProposal-SHA256: " + "f" * 64)
        branch = "automation/module-versions-" + self.baseline[:12] + "-" + "f" * 12
        with self.assertRaisesRegex(bot.Held, "formatting"):
            bot.review_head(self.root, branch, self.baseline, head)

    def test_bot_review_rejects_other_source_changes_with_valid_markers(self):
        changed = deepcopy(self.current)
        changed["modules"]["web"]["version"] = "1.7.2"
        self.write(bot.CATALOG, changed)
        self.write("src/foreign.ts", "Not a catalog-only proposal\n")
        head = self.commit("chore: bump source module versions\n\nSource-Revision: " + self.baseline +
                           "\nProposal-SHA256: " + "f" * 64)
        branch = "automation/module-versions-" + self.baseline[:12] + "-" + "f" * 12
        with self.assertRaisesRegex(bot.Held, "only the existing catalog"):
            bot.review_head(self.root, branch, self.baseline, head)


if __name__ == "__main__":
    unittest.main()
