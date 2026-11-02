import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createSecureContext } from "node:tls";
import { err, ok, type Result } from "@/types/result";
import {
  type ApprovedEndpoint,
  type ConnectionEndpointInput,
  type ConnectionEndpointPolicy,
  connectionEndpointSchema,
  type EndpointDnsAddress,
  type EndpointPolicyError,
  type EndpointResolver,
  type InternalConnectionEndpoint,
} from "./connectionEndpoint";
import { canonicalEndpointAddress, classifyEndpointAddress } from "./endpointPolicyAddress";
import {
  canonicalEndpointHost,
  isLocalEndpointHostname,
  isMetadataHostname,
} from "./endpointPolicyHost";

const MAX_DNS_ANSWERS = 64;
const MAX_CA_LENGTH = 65_536;

async function systemResolver(
  hostname: string,
  signal: AbortSignal,
): Promise<EndpointDnsAddress[]> {
  signal.throwIfAborted();
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  return addresses.filter((row): row is EndpointDnsAddress => row.family === 4 || row.family === 6);
}

async function abortableResolve(
  hostname: string,
  resolver: EndpointResolver,
  signal: AbortSignal,
): Promise<readonly EndpointDnsAddress[]> {
  signal.throwIfAborted();
  let removeAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      try {
        signal.throwIfAborted();
      } catch (error) {
        reject(
          error instanceof Error ? error : new DOMException("Operation aborted", "AbortError"),
        );
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([resolver(hostname, signal), aborted]);
  } finally {
    removeAbort();
  }
}

function certificateValid(grant: InternalConnectionEndpoint | undefined): boolean {
  if (grant?.ca === undefined) return true;
  if (grant.ca.length === 0 || grant.ca.length > MAX_CA_LENGTH) return false;
  try {
    createSecureContext({ ca: grant.ca });
    return true;
  } catch {
    return false;
  }
}

function addressAllowed(
  row: EndpointDnsAddress,
  grant: InternalConnectionEndpoint | undefined,
): boolean {
  const address = canonicalEndpointAddress(row.address);
  if (address === null || isIP(address) !== row.family) return false;
  if (
    grant?.allowedAddresses !== undefined &&
    !grant.allowedAddresses.some((allowed) => canonicalEndpointAddress(allowed) === address)
  )
    return false;
  const category = classifyEndpointAddress(address);
  if (category === "public") return true;
  if (category === "private") return grant !== undefined;
  return category === "loopback" && grant?.allowLoopback === true;
}

function approvedEndpoint(
  endpoint: ConnectionEndpointInput,
  hostname: string,
  first: EndpointDnsAddress,
  grant: InternalConnectionEndpoint | undefined,
): ApprovedEndpoint {
  return Object.freeze({
    protocol: endpoint.protocol,
    hostname,
    address: canonicalEndpointAddress(first.address) ?? first.address,
    family: first.family,
    port: endpoint.port,
    tls: Object.freeze({
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(grant?.ca === undefined ? {} : { ca: grant.ca }),
    }),
  });
}

export async function resolveConnectionEndpoint(
  input: ConnectionEndpointInput,
  policy: ConnectionEndpointPolicy,
  signal: AbortSignal,
  resolver: EndpointResolver = systemResolver,
): Promise<Result<ApprovedEndpoint, EndpointPolicyError>> {
  signal.throwIfAborted();
  const parsed = connectionEndpointSchema.safeParse(input);
  if (!parsed.success) return err({ code: "invalid_endpoint" });
  const endpoint = parsed.data;
  const hostname = canonicalEndpointHost(endpoint.host);
  if (hostname === null) return err({ code: "invalid_endpoint" });
  if (isMetadataHostname(hostname)) return err({ code: "blocked_hostname" });
  const grants = policy.internalEndpoints.filter(
    (entry) =>
      entry.protocol === endpoint.protocol &&
      entry.port === endpoint.port &&
      canonicalEndpointHost(entry.host) === hostname,
  );
  if (grants.length > 1) return err({ code: "invalid_policy" });
  const grant = grants[0];
  if (!certificateValid(grant)) return err({ code: "invalid_policy" });
  if (isLocalEndpointHostname(hostname) && grant === undefined)
    return err({ code: "blocked_hostname" });
  let addresses: readonly EndpointDnsAddress[];
  const family = isIP(hostname);
  try {
    addresses =
      family === 4 || family === 6
        ? [{ address: hostname, family }]
        : await abortableResolve(hostname, resolver, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err({ code: "dns_failed" });
  }
  signal.throwIfAborted();
  if (addresses.length === 0 || addresses.length > MAX_DNS_ANSWERS)
    return err({ code: "dns_failed" });
  if (!addresses.every((row) => addressAllowed(row, grant)))
    return err({ code: "blocked_address" });
  const first = addresses[0];
  return first === undefined
    ? err({ code: "dns_failed" })
    : ok(approvedEndpoint(endpoint, hostname, first, grant));
}
