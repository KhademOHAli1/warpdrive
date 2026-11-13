"""Compile and exercise an owned Traefik/Caddy Web relay on loopback."""

import base64
from contextlib import closing
import hashlib
from http.client import HTTPConnection, HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

from traefik_web_relay import compile_traefik_web_relay
from test_web_generation_routes import AdminConnection
from web_generation_routes import WebGeneration


HOST = "crm.example.invalid"
OLD = WebGeneration("wd-" + "a" * 40, "web-a")
NEW = WebGeneration("wd-" + "b" * 40, "web-b")
ACTION = "b" * 42
CADDY = shutil.which("caddy")
TRAEFIK = shutil.which("traefik")
OPENSSL = shutil.which("openssl")


def baseline():
    return {"http": {
        "routers": {
            "app": {"rule": f"Host(`{HOST}`)", "entryPoints": ["websecure"], "tls": {},
                    "service": "incumbent", "middlewares": ["app-policy"]},
            "realtime": {"rule": f"Host(`{HOST}`) && PathPrefix(`/_ws`)", "priority": 100,
                         "entryPoints": ["websecure"], "tls": {}, "service": "ws"},
            "other": {"rule": "Host(`other.example.invalid`)", "service": "other"},
        },
        "services": {
            "incumbent": {"loadBalancer": {"servers": [{"url": "http://web-a:3000"}]}},
            "ws": {"loadBalancer": {"servers": [{"url": "http://ws:8080"}]}},
            "other": {"loadBalancer": {"servers": [{"url": "http://other:3000"}]}},
        },
        "middlewares": {
            "app-policy": {"chain": {"middlewares": ["security@file"]}},
            "security": {"headers": {"customResponseHeaders": {"X-Fixture-App-Policy": "unchanged"}}},
        },
    }}


def compile_config(dynamic=None, *, legacy=False, **options):
    arguments = {"app_router": "app", "realtime_router": "realtime", "host": HOST,
                 "relay_alias": "web-relay", "traefik_ip": "127.0.0.1"}
    if legacy:
        arguments["incumbent_alias"] = OLD.target
    else:
        arguments.update(current=NEW, previous=OLD)
    arguments.update(options)
    return compile_traefik_web_relay(dynamic if dynamic is not None else baseline(), **arguments)


def caddy_server(config):
    return config["apps"]["http"]["servers"]["web-relay"]


def upstreams(config):
    for route in caddy_server(config)["routes"][0]["handle"][0]["routes"]:
        for handler in route["handle"]:
            if handler["handler"] == "reverse_proxy":
                yield handler


class CompilerTests(unittest.TestCase):
    def test_retains_exact_unrelated_routes_and_app_tls_middleware(self):
        original = baseline()
        result = compile_config(original)["traefik"]["http"]
        self.assertEqual(original, baseline())
        before = original["http"]
        for name in ("realtime", "other"):
            self.assertEqual(result["routers"][name], before["routers"][name])
        self.assertEqual(result["middlewares"], before["middlewares"])
        self.assertEqual({key: result["services"][key] for key in before["services"]}, before["services"])
        safe = result["routers"]["app"]
        unsafe = result["routers"]["warpdrive-web-relay-unsafe"]
        self.assertEqual(safe["rule"], f"Host(`{HOST}`) && (Method(`GET`) || Method(`HEAD`))")
        self.assertEqual(unsafe["rule"], f"Host(`{HOST}`) && !(Method(`GET`) || Method(`HEAD`))")
        for router in (safe, unsafe):
            self.assertEqual(router["priority"], len(before["routers"]["app"]["rule"]))
            for key in ("entryPoints", "tls", "middlewares"):
                self.assertEqual(router[key], before["routers"]["app"][key])
            service = result["services"][router["service"]]["loadBalancer"]
            self.assertEqual(service["servers"], [{"url": "http://web-relay:8080"}])
            self.assertTrue(service["passHostHeader"])
        transport = result["services"][unsafe["service"]]["loadBalancer"]["serversTransport"]
        self.assertEqual(result["serversTransports"][transport], {"disableHTTP2": True, "maxIdleConnsPerHost": -1})

    def test_legacy_relay_targets_only_original_and_has_no_fake_generation(self):
        config = compile_config(legacy=True)["caddy"]
        self.assertEqual(config["admin"], {"disabled": True})
        self.assertEqual([proxy["upstreams"] for proxy in upstreams(config)], [[{"dial": "web-a:3000"}]] * 2)
        self.assertNotIn("deployment", json.dumps(config).lower())
        self.assertFalse(list(upstreams(config))[1]["transport"]["keep_alive"]["enabled"])
        with self.assertRaisesRegex(ValueError, "exact incumbent"):
            compile_config(legacy=True, incumbent_alias="unrelated")

    def test_docker_overlay_keeps_original_provider_and_exact_named_middleware(self):
        original = baseline()
        http = original["http"]
        http["routers"]["app"]["middlewares"] = ["security@docker", "body"]
        http["middlewares"]["body"] = {"buffering": {"maxRequestBodyBytes": 80_000_000, "memRequestBodyBytes": 1_048_576}}
        http["services"]["incumbent"]["loadBalancer"]["servers"][0]["url"] = "http://172.18.0.31:3000"
        result = compile_config(original, legacy=True, provider="docker", incumbent_ip="172.18.0.31")
        overlay = result["traefik"]["http"]
        self.assertEqual(set(overlay), {"routers", "services", "serversTransports"})
        self.assertEqual(set(overlay["routers"]), {"warpdrive-web-relay-safe", "warpdrive-web-relay-unsafe"})
        for route in overlay["routers"].values():
            self.assertEqual(route["middlewares"], ["security@docker", "body@docker"])
            self.assertEqual(route["priority"], len(http["routers"]["app"]["rule"]) + 1)
            self.assertEqual(route["tls"], http["routers"]["app"]["tls"])
        self.assertEqual([proxy["upstreams"] for proxy in upstreams(result["caddy"])], [[{"dial": "web-a:3000"}]] * 2)
        with self.assertRaisesRegex(ValueError, "exact incumbent"):
            compile_config(original, legacy=True, provider="docker", incumbent_ip="172.18.0.32")
        http["routers"]["app"]["priority"] = 99
        with self.assertRaisesRegex(ValueError, "No priority available"):
            compile_config(original, legacy=True, provider="docker", incumbent_ip="172.18.0.31")

    def test_rejects_ambiguous_topology_and_unverified_middleware(self):
        for options in ({"traefik_ip": "0.0.0.0"}, {"traefik_ip": "10.0.0.0/24"},
                        {"host": "evil.invalid`"}, {"relay_alias": "web-a"}, {"realtime_router": "other"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                compile_config(**options)
        for middleware in ({"retry": {"attempts": 2}}, {"buffering": {"retryExpression": "true"}},
                           {"plugin": {"unknown": {}}}, {"chain": {"middlewares": ["app-policy"]}},
                           {"headers": {"customRequestHeaders": {"X_Forwarded_Proto": "http"}}}):
            with self.subTest(middleware=middleware), self.assertRaisesRegex(ValueError, "middleware"):
                document = baseline()
                document["http"]["middlewares"]["security"] = middleware
                compile_config(document)


class ProbeBackend(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def respond(self):
        if self.server.name == "realtime" and self.headers.get("Upgrade", "").lower() == "websocket":
            self.websocket()
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.events.append((self.command, self.path, body, dict(self.headers)))
        if self.path == "/drop-after-effect":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.close_connection = True
            return
        payload = json.dumps({"backend": self.server.name, "path": self.path, "body": body.decode(),
                              "headers": {name.lower(): value for name, value in self.headers.items()}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def websocket(self):
        key = self.headers["Sec-WebSocket-Key"]
        digest = hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        self.send_response(101)
        self.send_header("Connection", "Upgrade")
        self.send_header("Upgrade", "websocket")
        self.send_header("Sec-WebSocket-Accept", base64.b64encode(digest).decode())
        self.end_headers()
        self.connection.settimeout(5)
        self.close_connection = True
        while self.rfile.read(7) == b"\x81\x81\0\0\0\0x":
            self.wfile.write(b"\x81\x01x")

    do_GET = respond
    do_HEAD = respond
    do_POST = respond


class FixtureDockerAPI(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        self.server.events.append(path)
        if path.endswith("/_ping"):
            self.send_response(200)
            self.send_header("API-Version", "1.52")
            self.send_header("Docker-Experimental", "false")
            self.send_header("OSType", "linux")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(b"OK")
            return
        if path.endswith("/version"):
            value = {"Version": "29.0.0", "ApiVersion": "1.52", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"}
        elif path.endswith("/containers/json"):
            value = [{"Id": identifier} for identifier in self.server.containers]
        else:
            parts = path.split("/")
            if len(parts) < 4 or parts[-3] != "containers" or parts[-1] != "json" or parts[-2] not in self.server.containers:
                self.send_error(404)
                return
            value = self.server.containers[parts[-2]]
        payload = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LoopbackFixture(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="web-relay-fixture-")))
        self.old = self.start_backend("old")
        self.new = self.start_backend("new")
        self.realtime = self.start_backend("realtime")
        self.relay_port = free_port()

    def start_backend(self, name, handler=ProbeBackend):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server.events, server.name = [], name
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def start_process(self, command, name, port):
        env = {"PATH": os.defpath, "XDG_CONFIG_HOME": str(self.directory), "XDG_DATA_HOME": str(self.directory)}
        log = self.enterContext(tempfile.TemporaryFile())
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, cwd=self.directory)
        self.addCleanup(self.stop_process, process)
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    return log
            except OSError:
                time.sleep(0.03)
        log.seek(0)
        self.fail(f"Owned {name} listener unavailable: {log.read(3000).decode(errors='replace')}")

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)

    def caddy_fixture(self, config, *, admin):
        server = caddy_server(config)
        server["listen"] = [f"127.0.0.1:{self.relay_port}"]
        ports = {"web-a:3000": self.old.server_port, "web-b:3000": self.new.server_port}
        for proxy in upstreams(config):
            target = proxy["upstreams"][0]
            target["dial"] = f"127.0.0.1:{ports[target['dial']]}"
        if admin:
            config["admin"] = {"listen": f"unix/{self.directory / 'admin.sock'}", "config": {"persist": False}}
        return config

    def start_caddy(self, config, *, admin=False):
        path = self.directory / "caddy.json"
        path.write_text(json.dumps(self.caddy_fixture(config, admin=admin)))
        self.start_process([CADDY, "run", "--config", str(path)], "Caddy", self.relay_port)

    def reload_caddy(self, config):
        route = "/config/apps/http/servers/web-relay/routes/0/handle/0"
        with closing(AdminConnection(self.directory / "admin.sock")) as connection:
            connection.request("GET", route)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            etag = response.getheader("ETag")
            self.assertIsNotNone(etag)
            response.read()
            desired = caddy_server(self.caddy_fixture(config, admin=True))["routes"][0]["handle"][0]
            connection.request("PATCH", route, json.dumps(desired), {"Content-Type": "application/json", "If-Match": etag})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()

    def public_connection(self):
        context = ssl.create_default_context(cafile=self.directory / "edge.pem")
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        return HTTPSConnection("127.0.0.1", self.edge_port, context=context, timeout=3)

    def request(self, method, path, headers=None, *, body=None, public=False):
        if public:
            connection = self.public_connection()
        else:
            connection = HTTPConnection("127.0.0.1", self.relay_port, timeout=3)
        try:
            connection.request(method, path, body=body, headers={"Host": HOST, **(headers or {})})
            result = connection.getresponse()
            return result.status, dict(result.getheaders()), result.read()
        finally:
            connection.close()


@unittest.skipUnless(CADDY, "Caddy is required for the native relay hop")
class CaddyTests(LoopbackFixture):
    def test_relay_pins_peer_and_https_then_preserves_action_and_client_identity(self):
        self.start_caddy(compile_config(traefik_ip="127.0.0.1")["caddy"])
        headers = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "198.51.100.9, 203.0.113.7",
                   "X-Real-IP": "198.51.100.10", "Origin": f"https://{HOST}", "Cookie": "fixture=synthetic",
                   "Next-Action": ACTION, "X-Deployment-Id": OLD.deployment_id}
        status, _, raw = self.request("POST", "/pipeline?fixture=1", headers, body=b"one")
        result = json.loads(raw)
        self.assertEqual((status, result["backend"], result["path"], result["body"]), (200, "old", "/pipeline?fixture=1", "one"))
        forwarded = result["headers"]
        self.assertEqual({key: forwarded[key] for key in ("host", "origin", "cookie", "x-real-ip", "x-forwarded-for",
                                                         "x-forwarded-proto", "x-forwarded-host", "connection")},
                         {"host": HOST, "origin": f"https://{HOST}", "cookie": "fixture=synthetic",
                          "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https",
                          "x-forwarded-host": HOST, "connection": "close"})
        self.assertEqual(self.request("GET", "/", {**headers, "Host": "other.example.invalid"})[0], 421)
        self.assertEqual(self.request("GET", "/", {**headers, "X-Forwarded-Proto": "http"})[0], 421)
        self.assertEqual(self.request("POST", "/pipeline", {**headers, "X-Deployment-Id": "unknown"})[0], 409)
        self.assertEqual((len(self.old.events), len(self.new.events)), (1, 0))

    def test_wrong_peer_is_rejected_even_with_the_exact_public_headers(self):
        self.start_caddy(compile_config(traefik_ip="127.0.0.2")["caddy"])
        self.assertEqual(self.request("GET", "/", {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7"})[0], 421)
        self.assertEqual((self.old.events, self.new.events), ([], []))

    def test_first_stamped_web_refuses_legacy_actions_before_forwarding(self):
        self.start_caddy(compile_config(previous=None)["caddy"])
        headers = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7", "Next-Action": ACTION}
        self.assertEqual(self.request("POST", "/pipeline", headers, body=b"old")[0], 409)
        self.assertEqual((self.old.events, self.new.events), ([], []))
        status, _, body = self.request("POST", "/pipeline", {**headers, "X-Deployment-Id": NEW.deployment_id}, body=b"new")
        self.assertEqual((status, json.loads(body)["backend"]), (200, "new"))


@unittest.skipUnless(CADDY and TRAEFIK and OPENSSL, "Exact native Traefik v3.7.17, Caddy and OpenSSL are required")
class ExactTwoHopTests(LoopbackFixture):
    def start_traefik(self, config, *, docker_api=None):
        version = subprocess.run([TRAEFIK, "version"], capture_output=True, text=True, check=True, timeout=5).stdout
        if not any(line.split() == ["Version:", "3.7.17"] for line in version.splitlines()):
            self.skipTest("Installed Traefik is not exact v3.7.17")
        self.edge_port = free_port()
        certificate, key = self.directory / "edge.pem", self.directory / "edge.key"
        subprocess.run([OPENSSL, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                        "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", str(key), "-out", str(certificate)],
                       capture_output=True, check=True, timeout=5)
        services = config["http"]["services"]
        for name, port in (("incumbent", self.old.server_port), ("ws", self.realtime.server_port),
                           ("warpdrive-web-relay-safe", self.relay_port), ("warpdrive-web-relay-unsafe", self.relay_port)):
            if name in services:
                services[name]["loadBalancer"]["servers"] = [{"url": f"http://127.0.0.1:{port}"}]
        tls = {"stores": {"default": {"defaultCertificate": {"certFile": str(certificate), "keyFile": str(key)}}}}
        dynamic_dir = self.directory / "dynamic"
        dynamic_dir.mkdir()
        dynamic = dynamic_dir / "relay.yml"
        providers = {"file": {"directory": str(dynamic_dir), "watch": docker_api is not None}}
        if docker_api is None:
            dynamic.write_text(json.dumps({**config, "tls": tls}))
        else:
            (dynamic_dir / "tls.yml").write_text(json.dumps({"tls": tls}))
            providers["docker"] = {"endpoint": f"tcp://127.0.0.1:{docker_api.server_port}",
                                   "watch": False, "exposedByDefault": False}
        static = self.directory / "static.yml"
        static.write_text(json.dumps({"entryPoints": {"websecure": {"address": f"127.0.0.1:{self.edge_port}"}},
                                      "providers": providers}))
        self.edge_log = self.start_process([TRAEFIK, "--configFile=" + str(static)], "Traefik", self.edge_port)
        return dynamic

    def start_docker_api(self):
        backend = self.start_backend("docker", FixtureDockerAPI)
        self.docker_api = backend
        backend.containers = {}
        for name, service, port in (("app", "incumbent", self.old.server_port), ("realtime", "ws", self.realtime.server_port)):
            identifier = ("a" if name == "app" else "b") * 64
            prefix = f"traefik.http.routers.{name}"
            router = baseline()["http"]["routers"][name]
            labels = {"traefik.enable": "true", f"{prefix}.rule": router["rule"], f"{prefix}.tls": "true",
                      f"{prefix}.entrypoints": "websecure", f"{prefix}.service": service,
                      f"traefik.http.services.{service}.loadbalancer.server.port": str(port)}
            if name == "app":
                labels[f"{prefix}.middlewares"] = "security"
                labels["traefik.http.middlewares.security.headers.customresponseheaders.X-Fixture-App-Policy"] = "unchanged"
            else:
                labels[f"{prefix}.priority"] = "100"
            backend.containers[identifier] = {"Id": identifier, "Name": f"/{name}", "State": {"Status": "running"},
                "Config": {"Labels": labels}, "HostConfig": {"NetworkMode": "fixture"},
                "NetworkSettings": {"Networks": {"fixture": {"IPAddress": "127.0.0.1", "NetworkID": "c" * 64}}}}
        return backend

    def wait_backend(self, expected):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            try:
                status, headers, raw = self.request("GET", "/", public=True)
                if status == 200 and json.loads(raw)["backend"] == expected:
                    self.assertEqual(headers["X-Fixture-App-Policy"], "unchanged")
                    return
            except OSError:
                pass
            time.sleep(0.05)
        self.edge_log.seek(0)
        docker_events = getattr(getattr(self, "docker_api", None), "events", ())
        self.fail(f"Expected Traefik Web backend was not observed: {docker_events}; "
                  + self.edge_log.read(3000).decode(errors="replace"))

    def open_realtime(self):
        connection = self.enterContext(closing(self.public_connection()))
        connection.connect()
        tunnel = connection.sock
        self.assertIsInstance(tunnel, ssl.SSLSocket)
        self.assertIn(tunnel.version(), {"TLSv1.2", "TLSv1.3"})
        stream = self.enterContext(tunnel.makefile("rb"))
        tunnel.sendall((f"GET /_ws HTTP/1.1\r\nHost: {HOST}\r\nOrigin: https://{HOST}\r\n"
                        "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
                        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").encode())
        self.assertTrue(stream.readline(1024).startswith(b"HTTP/1.1 101 "))
        for _ in range(20):
            if stream.readline(1024) == b"\r\n":
                return tunnel, stream
        self.fail("Realtime fixture returned too many upgrade headers")

    def test_exact_edge_routes_realtime_directly_and_never_replays_failed_mutation(self):
        documents = compile_config()
        self.start_caddy(compile_config(current=OLD, previous=NEW)["caddy"], admin=True)
        self.start_traefik(documents["traefik"])
        self.wait_backend("old")
        status, headers, raw = self.request("GET", "/", public=True)
        self.assertEqual(status, 200)
        self.assertEqual(headers["X-Fixture-App-Policy"], "unchanged")
        self.assertEqual(json.loads(raw)["backend"], "old")
        self.assertEqual(json.loads(self.request("GET", "/_ws", public=True)[2])["backend"], "realtime")
        tunnel, stream = self.open_realtime()
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")

        self.reload_caddy(documents["caddy"])
        self.assertEqual(json.loads(self.request("GET", "/", public=True)[2])["backend"], "new")
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")
        old_headers = {"Next-Action": ACTION, "X-Deployment-Id": OLD.deployment_id, "Origin": f"https://{HOST}",
                       "X-Forwarded-Proto": "http", "X-Forwarded-For": "203.0.113.77", "X-Real-IP": "203.0.113.78"}
        status, _, raw = self.request("POST", "/pipeline", old_headers, body=b"one", public=True)
        self.assertEqual(status, 200)
        result = json.loads(raw)
        self.assertEqual((result["backend"], result["body"]), ("old", "one"))
        self.assertEqual(result["headers"]["x-forwarded-proto"], "https")
        self.assertEqual(result["headers"]["x-forwarded-for"], "127.0.0.1")
        self.assertEqual(result["headers"]["x-real-ip"], "127.0.0.1")
        before = (len(self.old.events), len(self.new.events))
        self.assertEqual(self.request("POST", "/drop-after-effect", {**old_headers, "Idempotency-Key": "fixture"}, public=True)[0], 502)
        self.assertEqual((len(self.old.events), len(self.new.events)), (before[0] + 1, before[1]))
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")
        self.reload_caddy(compile_config(current=OLD, previous=NEW)["caddy"])
        self.assertEqual(json.loads(self.request("GET", "/", public=True)[2])["backend"], "old")
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")

    def test_docker_router_survives_file_overlay_activation_and_removal(self):
        source = baseline()
        source["http"]["routers"]["app"]["middlewares"] = ["security"]
        documents = compile_config(source, provider="docker")
        self.start_caddy(documents["caddy"])
        overlay = self.start_traefik(documents["traefik"], docker_api=self.start_docker_api())
        self.wait_backend("old")
        tunnel, stream = self.open_realtime()
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")

        staged = self.directory / "relay.staged"
        staged.write_text(json.dumps(documents["traefik"]))
        staged.replace(overlay)
        self.wait_backend("new")
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")

        overlay.unlink()
        self.wait_backend("old")
        tunnel.sendall(b"\x81\x81\0\0\0\0x")
        self.assertEqual(stream.read(3), b"\x81\x01x")


if __name__ == "__main__":
    unittest.main()
