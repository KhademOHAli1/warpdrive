import { expect, test, vi } from "vitest";
import { authorizationInput, readTokenInput } from "./requestIngress";

const resource = "https://app.example.test/api/mcp";
const maximumBytes = 32 * 1_024;
const signal = () => AbortSignal.timeout(5_000);

function request(body: BodyInit, contentType = "application/json"): Request {
  return new Request("https://app.example.test/oauth/token", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

test("authorization parameters preserve one resource and legacy unrelated duplicates", () => {
  const params = new URLSearchParams([
    ["client_id", "first"],
    ["client_id", "last"],
    ["resource", resource],
  ]);
  expect(authorizationInput(params)).toEqual({
    ok: true,
    value: { client_id: "last", resource },
  });
});

test.each([
  "client_id=client",
  "resource=",
  `resource=${encodeURIComponent(resource)}&resource=${encodeURIComponent(resource)}`,
  `resource=${encodeURIComponent(resource)}&%72esource=${encodeURIComponent(resource)}`,
])("authorization rejects an ambiguous or empty target: %s", (raw) => {
  expect(authorizationInput(new URLSearchParams(raw))).toEqual({
    ok: false,
    error: "invalid_target",
  });
});

test("JSON preserves Unicode, escapes, nested values and unrelated duplicate semantics", async () => {
  const raw = String.raw`{"grant_type":"old","grant_type":"refresh_token","resource":"${resource}","extra":{"resource":1,"resource":2,"text":"فارسی \" } ["},"values":[true,null,-1.25e2]}`;
  const input = request(raw, "Application/JSON; charset=UTF-8");
  expect(await readTokenInput(input, signal())).toEqual({ ok: true, value: JSON.parse(raw) });
  expect(input.body?.locked).toBe(false);
});

test("JSON accepts an escaped resource member name and preserves the raw target", async () => {
  const raw = String.raw`{"reso\u0075rce":"${resource} ","refresh_token":"synthetic"}`;
  expect(await readTokenInput(request(raw), signal())).toEqual({
    ok: true,
    value: { resource: `${resource} `, refresh_token: "synthetic" },
  });
});

test.each([
  `{"resource":"${resource}","resource":"${resource}"}`,
  String.raw`{"resource":"${resource}","\u0072esource":"${resource}"}`,
  String.raw`{"reso\u0075rce":"${resource}","resource":"${resource}"}`,
])("JSON rejects repeated decoded resource names before object creation", async (raw) => {
  expect(await readTokenInput(request(raw), signal())).toEqual({
    ok: false,
    error: "invalid_target",
  });
});

test.each([{}, { resource: "" }, { resource: null }, { resource: 1 }, { resource: [resource] }])(
  "JSON requires one nonempty scalar target",
  async (body) => {
    expect(await readTokenInput(request(JSON.stringify(body)), signal())).toEqual({
      ok: false,
      error: "invalid_target",
    });
  },
);

test.each([
  "[]",
  "null",
  '"text"',
  '{"resource":',
  `{"resource":"${resource}",}`,
  `{"resource":"${resource}"} trailing`,
  `{"resource":"${resource}","extra":01}`,
  '{"resource":"\\x72"}',
])("JSON rejects malformed or non-object bodies with a bounded error", async (raw) => {
  expect(await readTokenInput(request(raw), signal())).toEqual({
    ok: false,
    error: "invalid_request",
  });
});

test("JSON accepts a UTF-8 BOM without changing its object", async () => {
  expect(await readTokenInput(request(`\uFEFF${JSON.stringify({ resource })}`), signal())).toEqual({
    ok: true,
    value: { resource },
  });
});

test("JSON accepts the exact body byte bound and rejects one additional byte", async () => {
  const overhead = new TextEncoder().encode(JSON.stringify({ resource, padding: "" })).length;
  const exact = JSON.stringify({ resource, padding: "x".repeat(maximumBytes - overhead) });
  expect(new TextEncoder().encode(exact)).toHaveLength(maximumBytes);
  expect((await readTokenInput(request(exact), signal())).ok).toBe(true);
  expect(await readTokenInput(request(`${exact} `), signal())).toEqual({
    ok: false,
    error: "invalid_request",
  });
});

test("body limits count UTF-8 bytes rather than characters", async () => {
  const raw = JSON.stringify({ resource, padding: "آ".repeat(20_000) });
  expect(raw.length).toBeLessThan(maximumBytes);
  expect(await readTokenInput(request(raw), signal())).toEqual({
    ok: false,
    error: "invalid_request",
  });
});

test("JSON accepts depth32 and rejects depth33", async () => {
  const nested = (levels: number) =>
    `{"resource":"${resource}","extra":${"[".repeat(levels)}0${"]".repeat(levels)}}`;
  expect((await readTokenInput(request(nested(31)), signal())).ok).toBe(true);
  expect(await readTokenInput(request(nested(32)), signal())).toEqual({
    ok: false,
    error: "invalid_request",
  });
});

test("malformed UTF-8 and unsupported media produce bounded request errors", async () => {
  expect(await readTokenInput(request(new Uint8Array([0xc3, 0x28])), signal())).toEqual({
    ok: false,
    error: "invalid_request",
  });
  expect(
    await readTokenInput(request(JSON.stringify({ resource }), "text/plain"), signal()),
  ).toEqual({
    ok: false,
    error: "invalid_request",
  });
});

test("urlencoded forms preserve one resource and reject decoded repetitions", async () => {
  const raw = new URLSearchParams({ resource, refresh_token: "synthetic" }).toString();
  expect(await readTokenInput(request(raw, "application/x-www-form-urlencoded"), signal())).toEqual(
    {
      ok: true,
      value: { resource, refresh_token: "synthetic" },
    },
  );
  expect(
    await readTokenInput(
      request(
        `${raw}&%72esource=${encodeURIComponent(resource)}`,
        "application/x-www-form-urlencoded",
      ),
      signal(),
    ),
  ).toEqual({ ok: false, error: "invalid_target" });
});

test.each(["missing", "empty", "repeated", "file"] as const)(
  "multipart forms reject a %s target",
  async (kind) => {
    const form = new FormData();
    if (kind === "empty") form.append("resource", "");
    if (kind === "repeated") {
      form.append("resource", resource);
      form.append("resource", resource);
    }
    if (kind === "file") form.append("resource", new File([resource], "resource.txt"));
    expect(
      await readTokenInput(
        new Request("https://app.example.test/oauth/token", { method: "POST", body: form }),
        signal(),
      ),
    ).toEqual({ ok: false, error: "invalid_target" });
  },
);

test("multipart forms preserve valid string fields", async () => {
  const form = new FormData();
  form.append("resource", resource);
  form.append("refresh_token", "synthetic");
  expect(
    await readTokenInput(
      new Request("https://app.example.test/oauth/token", { method: "POST", body: form }),
      signal(),
    ),
  ).toEqual({ ok: true, value: { resource, refresh_token: "synthetic" } });
});

test("oversize streaming bodies are cancelled and their reader is released", async () => {
  let cancelled = false;
  let sent = false;
  const bytes = new TextEncoder().encode(
    JSON.stringify({ resource, padding: "x".repeat(maximumBytes) }),
  );
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent) return controller.close();
        sent = true;
        controller.enqueue(bytes);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const input = request(stream);
  expect(await readTokenInput(input, signal())).toEqual({ ok: false, error: "invalid_request" });
  expect(cancelled).toBe(true);
  expect(input.body?.locked).toBe(false);
});

test("abort while waiting for input propagates and cancels/releases the reader", async () => {
  let cancelled = false;
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  let started = () => {};
  const pulling = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        body = value;
      },
      pull: started,
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const controller = new AbortController();
  const input = request(stream);
  let completed = false;
  const reading = readTokenInput(input, controller.signal).finally(() => {
    completed = true;
  });
  await pulling;
  controller.abort();
  const rejected = expect(reading).rejects.toBe(controller.signal.reason);
  try {
    await vi.waitFor(
      () => {
        expect(completed).toBe(true);
      },
      { timeout: 300 },
    );
  } finally {
    if (!cancelled) {
      body?.enqueue(new TextEncoder().encode(JSON.stringify({ resource })));
      body?.close();
    }
    await rejected;
  }
  expect(cancelled).toBe(true);
  expect(input.body?.locked).toBe(false);
});

test("an already-aborted signal is preserved without taking body ownership", async () => {
  const controller = new AbortController();
  controller.abort();
  const input = request(JSON.stringify({ resource }));
  await expect(readTokenInput(input, controller.signal)).rejects.toBe(controller.signal.reason);
  expect(input.bodyUsed).toBe(false);
});
