"""Correlate credential-free requests with the exact Traefik egress using kernel BPF."""
from __future__ import annotations

from http.client import HTTPSConnection
from ipaddress import IPv4Address
import os
from pathlib import Path
import re
import secrets
import selectors
import ssl
import subprocess
import time

from installed_web_probe import RouteHints


PROBES = (("GET", "/api/runtime/web-identity"), ("POST", "/board"), ("GET", "/_ws"))
ID = re.compile(r"[a-f0-9]{64}\Z")
EDGE_PROCESS = re.compile(rb"[0-9]+ \(traefik\) .+")
NETWORK = re.compile(r"[a-z0-9][a-z0-9.-]{0,62}\Z")


class LiveHopError(RuntimeError):
    """The exact request could not be tied to one independently observed egress."""


def require(condition, message):
    if not condition:
        raise LiveHopError(message)


def request_path(path, nonce):
    require(re.fullmatch(r"[a-f0-9]{24}", nonce), "Exact safe probe nonce required")
    return f"{path}?wd_route_probe={nonce}"


def namespace_witness(pid):
    require(type(pid) is int and pid > 1, "Exact native edge PID required")
    proc = Path(f"/proc/{pid}")
    raw = (proc / "stat").read_bytes()
    require(len(raw) < 8192 and EDGE_PROCESS.fullmatch(raw.rstrip(b"\n")), "Installed Traefik process differs")
    fields = raw.rpartition(b") ")[2].split()
    require(len(fields) > 19 and fields[19].isdigit() and fields[0] not in (b"Z", b"X"),
            "Installed Traefik generation unavailable")
    info = (proc / "ns/net").stat()
    return (info.st_dev, info.st_ino, int(fields[19]))


def _address(value):
    address = IPv4Address(value)
    require(address.is_private and not address.is_loopback, "Exact private edge or peer address required")
    return str(address)


def _consume_prefix(value):
    for size in (4, 2, 1):
        if len(value) >= size:
            return value[:size], value[size:]
    raise LiveHopError("Empty packet filter term")


def packet_filter(source_ip, destinations, method, path, nonce):
    """Compile a kernel-only filter. No packet payload is copied out of tcpdump."""
    require((method, path) in PROBES and 1 <= len(destinations) <= 3, "Exact anonymous egress probe required")
    source_ip = _address(source_ip)
    ips = [_address(address) for address in destinations]
    require(len(set(ips)) == len(ips) and source_ip not in ips, "Distinct private egress addresses required")
    first_line = f"{method} {request_path(path, nonce)} HTTP/1.1\r\n".encode("ascii")
    # TCP header length is variable. These predicates compare the complete fixed
    # request line, including the fresh 96-bit nonce, before userspace observes a packet.
    tests = []
    offset = 0
    while first_line:
        chunk, first_line = _consume_prefix(first_line)
        value = int.from_bytes(chunk, "big")
        tests.append(f"tcp[((tcp[12] & 0xf0) >> 2) + {offset}:{len(chunk)}] = {value}")
        offset += len(chunk)
    peers = " or ".join(f"dst host {address}" for address in ips)
    return f"ip and tcp and src host {source_ip} and ({peers}) and dst port 8080 and " + " and ".join(tests)


def _line(stream, deadline):
    remaining = deadline - time.monotonic()
    with selectors.DefaultSelector() as ready:
        ready.register(stream, selectors.EVENT_READ)
        if remaining <= 0 or not ready.select(remaining):
            raise LiveHopError("Timed out waiting for bounded edge observation")
    raw = stream.readline(1025)
    require(0 < len(raw) <= 1024, "Incomplete edge observation")
    return raw


def _probe_https(host, method, path):
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    conn = HTTPSConnection(host, timeout=4, context=context)
    headers = {"Accept-Encoding": "identity", "Connection": "close", "Cache-Control": "no-store"}
    if method == "POST":
        # Existing Caddy policy rejects unstamped actions before forwarding.
        headers |= {"Next-Action": secrets.token_hex(21), "Content-Length": "0"}
    if path.startswith("/_ws?"):
        headers |= {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
                    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Origin": f"https://{host}"}
    try:
        conn.request(method, path, body=b"" if method == "POST" else None, headers=headers)
        with conn.getresponse() as response:
            return response.status
    finally:
        conn.close()


def observe_hop(*, host, edge_pid, edge_ip, destinations, method, path, request=_probe_https):
    """Observe one edge request with an in-kernel first-line filter and no capture file."""
    require(os.geteuid() == 0 and NETWORK.fullmatch(host), "Exact installed host observation required")
    nonce = secrets.token_hex(12)
    filter_text = packet_filter(edge_ip, destinations, method, path, nonce)
    before = namespace_witness(edge_pid)
    fd = os.open(f"/proc/{edge_pid}/ns/net", os.O_RDONLY)
    try:
        ns = os.fstat(fd)
        require((ns.st_dev, ns.st_ino) == before[:2], "Pinned Traefik network namespace changed")
        # Standard tcpdump output is TCP metadata only. No -w, -A, -X or payload logs.
        command = ["/usr/bin/nsenter", f"--net=/proc/self/fd/{fd}", "/usr/bin/tcpdump",
                   "-i", "any", "-p", "-n", "-q", "-l", "-c", "1", "-s", "192", filter_text]
        with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              pass_fds=(fd,), env={"PATH": "/usr/bin:/bin"}, bufsize=0) as capture:
            try:
                end = time.monotonic() + 5
                for _ in range(3):
                    line = _line(capture.stderr, end)
                    if b"listening on any" in line:
                        break
                    if b"failed" in line or b"syntax error" in line:
                        raise LiveHopError("Installed namespace or packet filter refused the probe")
                else:
                    raise LiveHopError("Edge packet filter did not start")
                # An independently correlated hop is useful even when that
                # upstream returns an error. The separate public probe checks health.
                request(host, method, request_path(path, nonce))
                raw = _line(capture.stdout, time.monotonic() + 3)
                match = re.search(rb" > ((?:[0-9]{1,3}\.){3}[0-9]{1,3})\.8080:", raw)
                require(match is not None and match[1].decode() in destinations,
                        "The correlated packet did not reach an admitted peer")
                peer = match[1].decode()
            finally:
                if capture.poll() is None:
                    capture.terminate()
                    try:
                        capture.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        capture.kill()
                        capture.wait(timeout=2)
        require(namespace_witness(edge_pid) == before, "Traefik changed during the correlated request")
        return destinations[peer]
    finally:
        os.close(fd)


def observe_route_hints(*, host, edge_id, edge_pid, edge_ip, web_peers, realtime_peers):
    require(ID.fullmatch(edge_id), "Exact Traefik runtime identity required")
    safe = observe_hop(host=host, edge_pid=edge_pid, edge_ip=edge_ip, destinations=web_peers,
                       method="GET", path="/api/runtime/web-identity")
    unsafe = observe_hop(host=host, edge_pid=edge_pid, edge_ip=edge_ip, destinations=web_peers,
                         method="POST", path="/board")
    realtime = observe_hop(host=host, edge_pid=edge_pid, edge_ip=edge_ip, destinations=realtime_peers,
                           method="GET", path="/_ws")
    return RouteHints(edge_id, safe, unsafe, realtime)
