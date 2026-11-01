import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer, type Server } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApprovedEndpoint } from "./connectionEndpoint";
import { resolveConnectionEndpoint } from "./endpointPolicy";

let server: Server;
let folder = "";
let certificate = "";
let port = 0;
const resolver = () => Promise.resolve([{ address: "127.0.0.1", family: 4 as const }]);

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "warpdrive-endpoint-tls-"));
  const keyPath = join(folder, "key.pem");
  const certPath = join(folder, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-subj",
      "/CN=mail.endpoint.test",
      "-addext",
      "subjectAltName=DNS:mail.endpoint.test",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  certificate = readFileSync(certPath, "utf8");
  server = createServer({ key: readFileSync(keyPath), cert: certificate }, (socket) => {
    socket.end("verified endpoint");
  });
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture listener");
  port = address.port;
});

afterAll(async () => {
  if (server !== undefined)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
});

function readTlsGreeting(endpoint: ApprovedEndpoint): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: endpoint.address,
      port: endpoint.port,
      ...endpoint.tls,
    });
    socket.setTimeout(5000, () => socket.destroy(new Error("Fixture TLS timeout")));
    socket.setEncoding("utf8");
    socket.once("data", (data: string) => {
      socket.end();
      resolve(data);
    });
    socket.once("error", reject);
  });
}

async function approve(hostname: string, ca?: string): Promise<ApprovedEndpoint> {
  const input = { protocol: "imaps" as const, host: hostname, port };
  const result = await resolveConnectionEndpoint(
    input,
    {
      internalEndpoints: [
        {
          ...input,
          allowLoopback: true,
          allowedAddresses: ["127.0.0.1"],
          ...(ca === undefined ? {} : { ca }),
        },
      ],
    },
    new AbortController().signal,
    resolver,
  );
  if (!result.ok) throw new Error(`Fixture approval failed: ${result.error.code}`);
  return result.value;
}

describe("actual TLS against a pinned controlled endpoint", () => {
  it("connects to the approved IP while verifying the original DNS name and operator CA", async () => {
    const endpoint = await approve("mail.endpoint.test", certificate);
    expect(endpoint.address).toBe("127.0.0.1");
    expect(endpoint.tls.servername).toBe("mail.endpoint.test");
    await expect(readTlsGreeting(endpoint)).resolves.toBe("verified endpoint");
  });

  it("rejects the pinned server when its certificate does not match the original DNS name", async () => {
    const endpoint = await approve("different.endpoint.test", certificate);
    await expect(readTlsGreeting(endpoint)).rejects.toBeInstanceOf(Error);
  });

  it("does not trust a self-signed server without the operator CA", async () => {
    const endpoint = await approve("mail.endpoint.test");
    await expect(readTlsGreeting(endpoint)).rejects.toBeInstanceOf(Error);
  });
});
