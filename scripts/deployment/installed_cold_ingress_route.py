"""Read-only witness for the installed Traefik Web route during recovery."""

from hashlib import sha256
import os
from pathlib import Path
import re

from recovery import RecoveryError, absolute, no_overlap, open_path, require
from traefik_web_handoff import TraefikWebHandoff
from traefik_web_handoff_state import (
    JOURNAL_FILE, ROUTE_FILE, _MAX_ROUTE, _binding, _identity, _journal, _journal_state,
    _locked_directory, _read, _route, _same_directory, _validate,
)


INSTALLED_WATCHED_DIRECTORY = Path("/root/traefik/dynamic")
INSTALLED_PRIVATE_ROOT = Path("/root/warpdrive-deployment/private")
SEALED_ROUTE_FILE = "stamped-traefik-route.json"
_SHA256 = re.compile(r"[a-f0-9]{64}")


def _directory_identity(path, *, matching=None):
    # Traverse every ancestor without following links. The live handoff also
    # checks that the resulting visible directory is owner-only.
    descriptor = open_path(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        _same_directory(path, descriptor)
        identity = _identity(os.fstat(descriptor))
        require(matching is None or identity == _identity(os.fstat(matching)),
                "Installed ingress directory changed while locked")
        return identity
    finally:
        os.close(descriptor)


def _verify_sealed_route(source, route):
    descriptor = open_path(source.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        _same_directory(source.parent, descriptor)
        require(_read(descriptor, source.name, mode=0o644, maximum=_MAX_ROUTE, links=(2,)) == route,
                "Installed ingress hardlink does not match the sealed route")
        return _directory_identity(source.parent, matching=descriptor)
    finally:
        os.close(descriptor)


def observe_installed_cold_ingress_route(
    handoff: TraefikWebHandoff, *, watched_dir: Path, state_dir: Path,
    expected_route_sha256: str, expected_journal_sha256: str, sealed_route_source: Path | None = None,
) -> tuple[bytes, dict]:
    """Read the exact accepted route and identify its source and journal.

    The caller supplies the independently admitted path and digest pins while
    holding the installed deployment authority. If the route has a second link,
    supply the separately admitted sealed-source path from the installation
    records. The source must share the watched inode and exact accepted bytes.

    Take the same watched-then-state locks as the live handoff. Read no peer
    configuration and make no changes to either directory. The caller retains
    the bytes for a separate private journal copy and re-observes this witness
    at the other recovery boundaries.
    """
    try:
        watched_path = absolute(str(watched_dir))
        state_path = absolute(str(state_dir))
        require(watched_path == INSTALLED_WATCHED_DIRECTORY and state_path.name == "rollout"
                and state_path.parent.is_relative_to(INSTALLED_PRIVATE_ROOT)
                and state_path.parent != INSTALLED_PRIVATE_ROOT and no_overlap(watched_path, state_path),
                "Exact installed ingress and handoff state paths required")
        source = None
        if sealed_route_source is not None:
            source = absolute(str(sealed_route_source))
            require(source.name == SEALED_ROUTE_FILE and source.parent.is_relative_to(INSTALLED_PRIVATE_ROOT)
                    and source.parent != INSTALLED_PRIVATE_ROOT and no_overlap(source, state_path)
                    and no_overlap(source, watched_path), "Exact sealed ingress source path required")

        require(all(isinstance(digest, str) and _SHA256.fullmatch(digest)
                    for digest in (expected_route_sha256, expected_journal_sha256)),
                "Independent ingress route and journal digest pins required")
        _validate(handoff)
        require(handoff.after_sha256 == expected_route_sha256, "Installed ingress route pin differs from the handoff")
        with _locked_directory(watched_path) as watched, _locked_directory(state_path) as state:
            watched_identity = _directory_identity(watched_path, matching=watched)
            state_identity = _directory_identity(state_path, matching=state)
            operation_identity = _directory_identity(state_path.parent)
            journal = _journal(state)
            require(journal is not None and sha256(journal[0]).hexdigest() == expected_journal_sha256
                    and _journal_state(journal, _binding(handoff, watched)) == "accepted",
                    "Exact accepted installed ingress journal required")
            route = _route(watched)
            require(route[0] == handoff.after_document, "Installed ingress route differs from the accepted handoff")
            require((source is None and route[1][-1] == 1) or (source is not None and route[1][-1] == 2),
                    "Installed ingress route link count and sealed source differ")
            sealed_identity = _verify_sealed_route(source, route) if source is not None else None

            _directory_identity(watched_path, matching=watched)
            _directory_identity(state_path, matching=state)
            require(_directory_identity(state_path.parent) == operation_identity
                    and _journal(state) == journal and _route(watched) == route,
                    "Installed ingress route or journal changed during inspection")
            if source is not None:
                require(_verify_sealed_route(source, route) == sealed_identity,
                        "Installed ingress sealed source changed during inspection")
            return route[0], {
                "routePath": str(watched_path / ROUTE_FILE),
                "routeSha256": expected_route_sha256,
                "routeMetadata": list(route[1]),
                "watchedDirectory": list(watched_identity),
                "journalPath": str(state_path / JOURNAL_FILE),
                "journalSha256": expected_journal_sha256,
                "journalMetadata": list(journal[1]),
                "stateDirectory": list(state_identity),
                "operationDirectory": list(operation_identity),
                "sealedRoutePath": None if source is None else str(source),
                "sealedDirectory": None if sealed_identity is None else list(sealed_identity),
            }
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        raise RecoveryError("Installed ingress route or handoff authority is unverified") from None
