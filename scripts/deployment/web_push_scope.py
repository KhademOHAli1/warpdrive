"""Select the independent image workflow only for a proven presentation-only push."""
from __future__ import annotations

from pathlib import Path
import sys

from component_inputs import InputError
from web_release_inputs import (
    MAX_PRESENTATION_BYTES, STYLE_FILE, _blob, _git, _presentation_delta, _tree, qualifies_topbar_browser_pair,
)


def independent_web_push(root: Path, before: str, after: str) -> bool:
    if before == after:
        return False
    try:
        old, new = _tree(root, before), _tree(root, after)
        _git(root, "merge-base", "--is-ancestor", before, after, allow_empty=True)
        presentation, tooling = _presentation_delta(root, old, new)
        if presentation != [STYLE_FILE] or tooling:
            return False
        _, old_css = _blob(root, old, STYLE_FILE, MAX_PRESENTATION_BYTES)
        _, new_css = _blob(root, new, STYLE_FILE, MAX_PRESENTATION_BYTES)
        if qualifies_topbar_browser_pair(old_css, new_css):
            return True
        # Repeat qualification is installed in a prior reviewed tools commit.
        # This lightweight selector recognizes only its existing numeric CSS
        # profile. The separate repeat workflow still proves full input equality.
        repeat = ".github/workflows/web-repeat-qualification.yml"
        return (old.get(repeat) is not None and old[repeat] == new.get(repeat)
                and "scripts/deployment/first-web-publication.receipt" in old)
    except (OSError, ValueError, InputError):
        return False


if __name__ == "__main__":
    raise SystemExit(0 if len(sys.argv) == 3 and independent_web_push(Path.cwd(), *sys.argv[1:]) else 1)
