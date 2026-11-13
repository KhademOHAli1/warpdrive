"""Exercise the isolated Core route with the same native Caddy relay fixture."""

import hashlib
import json
import unittest

from caddy_core_config import CORE_PROBE_HEADER, CORE_READ_PATH, CORE_RESPONSE_HEADER, compile_core_relay, core_api_routes
import test_caddy_web_config as web


CORE = "warpdrive-core-api"


def compile_config(active=None, *, variant="successorB", **overrides):
    active = web.compile_configs()[variant] if active is None else active
    raw = json.dumps(active).encode()
    baseline = json.dumps(web.installed()).encode()
    arguments = {
        "expected_sha256": hashlib.sha256(raw).hexdigest(),
        "core_alias": CORE, "active_variant": variant, "baseline_bytes": baseline,
        "baseline_sha256": hashlib.sha256(baseline).hexdigest(),
        "host": web.HOST, "traefik_ip": web.PEER,
        "installed_relay_alias": web.OLD, "successor_relay_alias": web.NEW,
        "current": web.A, "candidate": web.B,
    }
    return compile_core_relay(raw, **(arguments | overrides))


class CoreCompilerTests(unittest.TestCase):
    def test_exact_relay_and_unique_private_alias_required(self):
        for variant in ("successorA", "successorB"):
            with self.subTest(variant=variant):
                result = compile_config(variant=variant)
                active = web.compile_configs()[variant]
                self.assertEqual(web.handler(result)["routes"][0], web.handler(active)["routes"][0])
                del web.handler(result)["routes"][1:4]
                self.assertEqual(result, web.compile_configs()[variant])
        for alias in ("localhost", "app", web.B.target, "ws", web.NEW, "core:3010"):
            with self.subTest(alias=alias), self.assertRaisesRegex(ValueError, "private Core"):
                compile_config(core_alias=alias)
        with self.assertRaisesRegex(ValueError, "pinned"):
            compile_config(expected_sha256="f" * 64)
        altered = web.compile_configs()["successorB"]
        web.handler(altered)["routes"].pop()
        with self.assertRaisesRegex(ValueError, "expected accepted"):
            compile_config(altered)

    def test_healthy_reverse_keeps_core_and_both_generation_selectors(self):
        forward = core_api_routes(CORE, web.B, web.A)
        reverse = core_api_routes(CORE, web.A, web.B)
        self.assertEqual(forward[1:], reverse[1:])
        self.assertTrue(all(route["handle"][1]["upstreams"] == [{"dial": CORE + ":3010"}] for route in reverse[1:]))
        expression = reverse[0]["match"][0]["expression"]
        self.assertIn(web.A.deployment_id, expression)
        self.assertIn(web.B.deployment_id, expression)
        self.assertNotIn(web.B.deployment_id, core_api_routes(CORE, web.A)[0]["match"][0]["expression"])


@unittest.skipUnless(web.CADDY, "native Caddy required for owned loopback proof")
class NativeCoreRouteTests(web.NativeCaddyTests):
    def test_core_route_keeps_web_actions_and_never_falls_back_on_failure(self):
        writes = []

        class CoreApp(web.FixtureApp):
            def do_GET(self):
                if self.path != CORE_READ_PATH:
                    return super().do_GET()
                body = b'{"error":{"json":{"data":{"code":"UNAUTHORIZED"}}}}'
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Fixture-Probe-Forwarded", "yes" if CORE_PROBE_HEADER in self.headers else "no")
                self.send_header(CORE_RESPONSE_HEADER, "origin-spoof")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                if self.path != "/api/trpc/notes.lostReply":
                    return super().do_POST()
                writes.append(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                # The backend consumed this operation. Drop the response before headers.
                self.close_connection = True
                return None

        core = web.ThreadingHTTPServer((web.PEER, 0), CoreApp)
        core.name = CORE
        thread = web.threading.Thread(target=core.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(core.server_close)
        self.addCleanup(core.shutdown)
        self.dials[f"{CORE}:3010"] = f"{web.PEER}:{core.server_port}"
        self.start(compile_config())
        probe = [(CORE_PROBE_HEADER, "1")]
        status, headers, _ = self.request("GET", CORE_READ_PATH, extra=probe)
        self.assertEqual((status, headers[CORE_RESPONSE_HEADER], headers["Cache-Control"], headers["X-Fixture-Probe-Forwarded"]),
                         (401, "1", "no-store", "no"))
        for extra in ([], [(CORE_PROBE_HEADER, "wrong")], probe + [("Cookie", "fixture=1")], probe + probe):
            self.assertIsNone(self.request("GET", CORE_READ_PATH, extra=extra)[1].get(CORE_RESPONSE_HEADER))
        status, headers, body = self.request("POST", "/api/trpc/version.get", body=b"fixture")
        self.assertEqual((status, headers["X-Content-Type-Options"], body), (200, "nosniff", CORE.encode()))
        self.assertEqual(self.request("GET", "/api/trpc")[2], CORE.encode())
        self.assertEqual(self.request("GET", "/api/trpc-other")[2], web.B.target.encode())
        self.assertEqual(self.request("GET", "/api/runtime/web-identity")[2], web.B.target.encode())
        self.assertEqual(self.request("GET", "/readyz")[2], web.B.target.encode())
        old = [("Next-Action", "a" * 42), ("X-Deployment-Id", web.A.deployment_id)]
        self.assertEqual(self.request("POST", "/board", extra=old)[2], b"app")
        wrong = [("X-Deployment-Id", "wd-" + "c" * 40)]
        self.assertEqual(self.request("POST", "/api/trpc/notes.create", extra=wrong)[0], 409)
        self.assertEqual(self.request("POST", "/api/trpc/notes.create", extra=old)[2], CORE.encode())
        headers = [("Idempotency-Key", "native-fixture-operation")]
        status, _, _ = self.request("POST", "/api/trpc/notes.lostReply", extra=headers, body=b"consumed")
        self.assertEqual(status, 502)
        self.assertEqual(writes, [b"consumed"])
        core.shutdown()
        core.server_close()
        status, _, _ = self.request("POST", "/api/trpc/notes.create", body=b"fixture")
        self.assertEqual(status, 502)
        status, headers, _ = self.request("GET", CORE_READ_PATH, extra=probe)
        self.assertEqual(status, 502)
        self.assertIsNone(headers.get(CORE_RESPONSE_HEADER))
        self.assertEqual(self.request("GET", "/api/runtime/web-identity")[0], 200)
