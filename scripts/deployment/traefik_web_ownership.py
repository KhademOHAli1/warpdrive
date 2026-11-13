"""Compile the reviewed installed CRM ingress policy independently of Web containers.

The caller authenticates the live Docker label observations and checks that
the new file names and priorities are unclaimed in the merged Traefik config.
These functions compile documents. Installation and active-router readback
belong to the operator.
"""

from hashlib import sha256
import json

from traefik_web_handoff import (
    TraefikWebHandoff,
    _ALIAS,
    _HOST,
    _MAX_DOCUMENT_BYTES,
    _ROUTES,
    _SHA256,
    _WEB_RULE,
    _canonical,
    _installed_overlay,
    _unique_object,
)


_NETWORK = "pitant-warpdrive-ingress"
_HEADERS = "warpdrive-web-owned-headers"
_BODY = "warpdrive-web-owned-body"
_REDIRECT = "warpdrive-web-owned-http-redirect"
_HTTP = "warpdrive-web-owned-http"
_REALTIME = "warpdrive-web-owned-realtime"
_WS_RULE = _WEB_RULE + " && PathPrefix(`/_ws`)"
_WS_PRIORITY = 100


def _docker_labels(role):
    # This is the exact installed policy independently checked by
    # stage-installed-web-relay.py, scoped to the app and Realtime containers.
    app = role == "app"
    service = "warpdrive-app" if app else "warpdrive-ws"
    router = f"traefik.http.routers.{service}"
    load_balancer = f"traefik.http.services.{service}.loadbalancer"
    labels = {
        "traefik.enable": "true",
        "traefik.docker.network": _NETWORK,
        f"{router}.rule": _WEB_RULE if app else _WS_RULE,
        f"{router}.service": service,
        f"{router}.entrypoints": "https",
        f"{router}.tls": "true",
        f"{router}.tls.certresolver": "letsencrypt",
        f"{router}.middlewares": (
            "warpdrive-app-headers,warpdrive-app-body" if app else "warpdrive-app-headers@docker"
        ),
        f"{load_balancer}.server.port": "3000" if app else "8080",
    }
    if not app:
        return {**labels, f"{router}.priority": str(_WS_PRIORITY)}
    return {
        **labels,
        f"{router}-http.rule": _WEB_RULE,
        f"{router}-http.service": "noop@internal",
        f"{router}-http.entrypoints": "http",
        f"{router}-http.middlewares": "warpdrive-app-http-redirect",
        "traefik.http.middlewares.warpdrive-app-http-redirect.redirectscheme.scheme": "https",
        "traefik.http.middlewares.warpdrive-app-http-redirect.redirectscheme.permanent": "true",
        "traefik.http.middlewares.warpdrive-app-headers.headers.customresponseheaders.Server": "",
        "traefik.http.middlewares.warpdrive-app-headers.headers.stsincludesubdomains": "true",
        "traefik.http.middlewares.warpdrive-app-headers.headers.stsseconds": "31536000",
        "traefik.http.middlewares.warpdrive-app-body.buffering.maxrequestbodybytes": "80000000",
        "traefik.http.middlewares.warpdrive-app-body.buffering.memrequestbodybytes": "1048576",
        f"{load_balancer}.healthcheck.path": "/api/health",
        f"{load_balancer}.healthcheck.interval": "15s",
        f"{load_balancer}.healthcheck.timeout": "5s",
    }


def _require_alias(alias):
    if not isinstance(alias, str) or not _ALIAS.fullmatch(alias):
        raise ValueError("Exact private Web relay alias required")


def _require_document(raw, expected_sha256, expected_document):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= _MAX_DOCUMENT_BYTES:
        raise ValueError("Bounded installed Traefik JSON bytes required")
    if (not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256)
            or sha256(raw).hexdigest() != expected_sha256):
        raise ValueError("Installed Traefik document SHA-256 differs")
    try:
        canonical = _canonical(json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object))
    except (ValueError, RecursionError):
        raise ValueError("Invalid installed Traefik JSON document") from None
    if canonical != _canonical(expected_document):
        raise ValueError("Installed Traefik document differs from the reviewed ownership profile")


def _owned_overlay(alias):
    document = _installed_overlay(alias)
    http = document["http"]
    for name in _ROUTES:
        http["routers"][name]["middlewares"] = [f"{_HEADERS}@file", f"{_BODY}@file"]
    http["middlewares"] = {
        _HEADERS: {"headers": {
            "customResponseHeaders": {"Server": ""},
            "stsIncludeSubdomains": True,
            "stsSeconds": 31536000,
        }},
        _BODY: {"buffering": {"maxRequestBodyBytes": 80000000, "memRequestBodyBytes": 1048576}},
        _REDIRECT: {"redirectScheme": {"scheme": "https", "permanent": True}},
    }
    http["routers"][_HTTP] = {
        "rule": _WEB_RULE,
        "entryPoints": ["http"],
        "priority": len(_WEB_RULE) + 1,
        "service": "noop@internal",
        "middlewares": [f"{_REDIRECT}@file"],
    }
    http["routers"][_REALTIME] = {
        "rule": _WS_RULE,
        "entryPoints": ["https"],
        "priority": _WS_PRIORITY + 1,
        "service": "warpdrive-ws@docker",
        "tls": {"certResolver": "letsencrypt"},
        "middlewares": [f"{_HEADERS}@file"],
    }
    return document


def compile_traefik_web_ownership(
    current_bytes: bytes, *, expected_current_sha256: str, relay_alias: str, host: str,
    app_labels: dict[str, str], ws_labels: dict[str, str],
) -> bytes:
    """Transfer policy while the incumbent still supplies its verified labels.

    Pass exactly the separately observed Traefik labels for each container.
    Both existing Web routes retain their upstreams and transport settings.
    """
    _require_alias(relay_alias)
    if host != _HOST:
        raise ValueError("Exact installed CRM host required")
    if not isinstance(app_labels, dict) or app_labels != _docker_labels("app"):
        raise ValueError("Installed app Traefik labels differ from the reviewed policy")
    if not isinstance(ws_labels, dict) or ws_labels != _docker_labels("ws"):
        raise ValueError("Installed Realtime Traefik labels differ from the reviewed policy")
    _require_document(current_bytes, expected_current_sha256, _installed_overlay(relay_alias))
    return _canonical(_owned_overlay(relay_alias))


def compile_traefik_owned_handoff(
    installed: bytes, *, expected_sha256: str, original_alias: str, successor_alias: str,
) -> TraefikWebHandoff:
    """Change both Web relay URLs after ingress policy has moved to the file."""
    _require_alias(original_alias)
    _require_alias(successor_alias)
    if original_alias == successor_alias:
        raise ValueError("Two distinct private Web relay aliases required")
    _require_document(installed, expected_sha256, _owned_overlay(original_alias))
    after = _canonical(_owned_overlay(successor_alias))
    return TraefikWebHandoff(installed, expected_sha256, after, sha256(after).hexdigest())
