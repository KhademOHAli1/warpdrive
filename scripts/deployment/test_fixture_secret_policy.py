"""Expire the intentional fixture-plaintext review when its source scope changes."""
from __future__ import annotations

import ast
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import tokenize
import unittest


ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / "docs/deployment-evidence/fixture-codeql-exception-20261112.json"
QUERY = "py/clear-text-storage-sensitive-data"
SINK = "scripts/deployment/engine_image_smoke.py"
SOURCES = {SINK, "scripts/deployment/test_engine_image_smoke.py",
           "scripts/deployment/image_smoke.py", ".github/workflows/production-engine.yml"}
CALLERS = {SINK, "scripts/deployment/test_engine_image_smoke.py"}
HELPER = "write_synthetic_secret"


def pinned_source(path: Path, expected: str) -> bytes:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024**2:
        raise ValueError("Reviewed fixture source is not a bounded regular file")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError("Fixture source changed; independent plaintext review must be refreshed")
    return raw


class FixtureSecretReviewTests(unittest.TestCase):
    def review(self):
        self.assertFalse(REVIEW.is_symlink())
        self.assertLess(REVIEW.stat().st_size, 64 * 1024)
        review = json.loads(REVIEW.read_text())
        self.assertEqual(review["schemaVersion"], 2)
        self.assertEqual(review["kind"], "source-bound-intentional-fixture-plaintext-review")
        self.assertEqual(review["queryId"], QUERY)
        self.assertEqual(review["reviewedPath"], SINK)
        self.assertEqual(set(review["sourceSha256"]), SOURCES)
        self.assertIs(review["securityGateCleanClaim"], False)
        self.assertIs(review["canonicalAcceptanceClaim"], False)
        witness = review["independentReview"]
        self.assertEqual(witness["path"], "docs/deployment-evidence/fixture-engine-lifecycle-review-20261114.json")
        self.assertEqual(witness["reviewer"], "/root/rollback_review")
        prior = json.loads(pinned_source(ROOT / witness["path"], witness["sha256"]))
        self.assertEqual(prior["reviewer"], "/root/rollback_review")
        self.assertEqual(review["sourceSha256"], prior["sourceSha256"])
        self.assertEqual(prior["currentAnnotations"]["engineQueryAnnotationCount"], 0)
        self.assertIs(prior["method"]["plaintextSinkRemainsDirectAndVisible"], True)
        self.assertIs(prior["securityGateCleanClaim"], False)
        self.assertIs(prior["canonicalAcceptanceClaim"], False)
        self.assertIs(review["annotationAttempt"]["effectiveInObservedManagedAnalysis"], False)
        self.assertIs(review["alertDismissalApplied"], False)
        return review

    def test_exact_reviewed_sources_and_visible_unsuppressed_sink(self):
        review = self.review()
        for name, expected in review["sourceSha256"].items():
            self.assertRegex(expected, r"^[a-f0-9]{64}$")
            raw = pinned_source(ROOT / name, expected)
            if name != SINK:
                continue
            comments = [token for token in tokenize.tokenize(io.BytesIO(raw).readline)
                        if token.type == tokenize.COMMENT
                        and ("codeql[" in token.string or "lgtm[" in token.string)]
            self.assertEqual(comments, [])
            writer = next(node for node in ast.parse(raw).body
                          if isinstance(node, ast.FunctionDef) and node.name == HELPER)
            writes = [node for node in ast.walk(writer) if isinstance(node, ast.Call)
                      and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
                      and node.func.value.id == "payload" and node.func.attr == "write"]
            self.assertEqual(len(writes), 1)
            self.assertEqual(ast.dump(writes[0].args[0]), ast.dump(ast.Name(id="password", ctx=ast.Load())))

    def test_new_direct_or_import_aliased_callers_require_review(self):
        found = set()
        paths = list(ROOT.glob("*.py"))
        for name in ("src", "scripts", "deploy", "tools"):
            for directory, children, files in os.walk(ROOT / name, followlinks=False):
                children[:] = [child for child in children if child not in {"node_modules", "__pycache__"}]
                for child in children:
                    self.assertFalse((Path(directory) / child).is_symlink())
                paths.extend(Path(directory) / file for file in files if file.endswith(".py"))
        self.assertLess(len(paths), 1024)
        total = 0
        for path in paths:
            self.assertFalse(path.is_symlink())
            self.assertLess(path.stat().st_size, 1024**2)
            source = path.read_text()
            total += len(source.encode())
            self.assertLess(total, 16 * 1024**2)
            tree = ast.parse(source)
            names = {HELPER}
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    names.update(alias.asname or alias.name for alias in node.names if alias.name == HELPER)
            calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                     and ((isinstance(node.func, ast.Name) and node.func.id in names)
                          or (isinstance(node.func, ast.Attribute) and node.func.attr == HELPER))]
            if calls:
                found.add(path.relative_to(ROOT).as_posix())
        self.assertEqual(found, CALLERS)

    def test_source_drift_and_symlinks_cannot_reuse_the_review(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reviewed.py"
            raw = b"fixture_scope = 1\n"
            path.write_bytes(raw)
            expected = hashlib.sha256(raw).hexdigest()
            self.assertEqual(pinned_source(path, expected), raw)
            path.write_bytes(raw + b"new_caller = 2\n")
            with self.assertRaises(ValueError):
                pinned_source(path, expected)
            alias = Path(directory) / "alias.py"
            alias.symlink_to(path)
            with self.assertRaises(ValueError):
                pinned_source(alias, hashlib.sha256(path.read_bytes()).hexdigest())
