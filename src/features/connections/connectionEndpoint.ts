import { z } from "zod";

export const CONNECTION_ENDPOINT_PROTOCOLS = [
  "imaps",
  "imap+starttls",
  "smtps",
  "smtp+starttls",
  "https",
  "wss",
  "ami+tls",
] as const;

export const connectionEndpointSchema = z.object({
  protocol: z.enum(CONNECTION_ENDPOINT_PROTOCOLS),
  host: z.string().min(1).max(1024),
  port: z.number().int().min(1).max(65535),
});

export type ConnectionEndpointInput = z.infer<typeof connectionEndpointSchema>;
export type ConnectionEndpointProtocol = ConnectionEndpointInput["protocol"];

// This is operator-managed configuration, never part of a user's connection payload.
export interface InternalConnectionEndpoint extends ConnectionEndpointInput {
  readonly allowedAddresses?: readonly string[];
  readonly allowLoopback?: boolean;
  readonly ca?: string;
}

export interface ConnectionEndpointPolicy {
  readonly internalEndpoints: readonly InternalConnectionEndpoint[];
}

export interface EndpointDnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type EndpointResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly EndpointDnsAddress[]>;

export interface ApprovedEndpoint extends EndpointDnsAddress {
  readonly protocol: ConnectionEndpointProtocol;
  readonly hostname: string;
  readonly port: number;
  readonly tls: {
    readonly servername?: string;
    readonly rejectUnauthorized: true;
    readonly minVersion: "TLSv1.2";
    readonly ca?: string;
  };
}

export interface EndpointPolicyError {
  readonly code:
    | "invalid_endpoint"
    | "blocked_hostname"
    | "dns_failed"
    | "blocked_address"
    | "invalid_policy";
}
