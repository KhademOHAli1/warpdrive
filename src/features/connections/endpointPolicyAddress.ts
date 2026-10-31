import { isIP } from "node:net";

export type EndpointAddressClass = "public" | "private" | "loopback" | "blocked";

const IPV4_BLOCKED_RANGES: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];

function ipv4Number(value: string): number {
  return value.split(".").reduce((result, octet) => result * 256 + Number(octet), 0);
}

function ipv4Class(value: string): EndpointAddressClass {
  const [first = 0, second = 0] = value.split(".").map(Number);
  if (first === 127) return "loopback";
  if (first === 10 || (first === 172 && second >= 16 && second <= 31)) return "private";
  if (first === 192 && second === 168) return "private";
  const number = ipv4Number(value);
  const blocked = IPV4_BLOCKED_RANGES.some(([network, prefix]) => {
    const width = 2 ** (32 - prefix);
    return Math.floor(number / width) === Math.floor(ipv4Number(network) / width);
  });
  return blocked ? "blocked" : "public";
}

function ipv6Words(value: string): number[] {
  const canonical = new URL(`https://[${value}]/`).hostname.slice(1, -1);
  const [left = "", right] = canonical.split("::");
  const start = left.length === 0 ? [] : left.split(":").map((word) => Number.parseInt(word, 16));
  if (right === undefined) return start;
  const end = right.length === 0 ? [] : right.split(":").map((word) => Number.parseInt(word, 16));
  return [...start, ...Array<number>(8 - start.length - end.length).fill(0), ...end];
}

const IPV6_CLOUD_SERVICE_PREFIXES = [
  [0xfd00, 0x0ec2],
  [0xfd20, 0x00ce],
] as const;

function ipv6Class(value: string): EndpointAddressClass {
  const words = ipv6Words(value);
  const first = words[0] ?? 0;
  const second = words[1] ?? 0;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return "loopback";
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return ipv4Class(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  // Cloud metadata/credential services also use ULA. An internal allowlist must
  // never make those services eligible as a credential-bearing endpoint.
  if (IPV6_CLOUD_SERVICE_PREFIXES.some(([high, low]) => first === high && second === low))
    return "blocked";
  if ((first & 0xfe00) === 0xfc00) return "private";
  // Only currently assigned global-unicast space is eligible. Transition tunnels,
  // protocol assignments and documentation ranges cannot serve mail endpoints.
  if ((first & 0xe000) !== 0x2000) return "blocked";
  if (first === 0x2001 && (second & 0xfe00) === 0) return "blocked";
  if (first === 0x2001 && second === 0x0db8) return "blocked";
  if (first === 0x2002 || first === 0x3ffe) return "blocked";
  if (first === 0x3fff && second <= 0x0fff) return "blocked";
  return "public";
}

export function classifyEndpointAddress(value: string): EndpointAddressClass {
  if (value.includes("%")) return "blocked";
  const family = isIP(value);
  if (family === 4) return ipv4Class(value);
  return family === 6 ? ipv6Class(value) : "blocked";
}

export function canonicalEndpointAddress(value: string): string | null {
  if (value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  return family === 6 ? new URL(`https://[${value}]/`).hostname.slice(1, -1) : null;
}
