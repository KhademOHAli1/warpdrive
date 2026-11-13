"""Compile a Web-only Caddy relay behind an existing Traefik file-provider configuration.

The caller owns the provider file, the exact edge peer and network, and any
control-plane apply. This compiler never reads or changes an installed target.
"""

from copy import deepcopy
from ipaddress import IPv4Address, IPv4Network
import re

from web_generation_routes import WebGeneration, compile_web_generation_routes


_LABEL = re.compile(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")
_LOCAL = tuple(IPv4Network(network) for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"))
_RELAY_PORT = 8080
_SAFE_METHOD = "(Method(`GET`) || Method(`HEAD`))"
_ADMITTED_MIDDLEWARES = {"basicAuth", "buffering", "compress", "digestAuth", "headers", "inFlightReq", "ipAllowList", "rateLimit"}
_PROTECTED_HEADERS = {
    "authorization", "connection", "content-length", "content-type", "cookie", "host",
    "idempotency-key", "next-action", "origin", "transfer-encoding", "x-deployment-id",
    "x-forwarded-for", "x-forwarded-host", "x-forwarded-port", "x-forwarded-proto", "x-idempotency-key", "x-real-ip",
}


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _label(value):
    return isinstance(value, str) and _LABEL.fullmatch(value) is not None and value != "localhost"


def _peer_network(value):
    _require(isinstance(value, str), "One exact Traefik IPv4 peer required")
    try:
        address = IPv4Address(value)
    except ValueError:
        raise ValueError("One exact Traefik IPv4 peer required") from None
    _require(any(address in network for network in _LOCAL), "A private Traefik peer required")
    return f"{address}/32"


def _reference(name, provider):
    suffix = f"@{provider}"
    _require(isinstance(name, str) and _label(name.removesuffix(suffix)), "Same-provider reference required")
    return name.removesuffix(suffix)


def _middlewares(names, definitions, provider, ancestors=frozenset()):
    _require(isinstance(names, list), "Ordered same-provider app middlewares required")
    for name in names:
        reference = _reference(name, provider)
        entry = definitions.get(reference)
        _require(reference not in ancestors and isinstance(entry, dict) and len(entry) == 1,
                 "Resolvable acyclic app middleware required")
        kind, options = next(iter(entry.items()))
        _require(isinstance(options, dict), "Invalid app middleware definition")
        if kind == "chain":
            _middlewares(options.get("middlewares"), definitions, provider, ancestors | {reference})
            continue
        _require(kind in _ADMITTED_MIDDLEWARES, "App middleware behavior is not admitted for the Web relay")
        if kind == "buffering":
            _require(not options.get("retryExpression"), "App buffering middleware can replay requests")
        if kind == "headers":
            custom = options.get("customRequestHeaders", {})
            _require(isinstance(custom, dict) and all(isinstance(key, str) for key in custom),
                     "Invalid app request header middleware")
            normalized = {key.lower().replace("_", "-").replace(".", "-") for key in custom}
            _require(not normalized & _PROTECTED_HEADERS, "App middleware modifies relay request authority")


def _single_service(services, name, provider):
    definition = services.get(_reference(name, provider))
    _require(isinstance(definition, dict) and set(definition) == {"loadBalancer"}, "Existing direct service required")
    load_balancer = definition["loadBalancer"]
    _require(isinstance(load_balancer, dict) and load_balancer.get("passHostHeader", True) is True,
             "Existing service must preserve the public Host")
    servers = load_balancer.get("servers")
    _require(isinstance(servers, list) and len(servers) == 1 and isinstance(servers[0], dict)
             and isinstance(servers[0].get("url"), str), "Existing service must have one direct upstream")
    return servers[0]["url"]


def _app_routers(document, app_name, realtime_name, host):
    http = document.get("http", {})
    _require(isinstance(http, dict), "Traefik HTTP configuration required")
    routers = http.get("routers", {})
    _require(isinstance(routers, dict), "Traefik HTTP routers required")
    app, realtime = routers.get(app_name), routers.get(realtime_name)
    _require(isinstance(app, dict) and isinstance(realtime, dict), "Existing app and realtime routers required")
    host_rule = f"Host(`{host}`)"
    _require(app.get("rule") == host_rule, "Exact existing app Host rule required")
    ws_rules = {f"{host_rule} && {predicate}(`/_ws`)" for predicate in ("Path", "PathPrefix")}
    _require(isinstance(realtime.get("rule"), str) and realtime["rule"] in ws_rules,
             "Exact existing same-origin realtime rule required")
    entries = app.get("entryPoints")
    _require(isinstance(entries, list) and bool(entries) and entries == realtime.get("entryPoints")
             and all(isinstance(entry, str) and bool(entry) for entry in entries)
             and isinstance(app.get("tls"), dict) and isinstance(realtime.get("tls"), dict),
             "Existing common TLS entry point required")
    priority = app.get("priority", 0)
    _require(type(priority) is int and priority >= 0, "Invalid existing app router priority")
    effective = priority or len(host_rule)
    ws_priority = realtime.get("priority")
    _require(type(ws_priority) is int and ws_priority > effective, "Existing realtime router must outrank Web")
    return app, realtime, effective


def _proxy_headers():
    # Both application rate limiters must see the same edge-verified client. The
    # general limiter reads the last XFF value, so simply appending Traefik is wrong.
    client = ["{http.vars.client_ip}"]
    return {"X-Real-Ip": client, "X-Forwarded-For": client, "X-Forwarded-Proto": ["https"],
            "X-Forwarded-Host": ["{http.request.hostport}"]}


def _legacy_handler(alias):
    # A relay-only install points both methods at the same incumbent. It adds no
    # deployment identity or compatibility rule to the unstamped application.
    def proxy():
        return {"handler": "reverse_proxy", "upstreams": [{"dial": f"{alias}:3000"}],
                "load_balancing": {"retries": 0, "try_duration": 0}}

    unsafe = proxy()
    unsafe["transport"] = {"protocol": "http", "keep_alive": {"enabled": False}}
    return {"handler": "subroute", "routes": [
        {"match": [{"method": ["GET", "HEAD"]}], "handle": [proxy()], "terminal": True},
        {"handle": [unsafe], "terminal": True},
    ]}


def _caddy_config(host, peer, handler):
    for route in handler["routes"]:
        for proxy in route["handle"]:
            if proxy["handler"] == "reverse_proxy":
                proxy["headers"] = {"request": {"set": _proxy_headers()}}
    return {"admin": {"disabled": True}, "apps": {"http": {"servers": {"web-relay": {
        "listen": [f":{_RELAY_PORT}"], "protocols": ["h1"], "automatic_https": {"disable": True},
        "trusted_proxies": {"source": "static", "ranges": [peer]}, "trusted_proxies_strict": 1,
        "client_ip_headers": ["X-Forwarded-For"], "routes": [
            {"match": [{"host": [host], "remote_ip": {"ranges": [peer]},
                        "expression": "{http.request.header.X-Forwarded-Proto} == 'https'"}],
             "handle": [handler], "terminal": True},
            {"handle": [{"handler": "static_response", "status_code": 421}], "terminal": True},
        ],
    }}}}}


def compile_traefik_web_relay(
    dynamic, *, app_router, realtime_router, host, relay_alias, traefik_ip,
    current=None, previous=None, incumbent_alias=None, provider="file", incumbent_ip=None,
):
    """Return a Traefik file-provider document and private Caddy configuration.

    Supply one or two stamped Web generations, or the exact incumbent alias for a
    relay-only ingress rehearsal. For provider="docker", pass authenticated,
    normalized Docker-provider definitions. The returned file overlays only Web;
    the installed adapter must verify precedence, endpoint identity, and all
    entry-point middleware and transport settings independently.
    """
    _require(isinstance(dynamic, dict) and isinstance(host, str) and "." in host and len(host) <= 253
             and all(_label(label) for label in host.split(".")), "Canonical public Web hostname required")
    _require(all(_label(label) for label in (app_router, realtime_router, relay_alias))
             and app_router != realtime_router, "Distinct app/realtime routers and a fixed relay alias required")
    _require(provider in ("file", "docker"), "Existing file or Docker provider required")
    peer = _peer_network(traefik_ip)
    document = deepcopy(dynamic)
    app, realtime, priority = _app_routers(document, app_router, realtime_router, host)
    http = document["http"]
    services = http.get("services", {})
    middlewares = http.get("middlewares", {})
    _require(isinstance(services, dict) and isinstance(middlewares, dict), "Traefik service and middleware maps required")
    _middlewares(app.get("middlewares", []), middlewares, provider)
    direct = _single_service(services, app.get("service"), provider)
    _require(direct != _single_service(services, realtime.get("service"), provider), "Distinct app and realtime services required")

    if incumbent_alias is not None:
        original_target = incumbent_alias
        if incumbent_ip is not None:
            _require(provider == "docker", "Observed incumbent IP is only admitted for the Docker provider")
            original_target = _peer_network(incumbent_ip).removesuffix("/32")
        _require(current is None and previous is None and _label(incumbent_alias) and incumbent_alias != relay_alias
                 and direct == f"http://{original_target}:3000", "Relay-only ingress requires the exact incumbent service")
        handler = _legacy_handler(incumbent_alias)
    else:
        _require(incumbent_ip is None and isinstance(current, WebGeneration) and current.target != relay_alias
                 and (previous is None or isinstance(previous, WebGeneration) and previous.target != relay_alias),
                 "Fixed Web generation targets required")
        handler = compile_web_generation_routes(current=current, previous=previous)

    if provider == "docker":
        _require(priority + 1 < realtime["priority"], "No priority available between incumbent Web and realtime")
        priority += 1
        app = {**app, "middlewares": [f"{_reference(name, provider)}@docker" for name in app.get("middlewares", [])]}
        document = {"http": {"routers": {}, "services": {}}}
        http = document["http"]
        services = http["services"]
        app_router = "warpdrive-web-relay-safe"

    routers = http["routers"]
    transports = http.setdefault("serversTransports", {})
    _require(isinstance(transports, dict), "Traefik transport map required")
    unsafe_router, safe_service, unsafe_service, transport = (
        "warpdrive-web-relay-unsafe", "warpdrive-web-relay-safe", "warpdrive-web-relay-unsafe", "warpdrive-web-relay-unsafe",
    )
    _require(unsafe_router not in routers and safe_service not in services and unsafe_service not in services
             and transport not in transports, "Web relay names already exist")
    rule = app["rule"]
    routers[unsafe_router] = {**app, "rule": f"{rule} && !{_SAFE_METHOD}", "priority": priority, "service": unsafe_service}
    routers[app_router] = {**app, "rule": f"{rule} && {_SAFE_METHOD}", "priority": priority, "service": safe_service}
    for service in (safe_service, unsafe_service):
        services[service] = {"loadBalancer": {"passHostHeader": True,
                                            "servers": [{"url": f"http://{relay_alias}:{_RELAY_PORT}"}]}}
    services[unsafe_service]["loadBalancer"]["serversTransport"] = transport
    transports[transport] = {"disableHTTP2": True, "maxIdleConnsPerHost": -1}
    return {"traefik": document, "caddy": _caddy_config(host, peer, handler)}
