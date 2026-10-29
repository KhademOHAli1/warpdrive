import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { parseEnv } from "@/config/env";
import { startWsServer, type WsServerDeps } from "./server";

// The listener can be exercised without accepting a socket or touching the database.
const unusedDeps = {} as WsServerDeps;
const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  GOOGLE_OAUTH_CLIENT_ID: "test-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
  GOOGLE_WORKSPACE_DOMAIN: "example.com",
  BASE_URL: "https://app.example.com",
  DATABASE_URL: "postgres://placeholder:placeholder@localhost:5432/placeholder",
  WS_TICKET_SECRET: "test-ws-ticket-secret-at-least-32-bytes-long!!",
  WS_PUBLIC_URL: "wss://app.example.com/ws",
  MINIO_ENDPOINT: "https://s3.example.com",
  MINIO_ACCESS_KEY: "test-access",
  MINIO_SECRET_KEY: "test-secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  MCP_ENABLED: "false",
};

describe("WebSocket listener address", () => {
  test("binds to the requested loopback address", async () => {
    const server = startWsServer(0, unusedDeps, "127.0.0.1");
    try {
      await once(server, "listening");
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("retains the platform wildcard address when no host is specified", async () => {
    const server = startWsServer(0, unusedDeps);
    try {
      await once(server, "listening");
      expect(["0.0.0.0", "::"]).toContain((server.address() as AddressInfo).address);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("WebSocket host configuration", () => {
  test("accepts an explicit loopback bind and preserves an unset default", () => {
    const loopback = parseEnv({ ...validEnv, WS_HOST: "127.0.0.1" });
    const unset = parseEnv({ ...validEnv, WS_HOST: undefined });
    expect(loopback.ok && loopback.value.WS_HOST).toBe("127.0.0.1");
    expect(unset.ok && unset.value.WS_HOST).toBeUndefined();
  });

  test("rejects an empty configured host", () => {
    expect(parseEnv({ ...validEnv, WS_HOST: "" }).ok).toBe(false);
  });
});
