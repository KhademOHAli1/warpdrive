"""Test the exact installed overlay contract without running a proxy."""

from hashlib import sha256
import json
import unittest

from traefik_web_handoff import compile_traefik_web_handoff
from traefik_web_relay import compile_traefik_web_relay
from web_generation_routes import WebGeneration


HOST = "crm.pitant.de"
OLD = "warpdrive-web-relay-" + "a" * 12
NEW = "warpdrive-web-relay-" + "b" * 12
SAFE = "warpdrive-web-relay-safe"
UNSAFE = "warpdrive-web-relay-unsafe"


def installed_overlay(alias):
    host_rule = f"Host(`{HOST}`)"
    entry = {"entryPoints": ["https"], "tls": {"certResolver": "letsencrypt"}}
    original = {"http": {
        "routers": {
            "warpdrive-app": {**entry, "rule": host_rule, "service": "warpdrive-app",
                              "middlewares": ["warpdrive-app-headers", "warpdrive-app-body"]},
            "warpdrive-ws": {**entry, "rule": host_rule + " && PathPrefix(`/_ws`)", "priority": 100,
                             "service": "warpdrive-ws", "middlewares": ["warpdrive-app-headers@docker"]},
        },
        "services": {
            "warpdrive-app": {"loadBalancer": {"servers": [{"url": "http://app:3000"}]}},
            "warpdrive-ws": {"loadBalancer": {"servers": [{"url": "http://ws:8080"}]}},
        },
        "middlewares": {
            "warpdrive-app-headers": {"headers": {"stsSeconds": 31536000, "stsIncludeSubdomains": True}},
            "warpdrive-app-body": {"buffering": {"maxRequestBodyBytes": 80_000_000, "memRequestBodyBytes": 1_048_576}},
        },
    }}
    result = compile_traefik_web_relay(
        original, app_router="warpdrive-app", realtime_router="warpdrive-ws", host=HOST,
        relay_alias=alias, traefik_ip="10.0.8.2", provider="docker",
        current=WebGeneration("wd-" + "a" * 40, "app"),
    )["traefik"]
    for service in result["http"]["services"].values():
        service["loadBalancer"]["healthCheck"] = {
            "path": "/api/health", "interval": "15s", "timeout": "5s", "hostname": HOST,
            "headers": {"X-Forwarded-Proto": "https"}, "status": 200, "followRedirects": False,
        }
    return result


def handoff(raw, **overrides):
    defaults = {"expected_sha256": sha256(raw).hexdigest(), "original_alias": OLD, "successor_alias": NEW}
    return compile_traefik_web_handoff(raw, **{**defaults, **overrides})


class TraefikWebHandoffTests(unittest.TestCase):
    def test_preserves_preimage_and_changes_only_both_relay_urls(self):
        old = installed_overlay(OLD)
        raw = json.dumps(old, indent=2).encode() + b"\n"
        result = handoff(raw)
        self.assertEqual(result.before_document, raw)
        self.assertEqual(result.before_sha256, sha256(raw).hexdigest())
        self.assertEqual(result.after_sha256, sha256(result.after_document).hexdigest())
        updated = json.loads(result.after_document)
        self.assertEqual(updated, installed_overlay(NEW))
        for name in (SAFE, UNSAFE):
            upstream = updated["http"]["services"][name]["loadBalancer"]["servers"][0]
            self.assertEqual(upstream["url"], f"http://{NEW}:8080")
            upstream["url"] = f"http://{OLD}:8080"
        self.assertEqual(updated, old)
        self.assertEqual(handoff(json.dumps(old, sort_keys=True).encode()).after_document, result.after_document)

    def test_rejects_wrong_raw_pin_and_invalid_aliases(self):
        raw = json.dumps(installed_overlay(OLD)).encode()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            handoff(raw + b"\n", expected_sha256=sha256(raw).hexdigest())
        for alias in (OLD, NEW.upper(), f"{NEW}:8080", f"{NEW}.example.com", "traefik", "app", None):
            with self.subTest(alias=alias), self.assertRaisesRegex(ValueError, "private Web relay aliases"):
                handoff(raw, successor_alias=alias)
        with self.assertRaisesRegex(ValueError, "reviewed profile"):
            handoff(raw, original_alias="warpdrive-web-relay-" + "c" * 12)

    def test_rejects_ambiguous_or_invalid_json_before_compiling(self):
        raw = json.dumps(installed_overlay(OLD)).encode()
        duplicate_url = b'"url":"http://wrong:8080", "url":'
        for invalid in (raw.replace(b'"url":', duplicate_url, 1), raw + b" {}", b"\xff", b"[" * 1200):
            with self.subTest(invalid=invalid[:32]), self.assertRaisesRegex(ValueError, "Invalid installed"):
                handoff(invalid)
        for invalid in (b"", b" " * (65536 + 1)):
            with self.assertRaisesRegex(ValueError, "Bounded"):
                handoff(invalid)

    def test_rejects_changes_to_security_topology_health_or_unsafe_transport(self):
        old = json.dumps(installed_overlay(OLD)).encode()
        changes = (
            (b"crm.pitant.de", b"other.pitant.de"),
            (b'"priority": 22', b'"priority": 101'),
            (b'"https"],', b'"http"],'),
            (b'"certResolver": "letsencrypt"', b'"certResolver": "another"'),
            (b"warpdrive-app-headers@docker", b"warpdrive-app-headers@file"),
            (b"warpdrive-app-body@docker", b"retry@docker"),
            (b"Method(`HEAD`)", b"Method(`POST`)"),
            (b"X-Forwarded-Proto", b"X-Untrusted-Proto"),
            (b'"status": 200', b'"status": 200.0'),
            (b'"passHostHeader": true', b'"passHostHeader": 1'),
            (b'"disableHTTP2": true', b'"disableHTTP2": false'),
            (b'"maxIdleConnsPerHost": -1', b'"maxIdleConnsPerHost": 2'),
            (OLD.encode(), NEW.encode()),
        )
        for before, after in changes:
            with self.subTest(before=before):
                self.assertIn(before, old)
                with self.assertRaisesRegex(ValueError, "reviewed profile"):
                    handoff(old.replace(before, after, 1))

    def test_rejects_extra_routes_and_upstreams(self):
        ws_route = installed_overlay(OLD)
        ws_route["http"]["routers"]["warpdrive-ws"] = {"rule": "PathPrefix(`/_ws`)", "priority": 100}
        with self.assertRaisesRegex(ValueError, "reviewed profile"):
            handoff(json.dumps(ws_route).encode())
        for field, value in (("servers", [{"url": f"http://{OLD}:8080"}] * 2), ("sticky", {"cookie": {}})):
            with self.subTest(field=field):
                overlay = installed_overlay(OLD)
                overlay["http"]["services"][UNSAFE]["loadBalancer"][field] = value
                with self.assertRaisesRegex(ValueError, "reviewed profile"):
                    handoff(json.dumps(overlay).encode())


if __name__ == "__main__":
    unittest.main()
