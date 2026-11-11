"""Real owned-localhost stream tests; Docker ownership admission uses inspection fixtures."""

from __future__ import annotations

from contextlib import contextmanager
import socket
import socketserver
import threading
import time
import unittest

try:
    from .loopback_forwarder import ForwarderError, LoopbackForwarder, bridge_target, owned_bridge_forwarder
except ImportError:
    from loopback_forwarder import ForwarderError, LoopbackForwarder, bridge_target, owned_bridge_forwarder


LABEL, OWNER = "io.warpdrive.fixture.owner", "owned"


def inspections():
    network_id, container_id = "1" * 64, "2" * 64
    network = {"Id": network_id, "Name": "owned-network", "Driver": "bridge", "Internal": True,
               "Scope": "local", "Labels": {LABEL: OWNER},
               "IPAM": {"Config": [{"Subnet": "172.30.0.0/24", "Gateway": "172.30.0.1"}]},
               "Containers": {container_id: {"Name": "owned-registry", "IPv4Address": "172.30.0.2/24"}}}
    container = {"Id": container_id, "Name": "/owned-registry", "Config": {"Labels": {LABEL: OWNER}},
                 "HostConfig": {"NetworkMode": "owned-network", "PortBindings": {}},
                 "NetworkSettings": {"Ports": {"5000/tcp": None}, "Networks": {"owned-network": {
                     "NetworkID": network_id, "IPAddress": "172.30.0.2", "IPPrefixLen": 24}}}}
    return [network], [container]


def target(network, container):
    return bridge_target(network, container, owner_label=LABEL, owner=OWNER,
                         network_name="owned-network", container_name="owned-registry", port=5000)


def wait_until(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("Owned socket fixture did not reach bounded condition")
        time.sleep(0.01)


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


@contextmanager
def fixture_server(function):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(3)
            try:
                function(self.request)
            except (OSError, socket.timeout):
                pass

    with Server(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.02), daemon=True)
        thread.start()
        try:
            yield server.server_address
        finally:
            server.shutdown()
            thread.join(3)
            if thread.is_alive():
                raise AssertionError("Owned localhost fixture listener did not stop")


def echo(stream):
    while True:
        data = stream.recv(8192)
        if not data:
            return
        stream.sendall(data)


def receive_all(stream):
    result = bytearray()
    while True:
        data = stream.recv(16384)
        if not data:
            return bytes(result)
        result.extend(data)


def receive_exact(stream, length):
    result = bytearray()
    while len(result) < length:
        data = stream.recv(length - len(result))
        if not data:
            raise AssertionError("Owned fixture stream ended before its expected bytes")
        result.extend(data)
    return bytes(result)


class BridgeAdmissionTests(unittest.TestCase):
    def test_owned_private_internal_membership_is_required_without_port_publication(self):
        result = target(*inspections())
        self.assertEqual((result.address, result.port), ("172.30.0.2", 5000))
        self.assertTrue(result.metadata["internal"])
        self.assertEqual(result.metadata["dockerPublishedPorts"], 0)

    def test_foreign_extra_network_public_address_and_mismatched_ipam_are_rejected(self):
        mutations = [
            lambda n, c: n[0].update(Internal=False),
            lambda n, c: n[0]["Labels"].update({LABEL: "foreign"}),
            lambda n, c: n[0].update(Driver="host"),
            lambda n, c: n[0].update(Scope="swarm"),
            lambda n, c: c[0]["Config"]["Labels"].update({LABEL: "foreign"}),
            lambda n, c: c[0]["NetworkSettings"]["Networks"].update(outbound={}),
            lambda n, c: c[0]["NetworkSettings"]["Networks"]["owned-network"].update(NetworkID="3" * 64),
            lambda n, c: c[0]["NetworkSettings"]["Networks"]["owned-network"].update(IPAddress="8.8.8.8"),
            lambda n, c: n[0]["IPAM"]["Config"][0].update(Subnet="172.31.0.0/24"),
            lambda n, c: n[0]["Containers"]["2" * 64].update(IPv4Address="172.30.0.3/24"),
            lambda n, c: c[0]["HostConfig"].update(PortBindings={"5000/tcp": [{"HostIp": "127.0.0.1"}]}),
            lambda n, c: c[0]["NetworkSettings"].update(Ports={"5000/tcp": [{"HostIp": "0.0.0.0"}]}),
        ]
        for index, mutate in enumerate(mutations):
            network, container = inspections()
            mutate(network, container)
            with self.subTest(mutation=index), self.assertRaises(ForwarderError):
                target(network, container)

    def test_gateway_cannot_be_substituted_for_the_owned_container(self):
        network, container = inspections()
        container[0]["NetworkSettings"]["Networks"]["owned-network"]["IPAddress"] = "172.30.0.1"
        network[0]["Containers"]["2" * 64]["IPv4Address"] = "172.30.0.1/24"
        with self.assertRaises(ForwarderError):
            target(network, container)

    def test_owned_target_is_reinspected_before_each_upstream_open(self):
        network, container = inspections()

        class Docker:
            def __init__(self):
                self.calls = []

            def json(self, arguments, **options):
                self.calls.append(arguments)
                return network if arguments[0] == "network" else container

        docker = Docker()
        forwarder = owned_bridge_forwarder(docker, owner_label=LABEL, owner=OWNER,
                                            network_name="owned-network", container_name="owned-registry", port=5000)
        forwarder.before_connect()
        self.assertEqual(len(docker.calls), 4)
        container[0]["Config"]["Labels"][LABEL] = "foreign"
        with self.assertRaises(ForwarderError):
            forwarder.before_connect()


class RealLoopbackTests(unittest.TestCase):
    def test_large_duplex_stream_is_exact_with_bounded_buffers_and_half_close(self):
        payload = bytes(range(256)) * 2048
        with fixture_server(echo) as upstream:
            with LoopbackForwarder(*upstream, buffer_bytes=4096) as forwarder:
                self.assertTrue(forwarder.authority.startswith("127.0.0.1:"))
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=5) as client:
                    errors = []

                    def send():
                        try:
                            client.sendall(payload)
                            client.shutdown(socket.SHUT_WR)
                        except OSError as error:
                            errors.append(type(error).__name__)

                    sender = threading.Thread(target=send)
                    sender.start()
                    self.assertEqual(receive_all(client), payload)
                    sender.join(5)
                    self.assertFalse(sender.is_alive())
                    self.assertEqual(errors, [])
                wait_until(lambda: forwarder.snapshot()["activeConnections"] == 0)
                stats = forwarder.snapshot()
                self.assertEqual(stats["bytesRelayed"], len(payload) * 2)
                self.assertLessEqual(stats["peakBufferedBytesPerConnection"], 8192)

    def test_server_first_response_and_reply_after_client_half_close(self):
        def handler(stream):
            stream.sendall(b"hello")
            request = receive_all(stream)
            stream.sendall(b"reply:" + request)

        with fixture_server(handler) as upstream:
            with LoopbackForwarder(*upstream) as forwarder:
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=3) as client:
                    self.assertEqual(receive_exact(client, 5), b"hello")
                    client.sendall(b"owned-request")
                    client.shutdown(socket.SHUT_WR)
                    self.assertEqual(receive_all(client), b"reply:owned-request")

    def test_close_terminates_only_owned_listener_and_connections(self):
        with fixture_server(echo) as upstream:
            unrelated = socket.create_connection(upstream, timeout=3)
            forwarder = LoopbackForwarder(*upstream).start()
            address = ("127.0.0.1", int(forwarder.authority.split(":")[1]))
            client = socket.create_connection(address, timeout=3)
            try:
                client.sendall(b"ready")
                self.assertEqual(receive_exact(client, 5), b"ready")
                forwarder.close()
                self.assertTrue(forwarder.snapshot()["closed"])
                self.assertEqual(forwarder.snapshot()["activeConnections"], 0)
                self.assertEqual(forwarder.snapshot()["openSockets"], 0)
                with self.assertRaises(OSError):
                    socket.create_connection(address, timeout=0.2)
                unrelated.sendall(b"untouched")
                self.assertEqual(receive_exact(unrelated, 9), b"untouched")
            finally:
                client.close()
                unrelated.close()
                forwarder.close()

    def test_idle_connection_is_closed_within_bound(self):
        with fixture_server(echo) as upstream:
            with LoopbackForwarder(*upstream, idle_seconds=0.15) as forwarder:
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=3) as client:
                    self.assertEqual(client.recv(1), b"")
                wait_until(lambda: forwarder.snapshot()["timeouts"] == 1)

    def test_connection_limit_rejects_excess_without_spawning_unbounded_workers(self):
        with fixture_server(echo) as upstream:
            with LoopbackForwarder(*upstream, max_connections=1) as forwarder:
                address = ("127.0.0.1", int(forwarder.authority.split(":")[1]))
                with socket.create_connection(address, timeout=3) as first:
                    first.sendall(b"ready")
                    self.assertEqual(receive_exact(first, 5), b"ready")
                    with socket.create_connection(address, timeout=3) as excess:
                        self.assertEqual(excess.recv(1), b"")
                    self.assertEqual(forwarder.snapshot()["rejected"], 1)
                    self.assertEqual(forwarder.snapshot()["activeConnections"], 1)

    def test_total_stream_budget_closes_excess_transfer(self):
        with fixture_server(echo) as upstream:
            with LoopbackForwarder(*upstream, buffer_bytes=1024, total_bytes=4096) as forwarder:
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=3) as client:
                    try:
                        client.sendall(b"x" * 32768)
                        receive_all(client)
                    except OSError:
                        pass
                wait_until(lambda: forwarder.snapshot()["streamLimitReached"] == 1)
                self.assertLessEqual(forwarder.snapshot()["bytesRelayed"], 4096)

    def test_failed_fresh_ownership_verification_opens_no_upstream_socket(self):
        contacted = threading.Event()

        def handler(stream):
            contacted.set()

        def reject():
            raise ForwarderError("Fixture became foreign")

        with fixture_server(handler) as upstream:
            with LoopbackForwarder(*upstream, before_connect=reject) as forwarder:
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=3) as client:
                    self.assertEqual(client.recv(1), b"")
                wait_until(lambda: forwarder.snapshot()["ownershipFailures"] == 1)
                self.assertFalse(contacted.is_set())

    def test_connection_lifetime_is_bounded_even_with_continuous_activity(self):
        with fixture_server(echo) as upstream:
            with LoopbackForwarder(*upstream, idle_seconds=1, lifetime_seconds=0.2) as forwarder:
                with socket.create_connection(("127.0.0.1", int(forwarder.authority.split(":")[1])), timeout=3) as client:
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        try:
                            client.sendall(b"x")
                            if not client.recv(1):
                                break
                        except OSError:
                            break
                        time.sleep(0.02)
                wait_until(lambda: forwarder.snapshot()["timeouts"] == 1)

    def test_public_dns_unspecified_and_invalid_limits_fail_before_binding(self):
        for address in ("8.8.8.8", "registry.example.com", "0.0.0.0", "169.254.169.254", "224.0.0.1"):
            with self.subTest(address=address), self.assertRaises(ForwarderError):
                LoopbackForwarder(address, 5000)
        with self.assertRaises(ForwarderError):
            LoopbackForwarder("127.0.0.1", 5000, max_connections=10000)


if __name__ == "__main__":
    unittest.main()
