import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/types/result";
import { OPERATIONS_COLLECTOR_PATH } from "./collectorSignature";
import { listenOperationsCollector } from "./collectorSocket";

const dirs: string[] = [];
const servers: Awaited<ReturnType<typeof listenOperationsCollector>>[] = [];
const binding = {
  installationId: randomUUID(),
  sourceId: randomUUID(),
  generationId: randomUUID(),
};
const key = randomBytes(32);

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function privatePath() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "wd-ops-"));
  dirs.push(dir);
  return join(dir, "collector.sock");
}

function request(options?: { target?: string; extra?: string[]; length?: string }) {
  const body = '{"sequence":1}';
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", key)
    .update(
      [
        "warpdrive.operations.collector.v1",
        "POST",
        OPERATIONS_COLLECTOR_PATH,
        binding.installationId,
        binding.sourceId,
        binding.generationId,
        timestamp,
        body,
      ].join("\n"),
    )
    .digest("hex");
  return [
    `POST ${options?.target ?? OPERATIONS_COLLECTOR_PATH} HTTP/1.1`,
    "Host: warpdrive-operations.local",
    "Connection: close",
    "Content-Type: application/json",
    `Content-Length: ${options?.length ?? body.length}`,
    `X-Warpdrive-Collector-Source: ${binding.sourceId}`,
    `X-Warpdrive-Collector-Timestamp: ${timestamp}`,
    `X-Warpdrive-Collector-Signature: v1=${signature}`,
    ...(options?.extra ?? []),
    "",
    body,
  ].join("\r\n");
}

function exchange(path: string, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000, () => socket.destroy(new Error("Socket fixture timeout")));
    socket.once("connect", () => socket.write(raw));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function services() {
  return {
    lookupAuthority: () => ({
      installationId: binding.installationId,
      binding,
      signingKey: key.toString("base64url"),
    }),
    write: vi.fn(() =>
      Promise.resolve(
        ok({
          receiptId: randomUUID(),
          replayed: false,
          appliedObservations: 1,
          transitions: [],
          admissionState: "ready" as const,
        }),
      ),
    ),
  };
}

describe("Operations collector Unix socket", () => {
  it("serves an exact signed request on a private socket and drains it", async () => {
    const path = privatePath();
    const backend = services();
    const server = await listenOperationsCollector(path, backend);
    servers.push(server);
    expect(lstatSync(path).mode & 0o7777).toBe(0o600);
    expect(await exchange(path, request())).toMatch(/^HTTP\/1.1 204/u);
    expect(backend.write).toHaveBeenCalledExactlyOnceWith(
      binding,
      '{"sequence":1}',
      expect.any(AbortSignal),
    );
    await server.close();
    await expect(exchange(path, request())).rejects.toThrow();
  });

  it.each([
    { target: `${OPERATIONS_COLLECTOR_PATH}?` },
    { target: "/api/internal/operations/%6fbservations" },
    { target: "/api/internal/operations/./observations" },
    { extra: [`X-Warpdrive-Collector-Source: ${binding.sourceId}`] },
    { extra: ["Content-Type: application/json"] },
    { extra: ["Content-Length: 14"] },
    { extra: ["Transfer-Encoding: chunked"] },
    { extra: ["Trailer: X-Another"] },
    { extra: ["Expect: 100-continue"] },
    { extra: ["Authorization: anything"] },
    { length: "014" },
    { length: "70000" },
  ])("rejects altered target or framing without writing: %j", async (options) => {
    const path = privatePath();
    const backend = services();
    servers.push(await listenOperationsCollector(path, backend));
    const response = await exchange(path, request(options));
    expect(response).toMatch(/^HTTP\/1.1 (400|413|417)\b/u);
    expect(backend.write).not.toHaveBeenCalled();
  });

  it("refuses to replace an existing path", async () => {
    const path = privatePath();
    writeFileSync(path, "keep", { mode: 0o600 });
    await expect(listenOperationsCollector(path, services())).rejects.toThrow("already in use");
    expect(lstatSync(path).size).toBe(4);
  });
});
