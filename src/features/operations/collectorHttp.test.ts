import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOperationsCollectorHandler,
  type OperationsCollectorServices,
} from "./collectorHttp";
import { OPERATIONS_COLLECTOR_PATH } from "./collectorSignature";
import { OPERATIONS_MAX_BODY_BYTES } from "./contracts";

const target = OPERATIONS_COLLECTOR_PATH;
const origin = "https://collector.example";
const sourceHeader = "x-warpdrive-collector-source";
const timestampHeader = "x-warpdrive-collector-timestamp";
const signatureHeader = "x-warpdrive-collector-signature";
const now = 1_794_567_890_123;
const binding = {
  installationId: "10000000-0000-4000-8000-000000000001",
  sourceId: "10000000-0000-4000-8000-000000000002",
  generationId: "10000000-0000-4000-8000-000000000003",
};
const signingKey = Buffer.alloc(32, 43);
const authority = {
  installationId: binding.installationId,
  binding,
  signingKey: signingKey.toString("base64url"),
};
const raw = '{"text":"grün","privateDiagnostic":"keep private"}\n';
const receipt = {
  receiptId: "internal-receipt",
  replayed: false,
  appliedObservations: 1,
  transitions: ["private-transition"],
  admissionState: "ready",
} as const;
type Write = OperationsCollectorServices["write"];

function signedHeaders(body = Buffer.from(raw)): Headers {
  const prefix = `warpdrive.operations.collector.v1\nPOST\n${target}\n${binding.installationId}\n${binding.sourceId}\n${binding.generationId}\n${now}\n`;
  const signature = createHmac("sha256", signingKey).update(prefix).update(body).digest("hex");
  return new Headers({
    "Content-Type": "application/json; charset=utf-8",
    [sourceHeader]: binding.sourceId,
    [timestampHeader]: String(now),
    [signatureHeader]: `v1=${signature}`,
  });
}

function post(
  body: BodyInit = raw,
  headers = signedHeaders(),
  signal?: AbortSignal,
  path = target,
) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body,
    headers,
    signal,
    duplex: "half",
  };
  return new Request(origin + path, init);
}

function services(
  write: Write = () =>
    Promise.resolve({ ok: true, value: { ...receipt, transitions: [...receipt.transitions] } }),
) {
  const lookup = vi.fn<OperationsCollectorServices["lookupAuthority"]>(() => authority);
  const writer = vi.fn(write);
  return {
    lookup,
    writer,
    handle: createOperationsCollectorHandler({ lookupAuthority: lookup, write: writer }),
  };
}

function startClock(): void {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  vi.setSystemTime(now);
}

async function expectFailure(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Operations collector HTTP handler", () => {
  it("authenticates exact chunk bytes and only acknowledges the writer result", async () => {
    startClock();
    const { lookup, writer, handle } = services();
    const bytes = Buffer.from(raw);
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(new Uint8Array(0));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    });
    const headers = signedHeaders();
    headers.set("Content-Length", String(bytes.length));
    const response = await handle(post(body, headers), target);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(binding.sourceId);
    expect(writer).toHaveBeenCalledExactlyOnceWith(binding, raw, expect.any(AbortSignal));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("acknowledges an existing repository replay without exposing the receipt", async () => {
    startClock();
    const { writer, handle } = services(() =>
      Promise.resolve({ ok: true, value: { ...receipt, replayed: true, transitions: [] } }),
    );
    const response = await handle(post(), target);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("requires the original target even when Fetch normalizes the URL", async () => {
    const { lookup, writer, handle } = services();
    const rawAlias = "/api/internal/operations/extra/../observations";
    const request = post(raw, signedHeaders(), undefined, rawAlias);
    expect(request.url).toBe(origin + target);
    await expectFailure(await handle(request, rawAlias), 400, "invalid_request");
    await expectFailure(
      await handle(post(raw, signedHeaders(), undefined, `${target}?`), target),
      400,
      "invalid_request",
    );
    const method = await handle(new Request(origin + target), target);
    await expectFailure(method, 405, "method_not_allowed");
    expect(method.headers.get("allow")).toBe("POST");
    expect(lookup).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });

  it.each([sourceHeader, timestampHeader, signatureHeader])(
    "denies duplicate or missing %s before authority lookup",
    async (name) => {
      const { lookup, writer, handle } = services();
      const headers = signedHeaders();
      headers.append(name, headers.get(name) ?? "");
      await expectFailure(await handle(post(raw, headers), target), 404, "collector_unavailable");
      headers.delete(name);
      await expectFailure(await handle(post(raw, headers), target), 404, "collector_unavailable");
      expect(lookup).not.toHaveBeenCalled();
      expect(writer).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Cookie", "session=fixture"],
    ["Authorization", "Bearer fixture"],
    ["Content-Encoding", "gzip"],
    ["Content-Type", "application/json, application/json"],
    ["Content-Length", "3, 3"],
    ["Content-Length", "01"],
    ["Transfer-Encoding", "gzip"],
  ])("rejects unsupported %s", async (name, value) => {
    const { lookup, writer, handle } = services();
    const headers = signedHeaders();
    headers.set(name, value);
    await expectFailure(await handle(post(raw, headers), target), 400, "invalid_request");
    expect(lookup).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects conflicting framing and over-limit declarations before reading", async () => {
    const { lookup, writer, handle } = services();
    const headers = signedHeaders();
    headers.set("Content-Length", String(OPERATIONS_MAX_BODY_BYTES + 1));
    await expectFailure(await handle(post(raw, headers), target), 413, "body_too_large");
    headers.set("Transfer-Encoding", "chunked");
    await expectFailure(await handle(post(raw, headers), target), 400, "invalid_request");
    expect(lookup).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });

  it("caps undeclared stream bytes and signals cancellation without waiting for it", async () => {
    const { writer, handle } = services();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(OPERATIONS_MAX_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    await expectFailure(await handle(post(body), target), 413, "body_too_large");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it("checks exact declared length against delivered bytes and refuses empty bodies", async () => {
    const { writer, handle } = services();
    for (const length of [1, Buffer.byteLength(raw) + 1]) {
      const headers = signedHeaders();
      headers.set("Content-Length", String(length));
      await expectFailure(await handle(post(raw, headers), target), 400, "invalid_request");
    }
    await expectFailure(await handle(post(""), target), 400, "invalid_request");
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects both authority confusion and body tampering before writing", async () => {
    startClock();
    const { lookup, writer, handle } = services();
    lookup.mockReturnValueOnce(null);
    await expectFailure(await handle(post(), target), 404, "collector_unavailable");
    lookup.mockReturnValueOnce({
      ...authority,
      binding: { ...binding, sourceId: binding.installationId },
    });
    await expectFailure(await handle(post(), target), 404, "collector_unavailable");
    await expectFailure(await handle(post(raw.trimEnd()), target), 404, "collector_unavailable");
    expect(writer).not.toHaveBeenCalled();
  });

  it("returns pre-write timeout on client abort or an unresponsive body", async () => {
    startClock();
    const { writer, handle } = services();
    for (const abort of [true, false]) {
      const client = new AbortController();
      const cancel = vi.fn(() => Promise.reject(new Error("private cancellation detail")));
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = handle(post(body, signedHeaders(), client.signal), target);
      if (abort) client.abort();
      else await vi.advanceTimersByTimeAsync(15_000);
      await expectFailure(await response, 408, "request_timeout");
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    }
    expect(writer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks a monotonic deadline even when buffered reads beat the timeout callback", async () => {
    startClock();
    const { writer, handle } = services();
    const clock = vi.spyOn(performance, "now");
    clock
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(15_001);
    await expectFailure(await handle(post(), target), 408, "request_timeout");
    expect(writer).not.toHaveBeenCalled();
  });

  it.each(["client abort", "deadline"])(
    "classifies post-write %s as unknown and observes late rejection",
    async (stop) => {
      startClock();
      const client = new AbortController();
      let signal: AbortSignal | undefined;
      let rejectActual: (reason: unknown) => void = () => {};
      const actual = new Promise<Awaited<ReturnType<Write>>>((_resolve, reject) => {
        rejectActual = reject;
      });
      const { writer, handle } = services((_binding, _body, operationSignal) => {
        signal = operationSignal;
        return actual;
      });
      const response = handle(post(raw, signedHeaders(), client.signal), target);
      await vi.advanceTimersByTimeAsync(0);
      expect(writer).toHaveBeenCalledTimes(1);
      expect(signal?.aborted).toBe(false);
      if (stop === "client abort") client.abort();
      else await vi.advanceTimersByTimeAsync(15_000);
      await expectFailure(await response, 503, "submission_unknown");
      expect(signal?.aborted).toBe(true);
      rejectActual(new Error("private transaction detail"));
      await vi.advanceTimersByTimeAsync(0);
      expect(writer).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("returns different fixed outcomes for a lookup failure and a writer failure", async () => {
    startClock();
    const { lookup, writer, handle } = services();
    lookup.mockImplementationOnce(() => {
      throw new Error("private lookup detail");
    });
    await expectFailure(await handle(post(), target), 503, "temporarily_unavailable");
    expect(writer).not.toHaveBeenCalled();
    writer.mockRejectedValueOnce(new Error("private writer detail"));
    await expectFailure(await handle(post(), target), 503, "submission_unknown");
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["identity_conflict", 409, "observation_conflict"],
    ["expired_or_out_of_order", 409, "observation_conflict"],
    ["storage_pressure", 503, "temporarily_unavailable"],
    ["source_scope_denied", 404, "collector_unavailable"],
    ["generation_retired", 404, "collector_unavailable"],
    ["invalid_payload", 400, "invalid_payload"],
  ] as const)("maps repository %s to a fixed public result", async (error, status, publicError) => {
    startClock();
    const { writer, handle } = services(() => Promise.resolve({ ok: false, error }));
    await expectFailure(await handle(post(), target), status, publicError);
    expect(writer).toHaveBeenCalledTimes(1);
  });
});
