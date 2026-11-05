import { describe, expect, it, vi } from "vitest";
import { ok } from "@/types/result";
import { safeWorkflowHttpRequest, type WorkflowHttpDependencies } from "./httpTransport";

const signal = () => new AbortController().signal;
describe("workflow HTTP transport", () => {
  it("pins the approved address, preserves TLS identity and does not follow a redirect", async () => {
    const transport = vi.fn<NonNullable<WorkflowHttpDependencies["transport"]>>(() =>
      Promise.resolve(
        ok({
          status: 302,
          headers: { location: "https://127.0.0.1/private", "set-cookie": ["secret"] },
          text: "redirect",
        }),
      ),
    );
    const result = await safeWorkflowHttpRequest(
      { url: "https://api.example.com/v1?q=1", method: "GET" },
      signal(),
      { resolver: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]), transport },
    );
    expect(result).toEqual({
      ok: true,
      value: { status: 302, headers: { location: "https://127.0.0.1/private" }, body: "redirect" },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      endpoint: {
        address: "93.184.216.34",
        tls: { servername: "api.example.com", rejectUnauthorized: true },
      },
      host: "api.example.com",
      path: "/v1?q=1",
    });
  });
  it("rejects private/rebinding DNS, embedded credentials and forbidden headers before transport", async () => {
    const transport = vi.fn();
    for (const input of [
      { url: "https://api.example.com", method: "GET" },
      { url: "https://user:secret@api.example.com", method: "GET" },
      { url: "https://api.example.com", method: "GET", headers: { Host: "127.0.0.1" } },
    ]) {
      const result = await safeWorkflowHttpRequest(input, signal(), {
        resolver: () =>
          Promise.resolve([
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]),
        transport,
      });
      expect(result.ok).toBe(false);
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains unknown outcome after a response violates its declared schema", async () => {
    const result = await safeWorkflowHttpRequest(
      {
        url: "https://api.example.com",
        method: "POST",
        body: { action: "apply" },
        responseSchema: {
          type: "object",
          properties: { accepted: { type: "boolean" } },
          required: ["accepted"],
        },
      },
      signal(),
      {
        resolver: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
        transport: () =>
          Promise.resolve(ok({ status: 200, headers: {}, text: '{"accepted":"not a boolean"}' })),
      },
    );
    expect(result).toEqual({
      ok: false,
      error: { id: "E_WORKFLOW_BLOCK_OUTPUT", outcome: "unknown" },
    });
  });
});
