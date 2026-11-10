import { afterEach, describe, expect, it, vi } from "vitest";
import { ListmonkClient } from "./listmonkClient";

function client(): ListmonkClient {
  return new ListmonkClient(
    "http://127.0.0.1:9000",
    "campaign-engine",
    "local-test-credential",
    AbortSignal.timeout(1000),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Listmonk server boundary", () => {
  it("keeps the engine credential scoped to the fixed origin and rejects cross-origin paths", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ data: { total: 1 } })),
    );
    vi.stubGlobal("fetch", request);
    const engine = client();

    await expect(
      engine.json("GET", "/api/campaigns", { query: new URLSearchParams({ page: "1" }) }),
    ).resolves.toEqual({ total: 1 });
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : url).toBe("http://127.0.0.1:9000/api/campaigns?page=1");
    expect(options?.redirect).toBe("error");
    expect(options?.cache).toBe("no-store");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("campaign-engine:local-test-credential").toString("base64")}`,
    );

    await expect(engine.json("GET", "//other.example.test/api/campaigns")).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("treats a failed write as uncertain without leaking or retrying the upstream response", async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ message: "provider details and private inputs" }, { status: 502 }),
      ),
    );
    vi.stubGlobal("fetch", request);

    await expect(
      client().json("POST", "/api/campaigns", { body: { name: "Draft" } }),
    ).rejects.toMatchObject({ uncertain: true, message: "Campaign service request failed" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
