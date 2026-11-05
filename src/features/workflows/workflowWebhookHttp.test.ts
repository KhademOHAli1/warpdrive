import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { workflowWebhookLimits } from "./workflowWebhookContract";
import {
  handleWorkflowWebhookRequest,
  workflowWebhookMethodNotAllowed,
} from "./workflowWebhookHttp";

const publication = {
  workflowId: "52f6b244-2ea8-400a-92c9-b584c938562f",
  versionId: "52f6b244-2ea8-400a-92c9-b584c9385630",
};
const url = `https://app.example.invalid/api/workflows/${publication.workflowId}/webhook/${publication.versionId}`;
const eventId = "52f6b244-2ea8-400a-92c9-b584c9385631";
const recordId = "52f6b244-2ea8-400a-92c9-b584c9385632";
const runId = "52f6b244-2ea8-400a-92c9-b584c9385633";
const query = `eventId=${eventId}`;
const timestamp = "1773000000";
const signature = `v1=${"a".repeat(64)}`;
const headers = {
  "x-warpdrive-webhook-timestamp": timestamp,
  "x-warpdrive-webhook-signature": signature,
};
const bytes = new TextEncoder().encode(` { "eventId": "${eventId}", "recordId": "${recordId}" }\n`);
type Services = Parameters<typeof handleWorkflowWebhookRequest>[2];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const admit = vi.fn<Services["admit"]>().mockResolvedValue(ok({ runId, replayed: false }));
  const nudge = vi.fn<Services["nudge"]>().mockResolvedValue(undefined);
  return {
    admit,
    nudge,
    handle: (request: Request, params: unknown = publication) =>
      handleWorkflowWebhookRequest(request, params, { admit, nudge }),
  };
}

function post({
  body = bytes,
  target = url,
  overrides = {},
  signal,
}: {
  body?: BodyInit;
  target?: string;
  overrides?: HeadersInit;
  signal?: AbortSignal;
} = {}) {
  const allHeaders = new Headers({ ...headers, "content-type": "application/json" });
  for (const [name, value] of new Headers(overrides)) allHeaders.set(name, value);
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: allHeaders,
    body,
    duplex: "half",
    ...(signal === undefined ? {} : { signal }),
  };
  return new Request(target, init);
}

function get(target = `${url}?${query}`, override?: Record<string, string>) {
  return new Request(target, { headers: { ...headers, ...override } });
}

function expectStatus(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

it("preserves the complete exact POST byte snapshot and does not nudge before admission resolves", async () => {
  const test = fixture();
  const result = deferred<Awaited<ReturnType<Services["admit"]>>>();
  const entered = deferred<void>();
  test.admit.mockImplementationOnce(() => {
    entered.resolve();
    return result.promise;
  });
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 27));
      controller.enqueue(bytes.slice(27));
      controller.close();
    },
  });
  const pending = test.handle(post({ body: chunks }));
  await entered.promise;
  expect(test.admit).toHaveBeenCalledExactlyOnceWith(
    {
      method: "POST",
      publication,
      timestamp,
      signature,
      contentType: "application/json",
      rawBody: bytes,
    },
    expect.any(AbortSignal),
  );
  expect(test.nudge).not.toHaveBeenCalled();
  result.resolve(ok({ runId, replayed: false }));
  const response = await pending;
  expectStatus(response, 202);
  expect(await response.text()).toBe("");
  expect([...response.headers.values()].join("\n")).not.toContain(runId);
  expect(test.nudge).toHaveBeenCalledExactlyOnceWith(runId);
});

it("passes only the exact signed bodyless GET query and never re-enqueues a replay", async () => {
  const test = fixture();
  test.admit.mockResolvedValueOnce(ok({ runId, replayed: true }));
  const response = await test.handle(get());
  expectStatus(response, 202);
  expect(await response.text()).toBe("");
  expect(test.admit).toHaveBeenCalledExactlyOnceWith(
    {
      method: "GET",
      publication,
      timestamp,
      signature,
      contentType: null,
      rawBody: new Uint8Array(),
      rawQuery: query,
    },
    expect.any(AbortSignal),
  );
  expect(test.nudge).not.toHaveBeenCalled();
});

it("rejects alternate methods including HEAD and OPTIONS without invoking admission", async () => {
  const test = fixture();
  for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await test.handle(new Request(`${url}?${query}`, { method, headers }));
    expectStatus(response, 405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(await response.text()).toBe("");
  }
  expectStatus(workflowWebhookMethodNotAllowed(), 405);
  expect(test.admit).not.toHaveBeenCalled();
  expect(test.nudge).not.toHaveBeenCalled();
});

it("rejects unknown params and absent or combined signature headers without invoking admission", async () => {
  const test = fixture();
  expectStatus(await test.handle(get(), { ...publication, extra: true }), 404);
  expectStatus(await test.handle(get(), { ...publication, versionId: "not-uuid" }), 404);
  expectStatus(await test.handle(new Request(`${url}?${query}`)), 404);
  expectStatus(
    await test.handle(
      get(`${url}?${query}`, { "x-warpdrive-webhook-signature": `${signature}, ${signature}` }),
    ),
    404,
  );
  expect(test.admit).not.toHaveBeenCalled();
});

it("cancels POST bodies with malformed authentication headers without reading a chunk", async () => {
  const test = fixture();
  for (const overrides of [
    new Headers({ "x-warpdrive-webhook-timestamp": "0177300000" }),
    new Headers({ "x-warpdrive-webhook-timestamp": "1, 2" }),
    new Headers({ "x-warpdrive-webhook-signature": `v1=${"G".repeat(64)}` }),
    new Headers({ "x-warpdrive-webhook-signature": `v2=${"a".repeat(64)}` }),
  ]) {
    const pull = vi.fn();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    expectStatus(await test.handle(post({ body: stream, overrides })), 404);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  }
  expect(test.admit).not.toHaveBeenCalled();
});

it("rejects GET aliases, extra query fields, and body framing metadata", async () => {
  const test = fixture();
  for (const target of [
    url,
    `${url}?${query}&x=1`,
    `${url}?${query}&${query}`,
    `${url}?event%49d=${eventId}`,
    `${url}?eventId=${eventId.toUpperCase()}`,
    `${url}?${query}#private`,
  ]) {
    expectStatus(await test.handle(get(target)), 400);
  }
  const invalidHeaders: Record<string, string>[] = [
    { "content-type": "application/json" },
    { "content-length": "1" },
    { "transfer-encoding": "chunked" },
    { "content-encoding": "gzip" },
  ];
  for (const override of invalidHeaders) {
    expectStatus(await test.handle(get(undefined, override)), 400);
  }
  expect(test.admit).not.toHaveBeenCalled();
});

it("rejects POST queries, empty, encoded and ambiguously framed bodies", async () => {
  const test = fixture();
  for (const request of [
    post({ target: `${url}?${query}` }),
    post({ target: `${url}?` }),
    post({ body: "" }),
    post({ overrides: { "content-type": "text/plain" } }),
    post({ overrides: { "content-encoding": "gzip" } }),
    post({ overrides: { "content-length": "1, 2" } }),
    post({ overrides: { "content-length": "1" } }),
    post({
      overrides: { "content-length": String(bytes.byteLength), "transfer-encoding": "chunked" },
    }),
  ]) {
    expectStatus(await test.handle(request), 400);
  }
  expect(test.admit).not.toHaveBeenCalled();
});

it("reads at most the configured byte cap and cancels both declared and streamed overflow", async () => {
  const test = fixture();
  const cap = workflowWebhookLimits.bodyBytes;
  const cancelDeclared = vi.fn();
  const declared = new ReadableStream<Uint8Array>({ cancel: cancelDeclared });
  expectStatus(
    await test.handle(post({ body: declared, overrides: { "content-length": String(cap + 1) } })),
    413,
  );
  expect(cancelDeclared).toHaveBeenCalledTimes(1);
  const cancelStream = vi.fn(() => new Promise<void>(() => {}));
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(cap));
      controller.enqueue(new Uint8Array(1));
    },
    cancel: cancelStream,
  });
  expectStatus(await test.handle(post({ body: streamed })), 413);
  expect(cancelStream).toHaveBeenCalledTimes(1);
  expect(test.admit).not.toHaveBeenCalled();
  const exact = new Uint8Array(cap).fill(32);
  exact.set(bytes);
  expectStatus(
    await test.handle(post({ body: exact, overrides: { "content-length": String(cap) } })),
    202,
  );
  expect(test.admit.mock.calls[0]?.[0].rawBody).toEqual(exact);
});

it("cancels a pending body read when the client aborts and does not admit", async () => {
  const test = fixture();
  const abort = new AbortController();
  const read = deferred<void>();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      read.resolve();
    },
    cancel,
  });
  const pending = test.handle(post({ body: stream, signal: abort.signal }));
  await read.promise;
  abort.abort(new Error("private cancellation reason"));
  const response = await pending;
  expectStatus(response, 503);
  expect(await response.text()).toBe("Webhook unavailable.");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(test.admit).not.toHaveBeenCalled();
});

it.each([
  ["invalid-payload", 400, "Invalid webhook request."],
  ["unauthorized", 404, "Webhook unavailable."],
  [ERROR_IDS.WORKFLOW_DENIED, 404, "Webhook unavailable."],
  [ERROR_IDS.WORKFLOW_CONFLICT, 409, "Webhook request conflicted."],
  [ERROR_IDS.WORKFLOW_WRITE_FAILED, 503, "Webhook unavailable."],
] as const)(
  "maps private admission failure %s to a static HTTP response",
  async (error, status, message) => {
    const test = fixture();
    test.admit.mockResolvedValueOnce(err(error));
    const response = await test.handle(post());
    expectStatus(response, status);
    expect(await response.text()).toBe(message);
    expect(test.nudge).not.toHaveBeenCalled();
  },
);

it("keeps acceptance durable when queue nudge fails and sanitizes an unexpected admission failure", async () => {
  const test = fixture();
  test.nudge.mockRejectedValueOnce(new Error("private queue failure"));
  const admitted = await test.handle(post());
  expectStatus(admitted, 202);
  expect(await admitted.text()).toBe("");
  test.admit.mockRejectedValueOnce(new Error("private admission failure"));
  const failed = await test.handle(post());
  expectStatus(failed, 503);
  expect(await failed.text()).toBe("Webhook unavailable.");
  expect(test.nudge).toHaveBeenCalledTimes(1);
});
