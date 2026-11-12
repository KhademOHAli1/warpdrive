"""Check the compiled JSON against Caddy and two owned loopback upstreams."""

from collections import deque
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

from web_generation_routes import WebGeneration, compile_web_generation_routes
from web_rollout import rollout_web
from web_switch import DefiniteRejected, SwitchUnknown, _read, content_hash


PREVIOUS = WebGeneration("wd-" + "a" * 40, "web-a")
CURRENT = WebGeneration("wd-" + "b" * 40, "web-b")
UNKNOWN = "wd-" + "c" * 40
ACTION = "00" + "1" * 40
CADDY = shutil.which("caddy")
ROOT = Path(__file__).resolve().parents[2]
ADMIN_ROUTE = "/config/apps/http/servers/fixture/routes/2/handle/0"


def compile_routes():
    return compile_web_generation_routes(current=CURRENT, previous=PREVIOUS)


class CompilationTests(unittest.TestCase):
    def test_rejects_noncanonical_ids_and_non_dns_aliases(self):
        for value in (None, "", "wd-" + "A" * 40, "wd-" + "b" * 41, "wd-" + "b" * 40 + "\n"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "deployment ID"):
                WebGeneration(value, "web")
        for value in (None, "web:3000", "127.0.0.1", "localhost", "Web", "web-", "a" * 64, "{host}", "web.prod"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "target alias"):
                WebGeneration(CURRENT.deployment_id, value)

    def test_requires_two_distinct_immutable_targets(self):
        for previous in (CURRENT, WebGeneration(CURRENT.deployment_id, "other"),
                         WebGeneration(PREVIOUS.deployment_id, CURRENT.target)):
            with self.subTest(previous=previous), self.assertRaisesRegex(ValueError, "distinct"):
                compile_web_generation_routes(current=CURRENT, previous=previous)

    def test_fixed_upstreams_and_no_unsafe_connection_reuse(self):
        handler = compile_routes()
        self.assertEqual(handler["handler"], "subroute")
        self.assertTrue(all(route["terminal"] for route in handler["routes"]))
        proxies = [h for route in handler["routes"] for h in route["handle"] if h["handler"] == "reverse_proxy"]
        self.assertEqual({h["upstreams"][0]["dial"] for h in proxies}, {"web-a:3000", "web-b:3000"})
        for proxy in proxies:
            self.assertEqual(len(proxy["upstreams"]), 1)
            self.assertEqual(proxy["load_balancing"], {"retries": 0, "try_duration": 0})
        unsafe = [route["handle"][0] for route in handler["routes"]
                  if not route.get("match") or route["match"][0]["expression"].startswith("method('POST') &&")
                  if route["handle"][0]["handler"] == "reverse_proxy"]
        self.assertEqual(len(unsafe), 3)
        self.assertTrue(all(h["transport"]["keep_alive"]["enabled"] is False for h in unsafe))

    @unittest.skipUnless(CADDY, "Caddy is required to adapt the real Caddyfile")
    def test_fits_the_adapted_production_web_fallback(self):
        adapted = subprocess.run(
            [CADDY, "adapt", "--adapter", "caddyfile", "--config", str(ROOT / "Caddyfile")],
            env={"APP_DOMAIN": "app.invalid", "ACME_EMAIL": "ops@app.invalid"},
            capture_output=True, check=True, timeout=5,
        )
        document = json.loads(adapted.stdout)
        sites = [r for s in document["apps"]["http"]["servers"].values() for r in s["routes"]]
        app = next(r for r in sites if r["match"] == [{"host": ["app.invalid"]}])
        app_routes = app["handle"][0]["routes"]
        handlers = [h for r in app_routes for h in r["handle"]]
        self.assertEqual([h["handler"] for h in handlers], ["headers", "request_body", "reverse_proxy", "reverse_proxy"])
        self.assertEqual(handlers[-2]["upstreams"], [{"dial": "ws:8080"}])
        self.assertEqual(handlers[-1]["upstreams"], [{"dial": "app:3000"}])
        self.assertEqual(handlers[-1]["headers"], next(h["headers"] for r in compile_routes()["routes"]
                                                       for h in r["handle"] if h["handler"] == "reverse_proxy"))


class FixtureApp(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def respond(self):
        data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.requests.append((self.command, self.path, dict(self.headers), data))
        if self.command == "POST" and self.path == "/drop-after-receive":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.close_connection = True
            return
        unavailable = self.path == "/candidate-unhealthy" and self.server.generation == "current"
        self.send_response(503 if unavailable else 200)
        self.send_header("X-Fixture-Generation", self.server.generation)
        self.send_header("X-Fixture-Deployment", self.server.deployment_id)
        self.send_header("X-Fixture-Runtime", self.server.runtime_id)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = respond
    do_HEAD = respond
    do_POST = respond
    do_PUT = respond
    do_PATCH = respond


class AdminConnection(http.client.HTTPConnection):
    def __init__(self, address):
        super().__init__("localhost", timeout=2)
        self.address = address

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self.address))


class FixtureRolloutTarget:
    """Real ingress CAS and HTTP identity checks over test-only artifact identities."""

    def __init__(self, fixture, *, unhealthy=False, lost_ack=False):
        self.fixture = fixture
        self.unhealthy = unhealthy
        self.lost_ack = lost_ack
        self.writes = []
        self.documents = {
            PREVIOUS.deployment_id: fixture.fixture_handler(PREVIOUS, CURRENT),
            CURRENT.deployment_id: fixture.fixture_handler(CURRENT, PREVIOUS),
        }
        self.plan = {"schemaVersion": 1, "kind": "warpdrive-web-rollout", "operationId": "native-fixture",
                     "targetKey": "loopback", "backendFingerprint": "e" * 64, "qualificationSha256": "f" * 64,
                     "before": self.slot(PREVIOUS, "1"), "after": self.slot(CURRENT, "2")}

    def slot(self, generation, number):
        runtime = {"runtimeId": number * 64, "name": generation.target, "running": True, "restartCount": 0,
                   "imageId": "sha256:" + number * 64, "sourceRevision": generation.deployment_id[3:],
                   "configSha256": number * 64, "schemaSha256": "d" * 64}
        route = {"runtimeId": runtime["runtimeId"], "generation": generation.deployment_id,
                 "fingerprint": content_hash(self.documents[generation.deployment_id])}
        return {"runtime": runtime, "route": route}

    def verify_qualification(self, plan, *, initialize):
        return plan == self.plan and (not initialize or self.inspect(plan)["route"] == plan["before"]["route"])

    def inspect(self, plan):
        fingerprint = content_hash(self.fixture.read_admin()[0])
        route = next(slot["route"] for slot in (plan["before"], plan["after"])
                     if slot["route"]["fingerprint"] == fingerprint)
        return {"route": route, "backendFingerprint": plan["backendFingerprint"],
                "beforeRuntime": self.observed_runtime(plan["before"]),
                "afterRuntime": self.observed_runtime(plan["after"])}

    def observed_runtime(self, slot):
        observation = self.observe_health(slot, proxied=False)
        if not observation["healthy"] or observation["generation"] != slot["route"]["generation"]:
            raise RuntimeError("Fixture upstream identity changed")
        return {**slot["runtime"], "runtimeId": observation["runtimeId"]}

    def observe_health(self, slot, *, proxied):
        generation = slot["route"]["generation"]
        if proxied:
            failed_candidate = self.unhealthy and generation == CURRENT.deployment_id
            path = "/candidate-unhealthy" if failed_candidate else "/api/runtime/web-identity"
            status, headers, _ = self.fixture.request("GET", path)
        else:
            upstream = self.fixture.previous if generation == PREVIOUS.deployment_id else self.fixture.current
            connection = http.client.HTTPConnection("127.0.0.1", upstream.server_port, timeout=2)
            try:
                connection.request("GET", "/api/runtime/web-identity")
                response = connection.getresponse()
                status = response.status
                headers = {key.lower(): value for key, value in response.getheaders()}
                response.read()
            finally:
                connection.close()
        if status not in (200, 503):
            raise RuntimeError("Fixture health response unavailable")
        return {"healthy": status == 200, "generation": headers["x-fixture-deployment"],
                "runtimeId": headers["x-fixture-runtime"]}

    def compare_and_swap_route(self, expected, desired):
        document, etag = self.fixture.read_admin()
        if content_hash(document) != expected["fingerprint"]:
            raise DefiniteRejected("Unexpected Caddy route before patch")
        status = self.fixture.patch_admin(self.documents[desired["generation"]], etag)
        if status == 412:
            raise DefiniteRejected("Caddy rejected stale route ETag")
        if status != 200:
            raise RuntimeError(f"Unexpected fixture Caddy admin response {status}")
        self.writes.append(desired["generation"])
        if self.lost_ack:
            raise TimeoutError("Simulated acknowledgement loss after a real Caddy patch")


@unittest.skipUnless(CADDY, "Caddy is required for owned loopback integration")
class NativeRoutingTests(unittest.TestCase):
    @classmethod
    def start_app(cls, generation, deployment_id, runtime_id):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureApp)
        server.generation = generation
        server.deployment_id = deployment_id
        server.runtime_id = runtime_id
        server.requests = deque()
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        cls.addClassCleanup(thread.join, 2)
        cls.addClassCleanup(server.server_close)
        cls.addClassCleanup(server.shutdown)
        return server

    @classmethod
    def fixture_handler(cls, current, previous):
        dials = {"web-a:3000": cls.previous.server_port, "web-b:3000": cls.current.server_port}
        handler = compile_web_generation_routes(current=current, previous=previous)
        for route in handler["routes"]:
            for proxy in route["handle"]:
                for upstream in proxy.get("upstreams", []):
                    upstream["dial"] = f"127.0.0.1:{dials[upstream['dial']]}"
        return handler

    @classmethod
    def setUpClass(cls):
        cls.previous = cls.start_app("previous", PREVIOUS.deployment_id, "1" * 64)
        cls.current = cls.start_app("current", CURRENT.deployment_id, "2" * 64)
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            cls.port = reserved.getsockname()[1]
        directory = cls.enterClassContext(tempfile.TemporaryDirectory(prefix="web-generation-caddy-"))
        cls.admin_address = Path(directory) / "admin.sock"
        config = Path(directory) / "caddy.json"
        config.write_text(json.dumps({
            "admin": {"listen": f"unix/{cls.admin_address}"},
            "apps": {"http": {"servers": {"fixture": {
                "listen": [f"127.0.0.1:{cls.port}"],
                "automatic_https": {"disable": True},
                "routes": [
                    {"handle": [{"handler": "headers", "response": {"set": {"X-Fixture-Ingress": ["fixed"]}}}]},
                    {"match": [{"path": ["/_ws*"]}], "handle": [{"handler": "static_response", "status_code": 204}],
                     "terminal": True},
                    {"handle": [cls.fixture_handler(CURRENT, PREVIOUS)], "terminal": True},
                ],
            }}}},
        }))
        log = cls.enterClassContext(tempfile.TemporaryFile())
        process = subprocess.Popen(
            [CADDY, "run", "--config", str(config)], stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            env={"XDG_CONFIG_HOME": directory, "XDG_DATA_HOME": directory},
        )
        cls.addClassCleanup(cls.stop_caddy, process)
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            try:
                status, headers, _ = cls.request("GET", "/_ws/fixture")
                if status == 204 and headers.get("x-fixture-ingress") == "fixed":
                    return
            except OSError:
                pass
            time.sleep(0.03)
        log.seek(0)
        raise RuntimeError(log.read(6000).decode(errors="replace"))

    @staticmethod
    def stop_caddy(process):
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)

    @classmethod
    def request(cls, method, path, headers=(), body=b""):
        connection = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=2)
        try:
            connection.putrequest(method, path, skip_host=True)
            connection.putheader("Host", "app.invalid")
            connection.putheader("Content-Length", str(len(body)))
            for name, value in headers:
                connection.putheader(name, value)
            connection.endheaders(body)
            response = connection.getresponse()
            return response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        finally:
            connection.close()

    @classmethod
    def read_admin(cls):
        connection = AdminConnection(cls.admin_address)
        try:
            connection.request("GET", ADMIN_ROUTE)
            response = connection.getresponse()
            etag = response.getheader("Etag")
            if response.status != 200 or not etag:
                raise RuntimeError("Fixture Caddy admin GET did not return an ETag")
            return json.loads(response.read()), etag
        finally:
            connection.close()

    @classmethod
    def patch_admin(cls, document, etag):
        connection = AdminConnection(cls.admin_address)
        try:
            connection.request("PATCH", ADMIN_ROUTE, json.dumps(document),
                               {"Content-Type": "application/json", "If-Match": etag})
            response = connection.getresponse()
            response.read()
            return response.status
        finally:
            connection.close()

    def restore_fixture(self):
        _, etag = self.read_admin()
        self.assertEqual(self.patch_admin(self.fixture_handler(CURRENT, PREVIOUS), etag), 200)

    def native_rollout(self, **options):
        self.addCleanup(self.restore_fixture)
        _, etag = self.read_admin()
        self.assertEqual(self.patch_admin(self.fixture_handler(PREVIOUS, CURRENT), etag), 200)
        target = FixtureRolloutTarget(self, **options)
        state = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="web-rollout-caddy-"))) / "state"
        elapsed = 0.0

        def sleep(seconds):
            nonlocal elapsed
            elapsed += seconds

        def run(*, initialize=False):
            return rollout_web(target.plan, state_dir=state, target=target, initialize=initialize,
                               clock=lambda: elapsed, sleep=sleep)

        def accepted_generation():
            return _read(state / "accepted-web-generation.json")["slot"]["route"]["generation"]

        return target, run, accepted_generation

    def test_native_caddy_rejects_a_stale_route_etag(self):
        self.addCleanup(self.restore_fixture)
        before, etag = self.read_admin()
        self.assertEqual(self.patch_admin(self.fixture_handler(PREVIOUS, CURRENT), etag), 200)
        self.assertEqual(self.patch_admin(before, etag), 412)
        self.assert_target("GET", "/api/runtime/web-identity", "previous")

    def test_controller_rolls_back_after_definite_native_health_failure(self):
        target, run, accepted = self.native_rollout(unhealthy=True)
        self.assertEqual(run(initialize=True)["state"], "rolled-back")
        self.assertEqual(accepted(), PREVIOUS.deployment_id)
        self.assertEqual(target.writes, [CURRENT.deployment_id, PREVIOUS.deployment_id])
        self.assert_target("GET", "/api/runtime/web-identity", "previous")

    def test_controller_reads_back_native_switch_when_acknowledgement_is_lost(self):
        target, run, accepted = self.native_rollout(lost_ack=True)
        with self.assertRaises(SwitchUnknown):
            run(initialize=True)
        self.assertEqual(accepted(), PREVIOUS.deployment_id)
        self.assert_target("GET", "/api/runtime/web-identity", "current")
        self.assertEqual(run()["state"], "accepted")
        self.assertEqual(accepted(), CURRENT.deployment_id)
        self.assertEqual(target.writes, [CURRENT.deployment_id])
        self.assert_target("GET", "/_next/static/old.js?dpl=" + PREVIOUS.deployment_id, "previous")

    def test_first_stamped_web_fences_unstamped_or_retired_page_actions(self):
        self.addCleanup(self.restore_fixture)
        _, etag = self.read_admin()
        self.assertEqual(self.patch_admin(self.fixture_handler(CURRENT, None), etag), 200)
        self.assert_target("GET", "/board", "current")
        self.assert_target("POST", "/board", "current", (("Next-Action", ACTION),
                           ("X-Deployment-Id", CURRENT.deployment_id)))
        self.assert_rejected("POST", "/board", (("Next-Action", ACTION),))
        self.assert_rejected("POST", "/board", (("Next-Action", ACTION),
                             ("X-Deployment-Id", PREVIOUS.deployment_id)))
        self.assert_rejected("GET", "/_next/static/old.js?dpl=" + PREVIOUS.deployment_id)

    def assert_target(self, method, path, expected, headers=(), body=b""):
        status, result, _ = self.request(method, path, headers, body)
        self.assertEqual(status, 200, result)
        self.assertEqual(result.get("x-fixture-generation"), expected)
        self.assertEqual(result.get("x-fixture-ingress"), "fixed")

    def assert_rejected(self, method, path, headers=()):
        before = (len(self.previous.requests), len(self.current.requests))
        status, result, body = self.request(method, path, headers)
        self.assertEqual(status, 409, result)
        self.assertEqual(result.get("cache-control"), "no-store")
        self.assertEqual(result.get("x-warpdrive-web-rejection"), "before-forward")
        self.assertNotIn(UNKNOWN.encode(), body)
        self.assertEqual((len(self.previous.requests), len(self.current.requests)), before)

    def test_static_and_navigation_choose_the_intended_generations(self):
        static = "/_next/static/chunks/app.js"
        self.assert_target("GET", static, "current")
        self.assert_target("GET", static + "?dpl=" + PREVIOUS.deployment_id, "previous")
        self.assert_target("HEAD", static + "?dpl=" + CURRENT.deployment_id, "current")
        self.assert_target("GET", static + "?x=1&%64pl=" + PREVIOUS.deployment_id, "previous")
        self.assert_target("GET", "/_next/staticity/app.js?dpl=" + UNKNOWN, "current")
        self.assert_target("GET", "/dashboard?dpl=" + PREVIOUS.deployment_id, "current",
                           [("RSC", "1"), ("X-Deployment-Id", PREVIOUS.deployment_id)])
        self.assert_target("GET", "/api/runtime/web-identity", "current",
                           [("X-Deployment-Id", PREVIOUS.deployment_id)])
        self.assert_rejected("GET", static + "?dpl=" + UNKNOWN)
        self.assert_rejected("GET", static + "?dpl=")
        self.assert_rejected("GET", static + "?dpl=" + PREVIOUS.deployment_id,
                             [("X-Deployment-Id", CURRENT.deployment_id)])

    def test_matching_actions_keep_origin_body_and_cookie(self):
        for generation, expected in ((PREVIOUS, "previous"), (CURRENT, "current")):
            body = b"fixture-action"
            path = "/dashboard?sort=asc&dpl=" + generation.deployment_id
            headers = [("Next-Action", ACTION), ("X-Deployment-Id", generation.deployment_id),
                       ("Origin", "https://app.invalid"), ("Cookie", "session=fixture"),
                       ("X-Real-IP", "203.0.113.2")]
            with self.subTest(expected=expected):
                self.assert_target("POST", path, expected, headers, body)
                upstream = getattr(self, expected)
                method, actual_path, forwarded, data = upstream.requests[-1]
                self.assertEqual((method, actual_path, data), ("POST", path, body))
                self.assertEqual(forwarded["Origin"], "https://app.invalid")
                self.assertEqual(forwarded["Host"], "app.invalid")
                self.assertEqual(forwarded["Cookie"], "session=fixture")
                self.assertEqual(forwarded["X-Real-Ip"], "127.0.0.1")
                self.assertEqual(forwarded["Connection"], "close")

    def test_unknown_ambiguous_and_malformed_selectors_fail_before_dispatch(self):
        old_header = ("X-Deployment-Id", PREVIOUS.deployment_id)
        action = [("Next-Action", ACTION)]
        for path, headers in (
            ("/dashboard", action),
            ("/dashboard?dpl=" + PREVIOUS.deployment_id, action),
            ("/dashboard", action + [("X-Deployment-Id", UNKNOWN)]),
            ("/dashboard", action + [("X-Deployment-Id", "")]),
            ("/dashboard", action + [old_header, old_header]),
            ("/dashboard", action + [old_header, ("X-Deployment-Id", CURRENT.deployment_id)]),
            ("/dashboard", action + [("X-Deployment-Id", f"{PREVIOUS.deployment_id},{CURRENT.deployment_id}")]),
            ("/dashboard", action + action + [old_header]),
            ("/dashboard", [("Next-Action", ""), old_header]),
            ("/dashboard?dpl=" + CURRENT.deployment_id, action + [old_header]),
            ("/dashboard?dpl=" + PREVIOUS.deployment_id + "&dpl=" + PREVIOUS.deployment_id, action + [old_header]),
            ("/dashboard?dpl=" + PREVIOUS.deployment_id + "&%64pl=", action + [old_header]),
            ("/dashboard?x=x;dpl=" + PREVIOUS.deployment_id, action + [old_header]),
            ("/dashboard?%64%70%6C=%GG", action + [old_header]),
            ("/dashboard?dpl", action + [old_header]),
            ("/api/trpc/safe", [("X-Deployment-Id", UNKNOWN)]),
            ("/dashboard", [("Content-Type", "multipart/form-data; boundary=example")]),
        ):
            with self.subTest(path=path, headers=headers):
                self.assert_rejected("POST", path, headers)
        self.assert_rejected("PATCH", "/api/work-profile?dpl=" + UNKNOWN)

    def test_direct_route_handlers_and_ordinary_posts_are_preserved(self):
        form = [("Content-Type", "application/x-www-form-urlencoded")]
        for path in ("/auth/logout", "/oauth/authorize?csrf=fixture", "/oauth/token", "/oauth/register/"):
            with self.subTest(path=path):
                self.assert_target("POST", path, "current", form, b"decision=approve")
        old_action = [("Next-Action", ACTION), ("X-Deployment-Id", PREVIOUS.deployment_id)]
        self.assert_target("POST", "/api/trpc/fixture", "current", old_action)
        self.assert_target("POST", "/auth/logout", "current", old_action)
        self.assert_target("POST", "/api/upload", "current", [("Content-Type", "multipart/form-data; boundary=fixture")])
        self.assert_target("POST", "/apiary?adpl=" + UNKNOWN + "&DPL=" + UNKNOWN, "previous", old_action)
        self.assert_target("POST", "/dashboard", "current", form, b"x=1")
        status, headers, _ = self.request("POST", "/_ws/fixture?dpl=" + UNKNOWN, old_action)
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("x-fixture-ingress"), "fixed")

    def test_dispatched_post_is_never_replayed_or_sent_to_the_other_web(self):
        previous_count, current_count = len(self.previous.requests), len(self.current.requests)
        headers = [("Next-Action", ACTION), ("X-Deployment-Id", PREVIOUS.deployment_id), ("Idempotency-Key", "fixture")]
        status, response, _ = self.request("POST", "/drop-after-receive", headers)
        self.assertEqual(status, 502)
        self.assertNotIn("x-warpdrive-web-rejection", response)
        self.assertEqual(len(self.previous.requests), previous_count + 1)
        self.assertEqual(len(self.current.requests), current_count)


if __name__ == "__main__":
    unittest.main()
