"""Join private relay readiness, independently observed public routing, and journaled handoff."""
from __future__ import annotations

import time

from installed_web_hops import LiveHopError
from installed_web_probe import probe_public
from installed_web_runtime import require
from traefik_web_handoff import compile_traefik_web_handoff
from traefik_web_handoff_state import HandoffObservation, apply_traefik_web_handoff


def apply_installed_handoff(*, installed_bytes, route_sha256, incumbent_alias, successor_alias,
                            watched_dir, state_dir, web, storage, host, storage_host, revision, version,
                            edge_runtime_id, realtime_upstream, observe_hops, observe_protected,
                            expected_protected, retained_relay_healthy, successor_verified,
                            clock=time.monotonic, sleep=time.sleep):
    """Place the exact same-generation relay, preserving unrelated native resources."""
    require(incumbent_alias != successor_alias and callable(observe_hops) and callable(observe_protected),
            "Independent installed routing and protected-runtime observations required")
    handoff = compile_traefik_web_handoff(installed_bytes, expected_sha256=route_sha256,
                                          original_alias=incumbent_alias, successor_alias=successor_alias)
    old = f"http://{incumbent_alias}:8080"
    new = f"http://{successor_alias}:8080"

    def observe():
        # Traefik's file provider applies asynchronously. Bound observation and
        # leave a pending journal for an inconclusive or slow reload.
        deadline = clock() + 10
        result = HandoffObservation(None, None, None, None, None)
        while True:
            if observe_protected() != expected_protected:
                return HandoffObservation(None, None, None, None, False)
            try:
                public = probe_public(web, storage, host=host, storage_host=storage_host, revision=revision, version=version,
                                      successor_alias=successor_alias, incumbent_upstream=old, successor_upstream=new,
                                      realtime_upstream=realtime_upstream, edge_runtime_id=edge_runtime_id,
                                      read_route_hints=observe_hops)
            except LiveHopError:
                public = None
            if public is not None:
                result = public.handoff_observation(peers_unchanged=observe_protected() == expected_protected)
                if result.peers_unchanged is False or result.healthy_at("after"):
                    return result
                if result.healthy_at("before") and (watched_dir / "warpdrive-web-relay.yaml").read_bytes() == installed_bytes:
                    return result
                if result.at("after") and result.public_healthy is False:
                    return result
            if clock() >= deadline:
                return result
            sleep(0.4)

    require(successor_verified() is True, "Directly verified successor Web relay required")
    return apply_traefik_web_handoff(handoff, watched_dir=watched_dir, state_dir=state_dir, observe=observe,
                                     retained_before_healthy=retained_relay_healthy)
