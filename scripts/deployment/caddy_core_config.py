"""Compile an opt-in Core route inside the admitted private Web relay."""

from copy import deepcopy

from caddy_web_config import (
    _canonical, _generation_handler, _read_installed, _require, compile_successor_web_configs,
)
from traefik_web_relay import _label, _proxy_headers
from web_generation_routes import _reject, _SAFE, _selectors_allow, WebGeneration


CORE_RESPONSE_HEADER = "X-Warpdrive-Core-Route"
CORE_RESPONSE_MARKER = "1"
CORE_PROBE_HEADER = "X-Warpdrive-Core-Probe"
CORE_READ_PATH = "/api/trpc/version.get"


def core_api_routes(core_alias, active, retained=None):
    """Build the terminal Core paths for an already admitted Web generation pair."""
    generations = (active,) if retained is None else (active, retained)
    _require(all(type(generation) is WebGeneration for generation in generations)
             and len({generation.deployment_id for generation in generations}) == len(generations)
             and len({generation.target for generation in generations}) == len(generations)
             and _label(core_alias) and core_alias not in {
                 "localhost", "ws", "postgres", "minio", "worker", "newsletter-engine",
                 *(generation.target for generation in generations),
             }, "A distinct private Core service alias and exact Web generations are required")
    api_security = {
        "Content-Security-Policy": [
            "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
        ],
        "X-Frame-Options": ["DENY"],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["strict-origin-when-cross-origin"],
        "Permissions-Policy": ["camera=(), microphone=(), geolocation=(), payment=()"],
    }
    selectors = " || ".join(_selectors_allow(generation) for generation in generations)
    api_path = "path('/api/trpc', '/api/trpc/*')"
    guard = _reject(f"{api_path} && !{_SAFE} && !({selectors})")
    proxy = {
        "match": [{"path": ["/api/trpc", "/api/trpc/*"]}],
        "handle": [
            {"handler": "headers", "response": {"deferred": True, "set": api_security}},
            {
                "handler": "reverse_proxy",
                "upstreams": [{"dial": f"{core_alias}:3010"}],
                "load_balancing": {"retries": 0, "try_duration": 0},
                "headers": {"request": {"set": _proxy_headers(), "delete": [CORE_PROBE_HEADER]},
                            "response": {"delete": [CORE_RESPONSE_HEADER]}},
                "transport": {"protocol": "http", "keep_alive": {"enabled": False}},
            },
        ],
        "terminal": True,
    }
    probe = deepcopy(proxy)
    probe["match"] = [{"expression": f"method('GET') && {{http.request.uri.path}} == '{CORE_READ_PATH}'"
                      f" && {{http.request.header.{CORE_PROBE_HEADER}}} == '{CORE_RESPONSE_MARKER}'"
                      " && {http.request.uri.query} == '' && !header({'Authorization': '*'})"
                      " && !header({'Cookie': '*'}) && !header({'Next-Action': '*'}) && !header({'X-Deployment-Id': '*'})"}]
    probe["handle"][1]["headers"]["response"] = {
        "set": {CORE_RESPONSE_HEADER: [CORE_RESPONSE_MARKER], "Cache-Control": ["no-store"]},
    }
    return [guard, probe, proxy]


def compile_core_relay(installed_bytes, *, expected_sha256, core_alias, active_variant,
                       baseline_bytes, baseline_sha256, host, traefik_ip,
                       installed_relay_alias, successor_relay_alias, current, candidate):
    """Generate the route from an exact accepted Web relay, without altering its Web rules."""
    _require(_label(core_alias) and core_alias not in {
        "localhost", "ws", "postgres", "minio", "worker", "newsletter-engine",
        installed_relay_alias, successor_relay_alias, current.target, candidate.target,
    }, "A distinct private Core service alias is required")
    expected = compile_successor_web_configs(
        baseline_bytes, expected_sha256=baseline_sha256, host=host, traefik_ip=traefik_ip,
        installed_relay_alias=installed_relay_alias, successor_relay_alias=successor_relay_alias,
        current=current, candidate=candidate,
    )
    _require(active_variant in expected, "Exact active Web generation variant required")
    active = expected[active_variant]
    _require(_read_installed(installed_bytes, expected_sha256) == _canonical(active),
             "Installed relay is not the expected accepted Web generation")

    routed = deepcopy(active)
    # Keep the exact relay probe marker as route zero for the rollback composer.
    generations = (current,) if active_variant == "successorA" else (candidate, current)
    _generation_handler(routed)["routes"][1:1] = core_api_routes(core_alias, *generations)
    return routed
