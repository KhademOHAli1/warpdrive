"""Bind the Web rollout controller to one admitted installed Caddy target."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import json

from caddy_admin import CaddyAdmin
from caddy_core_config import core_api_routes
from caddy_web_config import ADMIN_SOCKET, PROBE_RESPONSE_HEADER, _RELAY_ALIAS, _generation_handler, _probe_marker
from traefik_web_relay import _caddy_config, _label, _peer_network
from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import _read_target, _validate
from web_switch import DefiniteRejected, SwitchHeld, SwitchUnknown, canonical, content_hash, require


_DOCUMENT_KEYS = {"successorA", "successorB"}
_RUNTIME_KEYS = {"beforeRuntime", "afterRuntime", "backendFingerprint"}
_MAX_CONFIG_BYTES = 1024 * 1024


def _config_bytes(value):
    try:
        if type(value) is dict:
            raw = canonical(value)
            if 0 < len(raw) <= _MAX_CONFIG_BYTES:
                return raw
    except (TypeError, ValueError, RecursionError):
        pass
    raise SwitchHeld("Bounded whole Caddy configuration required")


def _validate_documents(before, after, plan, generations, core_alias=None):
    """Check both complete documents against the qualified active and retained slots."""
    try:
        gate = before["apps"]["http"]["servers"]["web-relay"]["routes"][0]["match"][0]
        host, = gate["host"]
        peer, = gate["remote_ip"]["ranges"]
        marker = _generation_handler(before)["routes"][0]
        alias, = marker["handle"][0]["response"]["set"][PROBE_RESPONSE_HEADER]
        require(isinstance(host, str) and "." in host and len(host) <= 253 and all(_label(part) for part in host.split("."))
                and _peer_network(peer.removesuffix("/32")) == peer and _RELAY_ALIAS.fullmatch(alias),
                "Installed Caddy host, peer or alias differs")
        require(core_alias is None or (_label(core_alias) and not _RELAY_ALIAS.fullmatch(core_alias)),
                "Exact private Core relay alias required")
        if generations is None:
            candidate_url, = _generation_handler(after)["routes"][-1]["handle"][0]["upstreams"]
            candidate = WebGeneration(plan["after"]["route"]["generation"], candidate_url["dial"].removesuffix(":3000"))
            current = WebGeneration(plan["before"]["route"]["generation"], "app")
            generations = ((current, None), (candidate, current))
        for side, (active, retained) in zip(("before", "after"), generations, strict=True):
            require(type(active) is WebGeneration and active.deployment_id == plan[side]["route"]["generation"]
                    and active.target != alias and (retained is None or (type(retained) is WebGeneration and retained.target != alias)),
                    "Installed Caddy generation binding differs")
    except (KeyError, TypeError, ValueError, IndexError, AttributeError):
        raise SwitchHeld("Exact installed Caddy Web policies required") from None

    for document, (active, retained) in zip((before, after), generations, strict=True):
        expected = _caddy_config(host, peer, compile_web_generation_routes(current=active, previous=retained))
        expected["admin"] = {"listen": f"unix/{ADMIN_SOCKET}|0600", "config": {"persist": True}}
        prefix = [_probe_marker(alias)]
        if core_alias is not None:
            try:
                prefix.extend(core_api_routes(core_alias, active, retained))
            except ValueError:
                raise SwitchHeld("Exact Core and Web routing policy required") from None
        _generation_handler(expected)["routes"][0:0] = prefix
        require(_config_bytes(document) == _config_bytes(expected),
                "Both Caddy documents must preserve the private admin and non-Web configuration")


class InstalledWebTarget:
    """Use independently observed host state with one authenticated admin client.

    The trusted composition root authenticates the release, checks the alias to
    container bindings, and supplies the bounded observation callbacks. The
    autosave callback reads and verifies the relay's durable file, including
    persistence to storage. The rollout controller owns the single target lock.
    """

    def __init__(
        self, plan: dict, *, admin: CaddyAdmin, documents: dict,
        verify_release: Callable[..., bool], observe_runtimes: Callable[[], dict],
        probe_health: Callable[..., dict], read_durable_config: Callable[[], dict],
        generations: tuple | None = None, core_alias: str | None = None,
    ):
        self._plan = deepcopy(plan)
        _validate(self._plan)
        require(core_alias is None or generations is not None,
                "Core routing requires independently admitted Web generation bindings")
        require(type(documents) is dict and set(documents) == _DOCUMENT_KEYS,
                "Exact compiled successor A and B documents required")
        self._configs = {side: _config_bytes(documents[key]) for side, key in (
            ("before", "successorA"), ("after", "successorB"),
        )}
        before, after = (json.loads(self._configs[side]) for side in ("before", "after"))
        _validate_documents(before, after, self._plan, generations, core_alias)
        require(all(self._plan[side]["route"]["fingerprint"] == content_hash(document)
                    for side, document in (("before", before), ("after", after))),
                "Caddy document fingerprints differ from the rollout plan")
        self._admin = admin
        self._verify_release = verify_release
        self._observe_runtimes = observe_runtimes
        self._probe_health = probe_health
        self._read_durable_config = read_durable_config

    def _same_plan(self, plan):
        return canonical(plan) == canonical(self._plan)

    def _read_route(self):
        try:
            document, etag = self._admin.config()
            current = _config_bytes(document)
            side = next((side for side, config in self._configs.items() if current == config), None)
            if side is None or _config_bytes(self._read_durable_config()) != current:
                raise SwitchHeld("Live Caddy and durable configuration do not match a qualified route")
            confirmed, confirmed_etag = self._admin.config()
            if _config_bytes(confirmed) != current or confirmed_etag != etag:
                raise SwitchHeld("Caddy configuration changed during durable readback")
        except Exception:
            raise SwitchHeld("Exact live and durable Caddy route readback is unavailable") from None
        return side

    def verify_qualification(self, plan, *, initialize):
        if type(initialize) is not bool or not self._same_plan(plan):
            return False
        if self._verify_release(deepcopy(self._plan), initialize=initialize) is not True:
            return False
        return not initialize or self._read_route() == "before"

    def inspect(self, plan):
        require(self._same_plan(plan), "Installed Web observation requested for another rollout plan")
        runtimes = deepcopy(self._observe_runtimes())
        require(type(runtimes) is dict and set(runtimes) == _RUNTIME_KEYS,
                "Independent installed Web and protected backend observation required")
        side = self._read_route()
        return {**runtimes, "route": deepcopy(self._plan[side]["route"])}

    def observe_health(self, slot, *, proxied):
        require(type(proxied) is bool and any(canonical(slot) == canonical(self._plan[side]) for side in self._configs),
                "Health probe requested for an unqualified Web slot")
        proof = self._probe_health(deepcopy(slot), proxied=proxied)
        require(type(proof) is dict and set(proof) == {"generation", "runtimeId", "healthy"}
                and proof["generation"] == slot["route"]["generation"]
                and proof["runtimeId"] == slot["runtime"]["runtimeId"] and type(proof["healthy"]) is bool,
                "Health response is not bound to the exact observed Web runtime")
        return deepcopy(proof)

    def compare_and_swap_route(self, expected, desired):
        sides = {self._plan[side]["route"]["generation"]: side for side in self._configs}
        before = sides.get(expected.get("generation"))
        after = sides.get(desired.get("generation"))
        require(before is not None and after is not None and before != after
                and canonical(expected) == canonical(self._plan[before]["route"])
                and canonical(desired) == canonical(self._plan[after]["route"]),
                "Caddy route CAS requested outside the exact qualified route pair")
        actual, stable = _read_target(self, self._plan)
        if actual != expected or (after == "after" and not stable):
            raise DefiniteRejected("Qualified Caddy route or candidate changed before CAS")

        try:
            live, _ = self._admin.compare_and_swap(json.loads(self._configs[before]), json.loads(self._configs[after]))
        except DefiniteRejected:
            raise
        except Exception:
            raise SwitchUnknown("Installed Caddy route write outcome is unresolved") from None

        try:
            if _config_bytes(live) != self._configs[after] or self._read_route() != after:
                raise SwitchHeld("Installed Caddy route or durable autosave differs")
        except Exception:
            raise SwitchUnknown("Installed Caddy route persistence is unresolved") from None
