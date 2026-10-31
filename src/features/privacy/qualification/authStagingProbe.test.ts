import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { RequestListener } from "node:http";
import { createServer, type Server } from "node:https";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { probeAuthStagingHttps } from "./authStagingProbe";

const run = promisify(execFile);
const revision = "a".repeat(40);
let directory: string;
let credentials: { key: Buffer; cert: Buffer; ca: Buffer };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "warpdrive-staging-tls-"));
  const signal = AbortSignal.timeout(10000);
  const command = (args: string[]) =>
    run("openssl", args, { cwd: directory, signal, timeout: 10000 });
  await command([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    "root.key",
    "-out",
    "root.crt",
    "-subj",
    "/CN=Warpdrive synthetic staging root",
  ]);
  await command([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  await writeFile(
    join(directory, "server.ext"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
    { mode: 0o600, signal },
  );
  await command([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "root.crt",
    "-CAkey",
    "root.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "1",
    "-extfile",
    "server.ext",
  ]);
  credentials = {
    key: await readFile(join(directory, "server.key")),
    cert: await readFile(join(directory, "server.crt")),
    ca: await readFile(join(directory, "root.crt")),
  };
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function withServer(
  listener: RequestListener,
  fn: (origin: string, server: Server) => Promise<void>,
) {
  const sockets = new Set<Socket>();
  const server = createServer(credentials, listener);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new TypeError("Synthetic TLS fixture did not listen");
  try {
    await fn(`https://127.0.0.1:${address.port}`, server);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
function config(origin: string) {
  return {
    environment: "synthetic",
    origin,
    revision,
    probeAuthorization: {
      id: randomUUID(),
      origin,
      revision,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
}
const normal: RequestListener = (request, response) => {
  const locale = request.headers.cookie?.match(/warpdrive_locale=(en|fa|de)/)?.[1] ?? "en";
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    `<html lang="${locale}" dir="${locale === "fa" ? "rtl" : "ltr"}"><body>synthetic login</body></html>`,
  );
};

test("P29B: missing or stale explicit probe authorization causes no request", async () => {
  let requests = 0;
  await withServer(
    (request, response) => {
      requests++;
      normal(request, response);
    },
    async (origin) => {
      for (const input of [
        { ...config(origin), probeAuthorization: null },
        {
          ...config(origin),
          probeAuthorization: { ...config(origin).probeAuthorization, revision: "b".repeat(40) },
        },
      ]) {
        const result = await probeAuthStagingHttps(input, AbortSignal.timeout(1000), {
          ca: credentials.ca,
        });
        expect(result).toMatchObject({ ok: false, error: { code: "probe_not_authorized" } });
      }
      expect(requests).toBe(0);
    },
  );
});

test("P29A: actual trusted local TLS observations preserve locale direction and remain synthetic", async () => {
  await withServer(normal, async (origin) => {
    const result = await probeAuthStagingHttps(config(origin), AbortSignal.timeout(3000), {
      ca: credentials.ca,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      evidenceLevel: "synthetic",
      accepted: false,
      revisionVerified: false,
    });
    expect(Date.parse(result.value.observedAt)).not.toBeNaN();
    expect(result.value.command).toBe("privacy-staging-auth:anonymous_https_login");
    expect(
      result.value.checks.map((check) => [check.locale, check.language, check.direction]),
    ).toEqual([
      ["en", "en", "ltr"],
      ["fa", "fa", "rtl"],
      ["de", "de", "ltr"],
    ]);
    expect(
      result.value.checks.every(
        (check) => check.httpsVerified && /^[a-f0-9]{64}$/.test(check.htmlSha256),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic login");
  });
});

test("P29B: untrusted certificates fail closed without any certificate-verification bypass", async () => {
  await withServer(normal, async (origin) => {
    expect(await probeAuthStagingHttps(config(origin), AbortSignal.timeout(3000))).toMatchObject({
      ok: false,
      error: { code: "tls_or_network_failed" },
    });
  });
});

test("P29B/C10: redirects are not followed and oversized response content is not retained", async () => {
  for (const mode of ["redirect", "oversized"] as const) {
    let requests = 0;
    await withServer(
      (_request, response) => {
        requests++;
        if (mode === "redirect") {
          response.writeHead(302, { location: "https://PRIVATE-SENTINEL.example.invalid/" });
          response.end();
        } else {
          response.writeHead(200, { "content-type": "text/html" });
          response.end("PRIVATE-SENTINEL".repeat(40000));
        }
      },
      async (origin) => {
        const result = await probeAuthStagingHttps(config(origin), AbortSignal.timeout(3000), {
          ca: credentials.ca,
        });
        expect(result).toMatchObject({
          ok: false,
          error: { code: mode === "redirect" ? "unexpected_response" : "response_limit_exceeded" },
        });
        expect(requests).toBe(1);
        expect(JSON.stringify(result)).not.toContain("PRIVATE-SENTINEL");
      },
    );
  }
});

test("C06: cancellation destroys a pending TLS request rather than fabricating an observation", async () => {
  const controller = new AbortController();
  await withServer(
    () => controller.abort(),
    async (origin) => {
      await expect(
        probeAuthStagingHttps(config(origin), controller.signal, { ca: credentials.ca }),
      ).rejects.toMatchObject({ name: "AbortError" });
    },
  );
});

test("C03: authorization expiry between locale probes prevents the next request", async () => {
  const started = Date.now();
  let clock = started;
  let requests = 0;
  await withServer(
    (request, response) => {
      requests++;
      normal(request, response);
      clock = started + 2000;
    },
    async (origin) => {
      const input = config(origin);
      input.probeAuthorization.expiresAt = new Date(started + 1000).toISOString();
      const result = await probeAuthStagingHttps(
        input,
        AbortSignal.timeout(3000),
        { ca: credentials.ca },
        () => new Date(clock),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "probe_not_authorized", locale: "fa" },
      });
      expect(requests).toBe(1);
    },
  );
});

test("C06: trickled HTTPS content cannot extend the five-second probe deadline", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.write('<html lang="en" dir="ltr">');
      const timer = setInterval(() => response.write(" "), 100);
      response.once("close", () => clearInterval(timer));
    },
    async (origin) => {
      const started = Date.now();
      await expect(
        probeAuthStagingHttps(config(origin), AbortSignal.timeout(8000), { ca: credentials.ca }),
      ).resolves.toMatchObject({ ok: false, error: { code: "probe_timeout" } });
      expect(Date.now() - started).toBeLessThan(7000);
    },
  );
});
