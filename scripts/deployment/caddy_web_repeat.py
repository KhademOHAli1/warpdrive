"""Compile subsequent Web generations on the existing private Caddy relay."""

from caddy_core_config import core_api_routes
from caddy_web_config import (
    ADMIN_SOCKET, _RELAY_ALIAS, _canonical, _generation_handler, _probe_marker, _read_installed, _require,
)
from traefik_web_relay import _caddy_config, _label, _peer_network
from web_generation_routes import WebGeneration, compile_web_generation_routes


def compile_retained_web_config(*, host, peer, relay_alias, active, retained, core_alias=None):
    document = _caddy_config(host, peer, compile_web_generation_routes(current=active, previous=retained))
    document["admin"] = {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}}
    prefix = [_probe_marker(relay_alias)]
    if core_alias is not None:
        prefix.extend(core_api_routes(core_alias, active, retained))
    _generation_handler(document)["routes"][0:0] = prefix
    return document


def compile_repeat_web_configs(
    installed_bytes: bytes, *, expected_sha256: str, host: str, traefik_ip: str, relay_alias: str,
    current: WebGeneration, previous: WebGeneration, candidate: WebGeneration,
    core_alias: str | None = None,
) -> dict:
    """Admit exact B+A, prepare C+B, and compile an explicit healthy B+C reverse.

    A failed candidate is compensated with the original B+A document. The B+C
    document is for a later independently authorized switch with both slots
    healthy. The caller owns artifact, endpoint and active/durable route proofs.
    """
    _require(isinstance(host, str) and "." in host and len(host) <= 253 and all(_label(part) for part in host.split(".")),
             "Exact installed Web host required")
    _require(isinstance(relay_alias, str) and _RELAY_ALIAS.fullmatch(relay_alias), "Exact existing Web relay alias required")
    generations = (current, previous, candidate)
    _require(all(isinstance(generation, WebGeneration) for generation in generations)
             and len({generation.deployment_id for generation in generations}) == 3
             and len({relay_alias, *(generation.target for generation in generations)}) == 4,
             "Distinct exact Web generations and private aliases required")
    _require(core_alias is None or (_label(core_alias) and not _RELAY_ALIAS.fullmatch(core_alias)
             and core_alias not in {generation.target for generation in generations}),
             "A distinct private Core alias is required for all retained Web generations")
    peer = _peer_network(traefik_ip)

    def configuration(active, retained):
        return compile_retained_web_config(host=host, peer=peer, relay_alias=relay_alias,
                                           active=active, retained=retained, core_alias=core_alias)

    before = configuration(current, previous)
    _require(_read_installed(installed_bytes, expected_sha256) == _canonical(before),
             "Installed Caddy config differs from the admitted active and previous Web generations")
    return {"before": before, "after": configuration(candidate, current), "manualRollback": configuration(current, candidate)}
