import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as liveness } from "../health/route";
import { GET } from "./route";

const privateOrigin = "http://private-core.example.invalid:3010";
const publicOrigin = "https://app.example.invalid";
const proxyToken = "private-proxy-token-for-test-only";
const fetchCore = vi.fn<typeof fetch>();

const wire = (config: Record<string, unknown> = {}) => ({
  result: { data: { json: { BASE_URL: `${publicOrigin}/`, MCP_ENABLED: false, ...config } } },
});

async function expectReadiness(code: string, status = 503) {
  const response = await GET();
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-warpdrive-runtime-code")).toBe(code);
  expect(await response.json()).toEqual({ ok: status === 200, code });
}

beforeEach(() => {
  vi.stubEnv("CORE_API_ORIGIN", privateOrigin);
  vi.stubEnv("CORE_PROXY_TOKEN", proxyToken);
  vi.stubEnv("WEB_PUBLIC_ORIGIN", publicOrigin);
  vi.stubEnv("FRONTEND_TRUSTED_PROXY_HEADER", "none");
  vi.stubGlobal("fetch", fetchCore);
});

afterEach(() => {
  fetchCore.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Web to Core readiness", () => {
  it("checks the fixed private procedure without returning configuration or browser facts", async () => {
    fetchCore.mockResolvedValueOnce(Response.json(wire({ EXTRA_PRESENTATION_FLAG: true })));
    await expectReadiness("WEB_READY", 200);
    expect(fetchCore).toHaveBeenCalledExactlyOnceWith(
      `${privateOrigin}/api/trpc/frontend.configuration`,
      {
        cache: "no-store",
        headers: { accept: "application/json", "x-warpdrive-proxy-token": proxyToken },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each([
    ["CORE_API_ORIGIN", ""],
    ["CORE_API_ORIGIN", publicOrigin],
    ["CORE_API_ORIGIN", "https://wrong.example.invalid/path"],
    ["CORE_API_ORIGIN", "https://wrong.example.invalid/#"],
    ["CORE_PROXY_TOKEN", "too-short"],
    ["WEB_PUBLIC_ORIGIN", "https://wrong.example.invalid/?q=unexpected"],
    ["FRONTEND_TRUSTED_PROXY_HEADER", "x-untrusted"],
  ])(
    "refuses invalid %s while liveness and the private Core request stay independent",
    async (name, value) => {
      vi.stubEnv(name, value);
      expect(liveness().status).toBe(200);
      await expectReadiness("WEB_READINESS_CONFIGURATION_INVALID");
      expect(fetchCore).not.toHaveBeenCalled();
    },
  );

  it("rejects a different canonical Core public origin if configured", async () => {
    const otherProtocol = publicOrigin.replace("https:", "http:");
    fetchCore.mockResolvedValueOnce(Response.json(wire({ BASE_URL: otherProtocol })));
    await expectReadiness("WEB_READINESS_ORIGIN_MISMATCH");
    vi.stubEnv("WEB_PUBLIC_ORIGIN", "");
    fetchCore.mockResolvedValueOnce(Response.json(wire({ BASE_URL: otherProtocol })));
    await expectReadiness("WEB_READY", 200);
  });

  it.each([
    [401, "WEB_READINESS_CORE_UNAUTHORIZED"],
    [403, "WEB_READINESS_CORE_UNAUTHORIZED"],
    [302, "WEB_READINESS_CORE_INCOMPATIBLE"],
    [404, "WEB_READINESS_CORE_INCOMPATIBLE"],
    [429, "WEB_READINESS_CORE_UNAVAILABLE"],
    [503, "WEB_READINESS_CORE_UNAVAILABLE"],
  ])("returns a fixed code for an upstream %s", async (status, code) => {
    fetchCore.mockResolvedValueOnce(new Response("private detail", { status }));
    await expectReadiness(code);
    expect(fetchCore).toHaveBeenCalledTimes(1);
  });

  it("refuses a success status with an incompatible, malformed or oversized response", async () => {
    for (const body of [
      Response.json({ ok: true }),
      Response.json(wire({ BASE_URL: `${publicOrigin}/unexpected-path` })),
      Response.json(wire({ MCP_ENABLED: "false" })),
      Response.json(wire({ extra: "x".repeat(8_192) })),
      new Response("{invalid", { headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify(wire()), { headers: { "content-type": "text/plain" } }),
    ]) {
      fetchCore.mockResolvedValueOnce(body);
      await expectReadiness("WEB_READINESS_CORE_INCOMPATIBLE");
    }
  });

  it("does not expose an upstream transport error", async () => {
    fetchCore.mockRejectedValueOnce(
      new Error(`cannot contact ${privateOrigin} using ${proxyToken}`),
    );
    await expectReadiness("WEB_READINESS_CORE_UNAVAILABLE");
  });

  it("returns before an unresponsive upstream and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    fetchCore.mockImplementationOnce((_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const pending = expectReadiness("WEB_READINESS_CORE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(signal?.aborted).toBe(true);
  });

  it("applies the same deadline to a stalled response body", async () => {
    vi.useFakeTimers();
    const aborted = vi.fn();
    fetchCore.mockImplementationOnce((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode("{"));
          init?.signal?.addEventListener("abort", () => {
            aborted();
            stream.error(new Error("private detail"));
          });
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "application/json" } }),
      );
    });
    const pending = expectReadiness("WEB_READINESS_CORE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(aborted).toHaveBeenCalledOnce();
  });
});
