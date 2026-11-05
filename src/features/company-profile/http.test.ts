import { expect, it } from "vitest";
import { companyBody } from "./http";

it("rejects an oversize body without waiting for an unresponsive upstream cancel", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2));
    },
    cancel() {
      return new Promise<void>(() => undefined);
    },
  });
  const options: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  const request = new Request("https://app.example.com/api/company-profile", options);
  const result = await Promise.race([
    companyBody(request, 1, AbortSignal.timeout(30)),
    new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), 50)),
  ]);
  expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
});
