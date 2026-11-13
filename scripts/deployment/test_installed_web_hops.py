"""Keep the native egress observer scoped to one exact credential-free request line."""
from unittest import TestCase

from installed_web_hops import LiveHopError, packet_filter, request_path


class InstalledWebHopsTests(TestCase):
    def test_kernel_filter_covers_the_whole_http_first_line(self):
        nonce = "12" * 12
        path = "/api/runtime/web-identity"
        raw = f"GET {request_path(path, nonce)} HTTP/1.1\r\n".encode()
        value = packet_filter("10.0.8.2", {"10.0.8.4": "old", "10.0.8.5": "new"}, "GET", path, nonce)
        self.assertTrue(value.startswith("ip and tcp and src host 10.0.8.2 and (dst host 10.0.8.4 or dst host 10.0.8.5) and dst port 8080 and "))
        matches = value.split(" and ")[5:]
        cursor = 0
        for comparison in matches:
            offset, tail = comparison.split(" + ", 1)[1].split(":", 1)
            size, number = tail.split("] = ", 1)
            self.assertEqual(int(offset), cursor)
            self.assertEqual(int(number).to_bytes(int(size), "big"), raw[cursor:cursor + int(size)])
            cursor += int(size)
        self.assertEqual(cursor, len(raw))

    def test_unknown_host_route_and_nonce_refuse(self):
        for source, peers, method, path, nonce in (
            ("8.8.8.8", {"10.0.8.4": "old"}, "GET", "/_ws", "a" * 24),
            ("10.0.8.4", {"10.0.8.4": "old"}, "GET", "/_ws", "a" * 24),
            ("10.0.8.2", {"10.0.8.4": "old"}, "POST", "/api/runtime/web-identity", "a" * 24),
            ("10.0.8.2", {"10.0.8.4": "old"}, "POST", "/board", "a" * 23),
        ):
            with self.subTest(path=path, source=source, nonce=nonce), self.assertRaises(LiveHopError):
                packet_filter(source, peers, method, path, nonce)
