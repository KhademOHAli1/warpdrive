"""Test the reviewed installed ingress transition without running a proxy."""

from hashlib import sha256
import json
import unittest

from test_traefik_web_handoff import HOST, NEW, OLD, SAFE, UNSAFE, installed_overlay
from traefik_web_ownership import compile_traefik_owned_handoff, compile_traefik_web_ownership


def incumbent_labels():
    """Exact app and ws labels independently observed by the installed compiler."""
    host_rule = f"Host(`{HOST}`)"
    shared = {"traefik.enable": "true", "traefik.docker.network": "pitant-warpdrive-ingress"}
    app = {
        **shared,
        "traefik.http.routers.warpdrive-app.rule": host_rule,
        "traefik.http.routers.warpdrive-app.service": "warpdrive-app",
        "traefik.http.routers.warpdrive-app.entrypoints": "https",
        "traefik.http.routers.warpdrive-app.tls": "true",
        "traefik.http.routers.warpdrive-app.tls.certresolver": "letsencrypt",
        "traefik.http.routers.warpdrive-app.middlewares": "warpdrive-app-headers,warpdrive-app-body",
        "traefik.http.routers.warpdrive-app-http.rule": host_rule,
        "traefik.http.routers.warpdrive-app-http.service": "noop@internal",
        "traefik.http.routers.warpdrive-app-http.entrypoints": "http",
        "traefik.http.routers.warpdrive-app-http.middlewares": "warpdrive-app-http-redirect",
        "traefik.http.services.warpdrive-app.loadbalancer.server.port": "3000",
        "traefik.http.services.warpdrive-app.loadbalancer.healthcheck.path": "/api/health",
        "traefik.http.services.warpdrive-app.loadbalancer.healthcheck.interval": "15s",
        "traefik.http.services.warpdrive-app.loadbalancer.healthcheck.timeout": "5s",
        "traefik.http.middlewares.warpdrive-app-http-redirect.redirectscheme.scheme": "https",
        "traefik.http.middlewares.warpdrive-app-http-redirect.redirectscheme.permanent": "true",
        "traefik.http.middlewares.warpdrive-app-headers.headers.customresponseheaders.Server": "",
        "traefik.http.middlewares.warpdrive-app-headers.headers.stsincludesubdomains": "true",
        "traefik.http.middlewares.warpdrive-app-headers.headers.stsseconds": "31536000",
        "traefik.http.middlewares.warpdrive-app-body.buffering.maxrequestbodybytes": "80000000",
        "traefik.http.middlewares.warpdrive-app-body.buffering.memrequestbodybytes": "1048576",
    }
    ws = {
        **shared,
        "traefik.http.routers.warpdrive-ws.rule": host_rule + " && PathPrefix(`/_ws`)",
        "traefik.http.routers.warpdrive-ws.service": "warpdrive-ws",
        "traefik.http.routers.warpdrive-ws.entrypoints": "https",
        "traefik.http.routers.warpdrive-ws.tls": "true",
        "traefik.http.routers.warpdrive-ws.tls.certresolver": "letsencrypt",
        "traefik.http.routers.warpdrive-ws.middlewares": "warpdrive-app-headers@docker",
        "traefik.http.routers.warpdrive-ws.priority": "100",
        "traefik.http.services.warpdrive-ws.loadbalancer.server.port": "8080",
    }
    return app, ws


def compile_ownership(raw=None, **overrides):
    raw = json.dumps(installed_overlay(OLD), indent=2).encode() if raw is None else raw
    app, ws = incumbent_labels()
    defaults = {"expected_current_sha256": sha256(raw).hexdigest(), "relay_alias": OLD, "host": HOST,
                "app_labels": app, "ws_labels": ws}
    return compile_traefik_web_ownership(raw, **{**defaults, **overrides})


def handoff(raw, **overrides):
    defaults = {"expected_sha256": sha256(raw).hexdigest(), "original_alias": OLD, "successor_alias": NEW}
    return compile_traefik_owned_handoff(raw, **{**defaults, **overrides})


class TraefikWebOwnershipTests(unittest.TestCase):
    def test_moves_exact_policy_and_shadows_only_the_old_http_and_ws_routes(self):
        old = installed_overlay(OLD)["http"]
        http = json.loads(compile_ownership())["http"]
        self.assertEqual(set(http), {"routers", "services", "serversTransports", "middlewares"})
        self.assertEqual(http["services"], old["services"])
        self.assertEqual(http["serversTransports"], old["serversTransports"])
        self.assertEqual(http["middlewares"], {
            "warpdrive-web-owned-headers": {"headers": {
                "customResponseHeaders": {"Server": ""}, "stsIncludeSubdomains": True, "stsSeconds": 31536000,
            }},
            "warpdrive-web-owned-body": {"buffering": {
                "maxRequestBodyBytes": 80000000, "memRequestBodyBytes": 1048576,
            }},
            "warpdrive-web-owned-http-redirect": {"redirectScheme": {"scheme": "https", "permanent": True}},
        })
        self.assertEqual(set(http["routers"]), {SAFE, UNSAFE, "warpdrive-web-owned-http", "warpdrive-web-owned-realtime"})
        for name in (SAFE, UNSAFE):
            self.assertEqual(http["routers"][name], {**old["routers"][name],
                "middlewares": ["warpdrive-web-owned-headers@file", "warpdrive-web-owned-body@file"],
            })
        host_rule = f"Host(`{HOST}`)"
        self.assertEqual(http["routers"]["warpdrive-web-owned-http"], {
            "rule": host_rule, "entryPoints": ["http"], "priority": len(host_rule) + 1,
            "service": "noop@internal", "middlewares": ["warpdrive-web-owned-http-redirect@file"],
        })
        self.assertEqual(http["routers"]["warpdrive-web-owned-realtime"], {
            "rule": host_rule + " && PathPrefix(`/_ws`)", "entryPoints": ["https"], "priority": 101,
            "service": "warpdrive-ws@docker", "tls": {"certResolver": "letsencrypt"},
            "middlewares": ["warpdrive-web-owned-headers@file"],
        })

    def test_rejects_label_drift_and_missing_or_extra_capabilities(self):
        app, ws = incumbent_labels()
        for field, original, key, replacement in (
            ("app_labels", app, "traefik.docker.network", "wrong-network"),
            ("app_labels", app, "traefik.http.routers.warpdrive-app-http.rule", "HostRegexp(`.+`)"),
            ("app_labels", app, "traefik.http.middlewares.warpdrive-app-http-redirect.redirectscheme.permanent", "false"),
            ("app_labels", app, "traefik.http.middlewares.warpdrive-app-body.buffering.maxrequestbodybytes", "0"),
            ("app_labels", app, "traefik.http.routers.another.rule", "PathPrefix(`/`)"),
            ("app_labels", app, "traefik.http.middlewares.warpdrive-app-headers.headers.customresponseheaders.Server", None),
            ("ws_labels", ws, "traefik.http.routers.warpdrive-ws.rule", "PathPrefix(`/_ws`)"),
            ("ws_labels", ws, "traefik.http.routers.warpdrive-ws.priority", "101"),
            ("ws_labels", ws, "traefik.http.routers.warpdrive-ws.tls.certresolver", "other"),
            ("ws_labels", ws, "traefik.http.routers.warpdrive-ws.service", "another"),
            ("ws_labels", ws, "traefik.http.services.warpdrive-ws.loadbalancer.server.port", "9999"),
        ):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "labels differ"):
                mutated = dict(original)
                if replacement is None:
                    del mutated[key]
                else:
                    mutated[key] = replacement
                compile_ownership(**{field: mutated})

    def test_rejects_wrong_host_alias_raw_pin_and_noncanonical_json_types(self):
        for kwargs, error in (
            ({"host": "s3.crm.pitant.de"}, "CRM host"),
            ({"relay_alias": "app"}, "private Web relay alias"),
            ({"relay_alias": NEW}, "reviewed ownership profile"),
            ({"expected_current_sha256": "0" * 64}, "SHA-256 differs"),
        ):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, error):
                compile_ownership(**kwargs)
        raw = json.dumps(installed_overlay(OLD)).encode()
        for malformed in (raw.replace(b'"url":', b'"url":"ambiguous", "url":', 1), raw + b" {}"):
            with self.assertRaisesRegex(ValueError, "Invalid installed"):
                compile_ownership(malformed)
        with self.assertRaisesRegex(ValueError, "reviewed ownership profile"):
            compile_ownership(raw.replace(b'"status": 200', b'"status": 200.0', 1))
        with self.assertRaisesRegex(ValueError, "Bounded"):
            compile_ownership(b" " * 65537)

    def test_rejects_an_extra_router_or_altered_existing_web_transport(self):
        old = installed_overlay(OLD)
        old["http"]["routers"]["unexpected"] = {"rule": "HostRegexp(`.+`)"}
        with self.assertRaisesRegex(ValueError, "reviewed ownership profile"):
            compile_ownership(json.dumps(old).encode())
        raw = json.dumps(installed_overlay(OLD)).encode()
        changed = raw.replace(b'"maxIdleConnsPerHost": -1', b'"maxIdleConnsPerHost": 0')
        with self.assertRaisesRegex(ValueError, "reviewed ownership profile"):
            compile_ownership(changed)

    def test_handoff_reverses_only_web_urls_and_preserves_owned_routes(self):
        raw = compile_ownership()
        result = handoff(raw)
        self.assertEqual(result.before_document, raw)
        self.assertEqual(result.before_sha256, sha256(raw).hexdigest())
        self.assertEqual(result.after_sha256, sha256(result.after_document).hexdigest())
        self.assertEqual(result.after_document, raw.replace(OLD.encode(), NEW.encode()))
        reverse = handoff(result.after_document, original_alias=NEW, successor_alias=OLD)
        self.assertEqual(reverse.after_document, raw)

    def test_owned_handoff_refuses_reintroduced_dependency_and_wrong_profile(self):
        raw = compile_ownership()
        for mutated in (
            raw.replace(b"warpdrive-web-owned-headers@file", b"warpdrive-app-headers@docker", 1),
            raw.replace(b'"priority":101', b'"priority":100'),
            raw.replace(b'"service":"warpdrive-ws@docker"', b'"service":"warpdrive-app@docker"'),
            json.dumps(installed_overlay(OLD)).encode(),
        ):
            with self.assertRaisesRegex(ValueError, "reviewed ownership profile"):
                handoff(mutated)
        for kwargs, error in (
            ({"expected_sha256": "0" * 64}, "SHA-256 differs"),
            ({"successor_alias": OLD}, "distinct private Web relay aliases"),
            ({"successor_alias": "app"}, "private Web relay alias"),
        ):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, error):
                handoff(raw, **kwargs)


if __name__ == "__main__":
    unittest.main()
