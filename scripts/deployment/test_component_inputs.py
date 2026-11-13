"""Cross-language receipt integrity and fresh-discovery admission, not deployment proof."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import component_inputs as inputs


def fixture(root):
    files = {path: path.encode() for path in inputs.POLICY_SOURCES}
    files.update({"src/" + name + ".ts": name.encode() for name in inputs.COMPONENTS})
    for path, data in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    def record(path):
        return {"path": path, "sha256": hashlib.sha256(files[path]).hexdigest(), "bytes": len(files[path])}
    context = {"baseImage": "oven/bun@sha256:" + "a" * 64, "platform": "linux/amd64",
               "buildArgs": {"APP_VERSION": "", "NEXT_PUBLIC_WS_URL": "same-origin"}}
    entries = {name: [{"in": "src/" + name + ".ts", "out": "dist/" + name + ".mjs"}] for name in inputs.COMPONENTS}
    policy = {"version": 1, "context": context, "sharedFiles": sorted(inputs.POLICY_SOURCES), "sharedTrees": [],
              "rootTsconfigFiles": True, "runtimeAssets": {}, "limits": {"files": inputs.MAX_FILES,
              "fileBytes": inputs.MAX_FILE_BYTES, "totalBytes": inputs.MAX_TOTAL_BYTES, "graphInputs": inputs.MAX_GRAPH_INPUTS},
              "policySources": [record(path) for path in sorted(inputs.POLICY_SOURCES)], "entries": entries,
              "esbuild": {}, "web": {}, "revision": inputs.REVISION_POLICY}
    policy_hash = inputs.content_hash(policy)
    components = {}
    for name in inputs.COMPONENTS:
        source = "src/" + name + ".ts"
        records = [record(path) for path in sorted([*inputs.POLICY_SOURCES, source])]
        components[name] = {"inputPolicySha256": policy_hash, "componentInputSha256": inputs.content_hash({
            "inputPolicySha256": policy_hash, "inputs": records}), "graphInputs": [source], "inputs": records,
            "helperEntries": entries[name], "graphKind": "esbuild-helpers-plus-conservative-repository-sources" if name == "web"
            else "fresh-esbuild-transitive-application-inputs", "limitations": ["Fixture declared metadata only"]}
    return {"schemaVersion": 1, "kind": "warpdrive-component-inputs", "inputPolicySha256": policy_hash,
            "policy": policy, "context": context, "components": components}


def rehash(value):
    value["inputPolicySha256"] = inputs.content_hash(value["policy"])
    for component in value["components"].values():
        component["inputPolicySha256"] = value["inputPolicySha256"]
        component["componentInputSha256"] = inputs.content_hash({"inputPolicySha256": value["inputPolicySha256"], "inputs": component["inputs"]})
    return value


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.value = fixture(self.root)

    def test_complete_receipt_and_current_file_contents_validate_without_deployment_authority(self):
        self.assertIs(inputs.validate_receipt(self.value), self.value)
        self.assertIs(inputs.verify_files(self.root, self.value), self.value)
        self.assertNotIn("deploymentAuthorized", self.value)

    def test_changed_file_cannot_reuse_retained_input_digest(self):
        (self.root / "src/worker.ts").write_bytes(b"changed worker dependency")
        with self.assertRaises(inputs.InputError):
            inputs.verify_files(self.root, self.value)

    def test_metadata_policy_component_and_inventory_substitutions_reject(self):
        for mutate in (
            lambda item: item.update(schemaVersion=True),
            lambda item: item["policy"].update(version=2),
            lambda item: item["context"].update(platform="linux/arm64"),
            lambda item: item["components"]["web"].update(componentInputSha256="0" * 64),
            lambda item: item["components"]["worker"]["inputs"].reverse(),
            lambda item: item["components"]["worker"]["inputs"].append(item["components"]["worker"]["inputs"][0]),
            lambda item: item["components"].pop("worker"),
        ):
            bad = copy.deepcopy(self.value)
            mutate(bad)
            with self.assertRaises(inputs.InputError):
                inputs.validate_receipt(bad)

    def test_self_consistent_but_unsafe_path_or_conflicting_inventory_rejects(self):
        for path in ("../outside", "/absolute", "src//worker.ts", "src\\worker.ts", "src/./worker.ts", "src/\0worker.ts"):
            bad = copy.deepcopy(self.value)
            bad["components"]["worker"]["inputs"][-1]["path"] = path
            rehash(bad)
            with self.subTest(path=path), self.assertRaises(inputs.InputError):
                inputs.validate_receipt(bad)
        bad = copy.deepcopy(self.value)
        bad["components"]["worker"]["inputs"][0]["sha256"] = "f" * 64
        rehash(bad)
        with self.assertRaises(inputs.InputError):
            inputs.validate_receipt(bad)

    def test_symlink_leaf_or_ancestor_cannot_escape_source_root(self):
        external = self.root / "outside"
        external.write_bytes(b"worker")
        path = self.root / "src/worker.ts"
        path.unlink()
        path.symlink_to(external)
        with self.assertRaises((inputs.InputError, OSError)):
            inputs.verify_files(self.root, self.value)
        path.unlink()
        path.write_bytes(b"worker")
        (self.root / "src").rename(self.root / "real-src")
        (self.root / "src").symlink_to(self.root / "real-src", target_is_directory=True)
        with self.assertRaises((inputs.InputError, OSError)):
            inputs.verify_files(self.root, self.value)

    def test_fifo_does_not_block_verifier(self):
        path = self.root / "src/worker.ts"
        path.unlink()
        os.mkfifo(path)
        with self.assertRaises(inputs.InputError):
            inputs.verify_files(self.root, self.value)

    def test_receipt_loader_rejects_fifo_symlink_or_oversize_before_reading(self):
        path = self.root / "receipt.json"
        os.mkfifo(path)
        with self.assertRaises(inputs.InputError):
            inputs.load_receipt(path)
        path.unlink()
        target = self.root / "real-receipt.json"
        target.write_text(json.dumps(self.value))
        path.symlink_to(target)
        with self.assertRaises((inputs.InputError, OSError)):
            inputs.load_receipt(path)
        path.unlink()
        path.write_bytes(b" " * 2048)
        with patch.object(inputs, "MAX_JSON_BYTES", 1024), self.assertRaises(inputs.InputError):
            inputs.load_receipt(path)

    def test_unknown_build_argument_and_missing_policy_source_cannot_be_rehashed_into_acceptance(self):
        for change in ("argument", "policy-source"):
            bad = copy.deepcopy(self.value)
            if change == "argument":
                bad["context"]["buildArgs"]["APP_COMMIT"] = "a" * 40
            else:
                bad["policy"]["policySources"].pop()
            rehash(bad)
            with self.subTest(change=change), self.assertRaises(inputs.InputError):
                inputs.validate_receipt(bad)

    def test_new_dependency_cannot_hide_behind_self_consistent_retained_inventory(self):
        fresh = copy.deepcopy(self.value)
        content = b"newly imported dependency"
        (self.root / "src/new.ts").write_bytes(content)
        component = fresh["components"]["worker"]
        component["inputs"].append({"path": "src/new.ts", "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
        component["inputs"].sort(key=lambda item: item["path"])
        component["graphInputs"] = sorted([*component["graphInputs"], "src/new.ts"])
        rehash(fresh)
        # Merely hashing the old supplied list succeeds. Fresh discovery is mandatory.
        inputs.verify_files(self.root, self.value)
        with patch.object(inputs, "_discover", return_value=inputs.canonical(fresh)):
            with self.assertRaisesRegex(inputs.InputError, "fresh dependency discovery differs"):
                inputs.verify_current(self.root, self.value)

    def test_current_verification_uses_fixed_arguments_and_removes_inherited_node_hooks(self):
        with patch.dict(os.environ, {"NODE_OPTIONS": "--require=/private/hook", "SECRET_ENV": "private"}), \
                patch.object(inputs, "_discover", return_value=inputs.canonical(self.value)) as discover:
            inputs.verify_current(self.root, self.value)
        arguments, root, environment = discover.call_args.args
        self.assertEqual(arguments[:2], ["node", "scripts/deployment/component_inputs.mjs"])
        self.assertEqual(root, self.root)
        self.assertNotIn("NODE_OPTIONS", environment)
        self.assertNotIn("SECRET_ENV", environment)

    def test_candidate_source_binding_rejects_wrong_head_dirty_or_untracked_build_input(self):
        def git(*args):
            return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        git("init", "--quiet")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "source inputs")
        revision = git("rev-parse", "HEAD")
        inputs.verify_source_revision(self.root, self.value, revision)
        with self.assertRaises(inputs.InputError):
            inputs.verify_source_revision(self.root, self.value, "f" * 40)
        source = self.root / "src/worker.ts"
        source.write_bytes(b"modified tracked input")
        with self.assertRaises(inputs.InputError):
            inputs.verify_source_revision(self.root, self.value, revision)
        git("restore", "src/worker.ts")
        content = b"untracked input"
        (self.root / "src/new.ts").write_bytes(content)
        bad = copy.deepcopy(self.value)
        bad["components"]["worker"]["inputs"].append({"path": "src/new.ts", "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
        bad["components"]["worker"]["inputs"].sort(key=lambda row: row["path"])
        rehash(bad)
        inputs.verify_files(self.root, bad)
        with self.assertRaisesRegex(inputs.InputError, "not retained"):
            inputs.verify_source_revision(self.root, bad, revision)

    def test_head_blob_binding_rejects_fresh_receipts_for_index_hidden_changes(self):
        def git(*args):
            return subprocess.run(["git", *args], cwd=self.root, capture_output=True,
                                  text=True, timeout=10, check=True).stdout.strip()
        git("init", "--quiet")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "commit", "--quiet", "-m", "source inputs")
        revision = git("rev-parse", "HEAD")
        source = self.root / "src/worker.ts"
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                git("update-index", "--" + flag, "src/worker.ts")
                try:
                    changed = b"changed input hidden from ordinary git diff"
                    source.write_bytes(changed)
                    fresh = copy.deepcopy(self.value)
                    record = next(row for row in fresh["components"]["worker"]["inputs"]
                                  if row["path"] == "src/worker.ts")
                    record.update(sha256=hashlib.sha256(changed).hexdigest(), bytes=len(changed))
                    rehash(fresh)
                    # Both old conditions succeed: diff is quiet and all paths exist
                    # in HEAD. Even a freshly valid receipt must match HEAD bytes.
                    git("diff", "--quiet", "HEAD", "--")
                    inputs.verify_files(self.root, fresh)
                    with self.assertRaisesRegex(inputs.InputError, "HEAD input blob|exact HEAD blob"):
                        inputs.verify_source_revision(self.root, fresh, revision)
                finally:
                    source.write_bytes(b"worker")
                    git("update-index", "--no-" + flag, "src/worker.ts")
        inputs.verify_source_revision(self.root, self.value, revision)

    def test_duplicate_json_and_noncanonical_numbers_unicode_or_extra_fields_reject(self):
        with self.assertRaises(inputs.InputError):
            inputs.decode('{"schemaVersion":1,"schemaVersion":1}')
        for item in (float("nan"), 1.5, 2 ** 53, "\ud800"):
            with self.subTest(item=repr(item)), self.assertRaises(inputs.InputError):
                inputs.canonical(item)
        self.assertEqual(inputs.canonical({"é": 1, "a": [True, None]}), '{"a":[true,null],"é":1}'.encode())
        with self.assertRaises(inputs.InputError):
            inputs.validate_receipt({**self.value, "deploymentAuthorized": True})


class DiscoveryProcessTests(unittest.TestCase):
    def test_bad_head_blob_response_kills_and_reaps_owned_child(self):
        create, owned = subprocess.Popen, []
        def start(*arguments, **options):
            process = create(*arguments, **options)
            owned.append(process)
            return process
        with patch.object(inputs.subprocess, "Popen", side_effect=start):
            with self.assertRaisesRegex(inputs.InputError, "HEAD input blob identity"):
                inputs._verify_head_blobs(
                    [sys.executable, "-c", "import sys,time;sys.stdin.readline();print('invalid blob response',flush=True);time.sleep(60)"],
                    Path.cwd(), {}, {"a" * 40: {"sha256": "b" * 64, "bytes": 1}})
        self.assertEqual(len(owned), 1)
        self.assertIsNotNone(owned[0].poll())

    def test_head_blob_deadline_kills_and_reaps_owned_child(self):
        timer, create, owned = threading.Timer, subprocess.Popen, []
        def start(*arguments, **options):
            process = create(*arguments, **options)
            owned.append(process)
            return process
        with patch.object(inputs.threading, "Timer", side_effect=lambda seconds, callback: timer(0.05, callback)), \
                patch.object(inputs.subprocess, "Popen", side_effect=start):
            with self.assertRaises(inputs.InputError):
                inputs._verify_head_blobs(
                    [sys.executable, "-c", "import sys,time;sys.stdin.readline();time.sleep(60)"],
                    Path.cwd(), {}, {"a" * 40: {"sha256": "b" * 64, "bytes": 1}})
        self.assertEqual(len(owned), 1)
        self.assertIsNotNone(owned[0].poll())

    def test_stream_budget_kills_and_reaps_owned_child(self):
        create, owned = subprocess.Popen, []
        def start(*arguments, **options):
            process = create(*arguments, **options)
            owned.append(process)
            return process
        with patch.object(inputs, "MAX_JSON_BYTES", 1024), patch.object(inputs.subprocess, "Popen", side_effect=start):
            with self.assertRaisesRegex(inputs.InputError, "byte budget"):
                inputs._discover([sys.executable, "-c", "import sys,time;sys.stdout.buffer.write(b'x'*4096);sys.stdout.flush();time.sleep(60)"], Path.cwd(), {})
        self.assertEqual(len(owned), 1)
        self.assertIsNotNone(owned[0].poll())

    def test_deadline_kills_owned_group_without_waiting_for_child_sleep(self):
        timer = threading.Timer
        with patch.object(inputs.threading, "Timer", side_effect=lambda seconds, callback: timer(0.05, callback)):
            with self.assertRaisesRegex(inputs.InputError, "discovery failed"):
                inputs._discover([sys.executable, "-c", "import time;time.sleep(60)"], Path.cwd(), {})


if __name__ == "__main__":
    unittest.main()
