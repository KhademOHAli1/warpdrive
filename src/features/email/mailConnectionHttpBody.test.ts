import { describe, expect, it } from "vitest";
import { readMailboxRequestBody } from "./mailConnectionHttpBody";

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half", headers };
  return {
    request: new Request("https://app.example.test/api/mail-connections/check", init),
    cancelled: () => cancelled,
  };
}

describe("bounded mail connection JSON input", () => {
  it("bounds actual UTF-8 bytes even when content-length is forged and cancels the stream", async () => {
    const f = streamed([new TextEncoder().encode(JSON.stringify({ name: "ف".repeat(20_000) }))], {
      "content-length": "1",
    });
    expect(await readMailboxRequestBody(f.request, new AbortController().signal)).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(f.cancelled()).toBe(true);
  });

  it("rejects an excessive declared length without waiting for any body bytes", async () => {
    const f = streamed([], { "content-length": "32769" });
    expect(await readMailboxRequestBody(f.request, new AbortController().signal)).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(f.cancelled()).toBe(true);
  });

  it("rejects invalid JSON and malformed UTF-8", async () => {
    for (const body of ["{broken", new Uint8Array([0xc3, 0x28])]) {
      const request = new Request("https://app.example.test", { method: "POST", body });
      expect(await readMailboxRequestBody(request, new AbortController().signal)).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
  });

  it("releases a waiting body reader when the request aborts", async () => {
    const f = streamed([]);
    const controller = new AbortController();
    const result = readMailboxRequestBody(f.request, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(f.cancelled()).toBe(true);
  });
});
