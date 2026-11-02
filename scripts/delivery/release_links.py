"""Reviewed commit identities and bounded shipped scope without closing broad contributors."""
import json
from pathlib import Path
from release_support import GateError, SHA

def load_commit_links(root, overrides=None, document=None):
    result = {"commit_issues": {}, "delivery_scope": {}}
    path = Path(root) / "docs/delivery/commit-links.json"
    sources = [document] if document is not None else ([json.loads(path.read_text())] if path.exists() else [])
    if overrides:
        sources.append(overrides if "schema_version" in overrides or "commit_issues" in overrides or "delivery_scope" in overrides else {"commit_issues": overrides})
    def numbers(value):
        if not isinstance(value, list) or any(type(n) is not int or n < 1 for n in value) or len(set(value)) != len(value):
            raise GateError("Commit issue mappings require unique positive issue numbers")
        return value
    for source in sources:
        if not isinstance(source, dict) or source.get("schema_version", 1) != 1:
            raise GateError("Invalid commit-links schema")
        for sha, refs in source.get("commit_issues", {}).items():
            if not SHA.fullmatch(sha):
                raise GateError("Commit links require immutable full SHAs")
            result["commit_issues"][sha] = sorted(set(result["commit_issues"].get(sha, [])) | set(numbers(refs)))
        for sha, scope in source.get("delivery_scope", {}).items():
            if not SHA.fullmatch(sha) or not isinstance(scope, dict):
                raise GateError("Delivery scope requires immutable full SHAs and objects")
            delivery, broad = numbers(scope.get("delivery_issues")), numbers(scope.get("contributes_to"))
            if not delivery or set(delivery) & set(broad):
                raise GateError("Bounded delivery scope requires accepted deliveries separate from broad contributors")
            value = {"delivery_issues": delivery, "contributes_to": broad}
            if sha in result["delivery_scope"] and result["delivery_scope"][sha] != value:
                raise GateError("Conflicting committed delivery scopes require reconciliation")
            result["delivery_scope"][sha] = value
    return result
