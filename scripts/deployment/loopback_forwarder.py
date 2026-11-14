"""Bounded host-loopback TCP access to an explicitly verified fixture endpoint.

Docker internal bridge networks deliberately retain no outbound route. A host-side
listener avoids changing that network policy merely to exercise a native fixture.
This module has no CLI and never discovers, resolves or redirects a target itself.
"""

from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import math
import re
import selectors
import socket
import threading
import time
from typing import Any, Callable


PRIVATE = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
IDENTIFIER = re.compile(r"[0-9a-f]{64}\Z")


class ForwarderError(RuntimeError):
    pass


@dataclass(frozen=True)
class BridgeTarget:
    address: str
    port: int
    metadata: dict[str, Any]


def _one(value):
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise ForwarderError("Exactly one owned fixture inspection required")
    return value[0]


def _private(address: ipaddress.IPv4Address) -> bool:
    return any(address in network for network in PRIVATE)


def bridge_target(network_rows, container_rows, *, owner_label: str, owner: str,
                  network_name: str, container_name: str, port: int) -> BridgeTarget:
    """Bind a fixed target to matching owned internal-bridge/IPAM inspections."""
    network, container = _one(network_rows), _one(container_rows)
    if (network.get("Name") != network_name or network.get("Driver") != "bridge"
            or network.get("Internal") is not True or network.get("Scope") != "local"
            or (network.get("Labels") or {}).get(owner_label) != owner
            or not IDENTIFIER.fullmatch(str(network.get("Id", "")))):
        raise ForwarderError("Owned local internal bridge was not established")
    if (container.get("Name") != "/" + container_name
            or (container.get("Config", {}).get("Labels") or {}).get(owner_label) != owner
            or not IDENTIFIER.fullmatch(str(container.get("Id", "")))):
        raise ForwarderError("Owned fixture container identity was not established")
    host = container.get("HostConfig") or {}
    if host.get("NetworkMode") != network_name or host.get("PortBindings"):
        raise ForwarderError("Fixture must have one internal network and no Docker published ports")
    settings = container.get("NetworkSettings") or {}
    networks = settings.get("Networks")
    if not isinstance(networks, dict) or set(networks) != {network_name}:
        raise ForwarderError("Fixture has an unexpected additional network attachment")
    if any(value for value in (settings.get("Ports") or {}).values()):
        raise ForwarderError("Fixture unexpectedly publishes a Docker port")
    endpoint = networks[network_name]
    if not isinstance(endpoint, dict) or endpoint.get("NetworkID") != network["Id"]:
        raise ForwarderError("Container endpoint does not belong to the owned bridge")
    try:
        address = ipaddress.IPv4Address(endpoint.get("IPAddress", ""))
    except ipaddress.AddressValueError as error:
        raise ForwarderError("Fixture endpoint needs a private numeric IPv4 address") from error
    if not _private(address):
        raise ForwarderError("Fixture endpoint is outside RFC1918 private IPv4 ranges")
    member = (network.get("Containers") or {}).get(container["Id"])
    if not isinstance(member, dict) or member.get("Name") != container_name:
        raise ForwarderError("Network membership does not identify the owned container")
    try:
        member_ip = ipaddress.IPv4Interface(member.get("IPv4Address", ""))
    except ValueError as error:
        raise ForwarderError("Owned network membership has no valid IPv4 address") from error
    if member_ip.ip != address or endpoint.get("IPPrefixLen") != member_ip.network.prefixlen:
        raise ForwarderError("Container and network endpoint addresses differ")
    configs = (network.get("IPAM") or {}).get("Config")
    admitted = None
    if isinstance(configs, list):
        for config in configs:
            if not isinstance(config, dict):
                continue
            try:
                subnet = ipaddress.ip_network(config.get("Subnet", ""), strict=True)
            except ValueError:
                continue
            if not isinstance(subnet, ipaddress.IPv4Network) or not any(subnet.subnet_of(item) for item in PRIVATE):
                continue
            if subnet != member_ip.network or address in {subnet.network_address, subnet.broadcast_address}:
                continue
            gateway = config.get("Gateway")
            if gateway and str(address) == gateway:
                continue
            admitted = str(subnet)
    if admitted is None:
        raise ForwarderError("Owned endpoint is not proven by private bridge IPAM")
    if type(port) is not int or not 1 <= port <= 65535:
        raise ForwarderError("A fixed fixture TCP port is required")
    return BridgeTarget(str(address), port, {
        "networkName": network_name, "networkId": network["Id"], "driver": "bridge",
        "internal": True, "scope": "local", "subnet": admitted,
        "containerName": container_name, "containerId": container["Id"],
        "containerIPv4": str(address), "targetPort": port, "dockerPublishedPorts": 0,
    })


class LoopbackForwarder:
    """Opaque duplex relay with one numeric fixed destination and bounded resources.

    Container callers must obtain their target through bridge_target first. Numeric
    loopback destinations also support trusted local fixtures and real socket tests.
    Each direction has at most buffer_bytes of Python buffering; kernel socket buffers
    and concurrent connections are explicitly bounded too. Payloads are never logged.
    """

    def __init__(self, address: str, port: int, *, max_connections: int = 16,
                 buffer_bytes: int = 65536, idle_seconds: float = 30,
                 lifetime_seconds: float = 300, connect_seconds: float = 3,
                 total_bytes: int = 32 * 1024 ** 3, connection_bytes: int = 8 * 1024 ** 3,
                 before_connect: Callable[[], None] | None = None, backpressure: bool = False):
        try:
            target = ipaddress.IPv4Address(address)
        except ipaddress.AddressValueError as error:
            raise ForwarderError("Forwarder destination must be numeric private IPv4 or loopback") from error
        if not (_private(target) or target.is_loopback) or target.is_unspecified:
            raise ForwarderError("Forwarder destination must be private IPv4 or loopback")
        if not target.is_loopback and before_connect is None:
            raise ForwarderError("Private fixture target requires fresh ownership verification")
        if type(port) is not int or not 1 <= port <= 65535:
            raise ForwarderError("Forwarder destination port is invalid")
        if (type(max_connections) is not int or not 1 <= max_connections <= 32
                or type(buffer_bytes) is not int or not 1024 <= buffer_bytes <= 262144
                or type(total_bytes) is not int or not 1 <= total_bytes <= 64 * 1024 ** 3
                or type(connection_bytes) is not int or not 1 <= connection_bytes <= 16 * 1024 ** 3
                or type(backpressure) is not bool
                or not 0.05 <= idle_seconds <= 60 or not 0.1 <= lifetime_seconds <= 600
                or not 0.05 <= connect_seconds <= 5):
            raise ForwarderError("Forwarder resource limits are invalid")
        self.target = (str(target), port)
        self.max_connections, self.buffer_bytes = max_connections, buffer_bytes
        self.backpressure = backpressure
        self.listen_backlog = 32 if backpressure else max_connections
        self.idle_seconds, self.lifetime_seconds, self.connect_seconds = idle_seconds, lifetime_seconds, connect_seconds
        self.byte_limit = total_bytes
        self.connection_byte_limit = connection_bytes
        self.before_connect = before_connect
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(max_connections)
        self._listener = None
        self._accept_thread = None
        self._workers = set()
        self._sockets = set()
        self._port = None
        self._counters = {"accepted": 0, "rejected": 0, "connectFailures": 0, "timeouts": 0,
                          "ownershipFailures": 0, "streamLimitReached": 0, "bytesRelayed": 0,
                          "peakBufferedBytesPerConnection": 0, "peakActiveConnections": 0}

    @property
    def authority(self):
        if self._port is None:
            raise ForwarderError("Forwarder has not bound its loopback listener")
        return f"127.0.0.1:{self._port}"

    def _count(self, key, amount=1):
        with self._lock:
            self._counters[key] += amount

    def start(self):
        if self._listener is not None or self._stop.is_set():
            raise ForwarderError("Forwarder may only be started once")
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(self.listen_backlog)
            listener.settimeout(0.2)
            self._listener = listener
            self._port = listener.getsockname()[1]
            self._accept_thread = threading.Thread(target=self._accept, name="fixture-loopback-accept", daemon=True)
            self._accept_thread.start()
        except Exception:
            listener.close()
            raise
        return self

    def _accept(self):
        while not self._stop.is_set():
            reserved = False
            if self.backpressure:
                # Leave excess connections in the bounded kernel backlog rather
                # than accepting them into Python and resetting them at the cap.
                if not self._slots.acquire(timeout=0.1):
                    continue
                reserved = True
            try:
                client, peer = self._listener.accept()
            except socket.timeout:
                if reserved:
                    self._slots.release()
                continue
            except OSError:
                if reserved:
                    self._slots.release()
                break
            if self._stop.is_set():
                client.close()
                if reserved:
                    self._slots.release()
                break
            if not ipaddress.IPv4Address(peer[0]).is_loopback:
                client.close()
                if reserved:
                    self._slots.release()
                self._count("rejected")
                continue
            if not reserved and not self._slots.acquire(blocking=False):
                client.close()
                self._count("rejected")
                continue
            with self._lock:
                if self._stop.is_set():
                    client.close()
                    self._slots.release()
                    break
                self._sockets.add(client)
                worker = threading.Thread(target=self._connection, args=(client,), name="fixture-loopback-stream", daemon=True)
                self._workers.add(worker)
                self._counters["accepted"] += 1
                self._counters["peakActiveConnections"] = max(self._counters["peakActiveConnections"], len(self._workers))
                worker.start()

    def _connection(self, client):
        upstream = None
        try:
            if self._stop.is_set():
                return
            if self.before_connect is not None:
                try:
                    self.before_connect()
                except Exception:
                    self._count("ownershipFailures")
                    return
            if self._stop.is_set():
                return
            try:
                upstream = socket.create_connection(self.target, timeout=self.connect_seconds)
            except OSError:
                self._count("connectFailures")
                return
            if self._stop.is_set():
                return
            with self._lock:
                self._sockets.add(upstream)
            for stream in (client, upstream):
                stream.setblocking(False)
                stream.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, self.buffer_bytes)
                stream.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, self.buffer_bytes)
                stream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self._relay(client, upstream)
        except (OSError, ValueError):
            pass  # Connection reset/close is a transport outcome; never expose payload bytes.
        finally:
            for stream in (client, upstream):
                if stream is not None:
                    try:
                        stream.close()
                    finally:
                        with self._lock:
                            self._sockets.discard(stream)
            with self._lock:
                self._workers.discard(threading.current_thread())
            self._slots.release()

    def _relay(self, client, upstream):
        streams = (client, upstream)
        other = {client: upstream, upstream: client}
        pending = {client: bytearray(), upstream: bytearray()}
        reading, writing = dict.fromkeys(streams, True), dict.fromkeys(streams, True)
        started = last_activity = time.monotonic()
        stream_bytes = 0
        with selectors.DefaultSelector() as selector:
            while not self._stop.is_set():
                now = time.monotonic()
                if now - last_activity >= self.idle_seconds or now - started >= self.lifetime_seconds:
                    self._count("timeouts")
                    return
                for stream in streams:
                    destination = other[stream]
                    if not reading[stream] and not pending[destination] and writing[destination]:
                        try:
                            destination.shutdown(socket.SHUT_WR)
                        except OSError:
                            pass
                        writing[destination] = False
                    events = 0
                    if reading[stream] and len(pending[destination]) < self.buffer_bytes:
                        events |= selectors.EVENT_READ
                    if pending[stream]:
                        events |= selectors.EVENT_WRITE
                    try:
                        selector.get_key(stream)
                        if events:
                            selector.modify(stream, events)
                        else:
                            selector.unregister(stream)
                    except KeyError:
                        if events:
                            selector.register(stream, events)
                if not any(reading.values()) and not any(pending.values()):
                    return
                with self._lock:
                    self._counters["peakBufferedBytesPerConnection"] = max(
                        self._counters["peakBufferedBytesPerConnection"], sum(map(len, pending.values())))
                for key, events in selector.select(timeout=0.1):
                    stream, destination = key.fileobj, other[key.fileobj]
                    if events & selectors.EVENT_READ:
                        try:
                            data = stream.recv(self.buffer_bytes - len(pending[destination]))
                        except BlockingIOError:
                            data = None
                        if data:
                            with self._lock:
                                if (self._counters["bytesRelayed"] + len(data) > self.byte_limit
                                        or stream_bytes + len(data) > self.connection_byte_limit):
                                    self._counters["streamLimitReached"] += 1
                                    return
                                self._counters["bytesRelayed"] += len(data)
                                stream_bytes += len(data)
                            pending[destination].extend(data)
                            last_activity = time.monotonic()
                        elif data == b"":
                            reading[stream] = False
                    if events & selectors.EVENT_WRITE and pending[stream]:
                        try:
                            sent = stream.send(pending[stream])
                        except BlockingIOError:
                            sent = 0
                        if sent:
                            del pending[stream][:sent]
                            last_activity = time.monotonic()

    def snapshot(self):
        with self._lock:
            return {**self._counters, "activeConnections": len(self._workers),
                    "openSockets": len(self._sockets), "closed": self._stop.is_set(),
                    "maxConnections": self.max_connections, "bufferBytesPerDirection": self.buffer_bytes,
                    "backpressure": self.backpressure, "listenBacklog": self.listen_backlog,
                    "idleSeconds": self.idle_seconds, "lifetimeSeconds": self.lifetime_seconds,
                    "totalByteLimit": self.byte_limit, "connectionByteLimit": self.connection_byte_limit}

    def close(self, timeout=5):
        self._stop.set()
        if self._listener is not None:
            self._listener.close()
        with self._lock:
            streams = list(self._sockets)
        for stream in streams:
            try:
                stream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            stream.close()
        deadline = time.monotonic() + timeout
        if self._accept_thread is not None:
            self._accept_thread.join(max(0, deadline - time.monotonic()))
        while True:
            with self._lock:
                workers = list(self._workers)
            if not workers or time.monotonic() >= deadline:
                break
            for worker in workers:
                worker.join(max(0, deadline - time.monotonic()))
        with self._lock:
            unfinished = bool(self._workers or self._sockets)
        if unfinished or (self._accept_thread is not None and self._accept_thread.is_alive()):
            raise ForwarderError("Owned loopback forwarder did not finish bounded cleanup")

    def __enter__(self):
        return self.start()

    def __exit__(self, *arguments):
        self.close()


def owned_bridge_forwarder(docker, *, owner_label: str, owner: str, network_name: str,
                           container_name: str, port: int, inspection_timeout: float = 2, **limits) -> LoopbackForwarder:
    """Create a relay whose fixed private destination is reverified before every open."""
    if type(inspection_timeout) not in (int, float) or not 0 < inspection_timeout <= 10 or not math.isfinite(inspection_timeout):
        raise ForwarderError("Fresh ownership inspection timeout must be finite and at most ten seconds")

    def inspect():
        return bridge_target(
            docker.json(["network", "inspect", network_name], timeout=inspection_timeout),
            docker.json(["container", "inspect", container_name], timeout=inspection_timeout),
            owner_label=owner_label, owner=owner, network_name=network_name,
            container_name=container_name, port=port,
        )
    initial = inspect()

    def verify():
        if inspect() != initial:
            raise ForwarderError("Owned fixture endpoint changed before opening the relay target")

    forwarder = LoopbackForwarder(initial.address, initial.port, before_connect=verify, **limits)
    forwarder.target_metadata = initial.metadata
    return forwarder
