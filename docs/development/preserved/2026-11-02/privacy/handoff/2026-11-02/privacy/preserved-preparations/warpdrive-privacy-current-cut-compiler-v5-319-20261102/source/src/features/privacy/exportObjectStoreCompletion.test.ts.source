import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { Client } from "minio";
import { afterEach, expect, test, vi } from "vitest";
import { createExportObjectStore } from "./exportObjectStore";
import * as transport from "./exportObjectStoreTransport";

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

// SDK stubs exercise signal composition and result admission, not provider cancellation.
test.each([
  ["attempt", "complete"],
  ["attempt", "head"],
  ["completion", "complete"],
  ["completion", "head"],
  ["after-head", "head"],
  ["none", "complete"],
  ["none", "head"],
] as const)(
  "C06: %s cancellation during %s preserves completion admission",
  async (cancellation, phase) => {
    const attempt = new AbortController();
    const completion = new AbortController();
    const reason = new DOMException("Synthetic cancellation", "AbortError");
    const entered = deferred<void>();
    const released = deferred<void>();
    const clients = vi.spyOn(transport, "exportStoreClient");
    vi.spyOn(Client.prototype, "getBucketVersioning").mockResolvedValue({ Status: "Enabled" });
    vi.spyOn(Client.prototype, "initiateNewMultipartUpload").mockResolvedValue("synthetic-upload");
    vi.spyOn(Client.prototype, "uploadPart").mockResolvedValue({
      etag: "synthetic-part",
      key: "synthetic-key",
      part: 1,
    });
    vi.spyOn(Client.prototype, "completeMultipartUpload").mockImplementation(async () => {
      if (phase === "complete") {
        entered.resolve();
        await released.promise;
      }
      return { etag: "synthetic-object", versionId: "synthetic-version" };
    });
    const head = vi.spyOn(Client.prototype, "statObject").mockImplementation(async () => {
      if (phase === "head") {
        entered.resolve();
        await released.promise;
      }
      if (cancellation === "after-head")
        queueMicrotask(() => queueMicrotask(() => attempt.abort(reason)));
      return {
        size: 9,
        etag: "synthetic-object",
        lastModified: new Date("2026-11-01T00:00:00Z"),
        metaData: {},
        versionId: "synthetic-version",
      };
    });
    const created = createExportObjectStore({
      endpoint: "http://127.0.0.1:1",
      bucket: "synthetic-private",
      accessKey: "synthetic-access",
      secretKey: "synthetic-secret",
      requestTimeoutMs: 1000,
    });
    assert(created.ok);
    const begun = await created.value.begin(
      created.value.allocate(),
      { maxBytes: 1024 },
      attempt.signal,
    );
    assert(begun.ok);
    const body = Buffer.from("synthetic");
    const staged = finished(begun.value.sink, { cleanup: true });
    begun.value.sink.end(body);
    await staged;
    const result = begun.value
      .complete(
        {
          format: "tar.gz",
          bytes: body.length,
          sha256: createHash("sha256").update(body).digest("hex"),
          files: 1,
        },
        completion.signal,
      )
      .then(
        (value) => ({ state: "resolved" as const, value }),
        (reason: unknown) => ({ state: "rejected" as const, reason }),
      );
    try {
      await entered.promise;
      const activeSignal = clients.mock.calls.at(-1)?.[1];
      if (cancellation === "attempt") attempt.abort(reason);
      if (cancellation === "completion") completion.abort(reason);
      const transportCancelled = activeSignal?.aborted;
      released.resolve();
      const settled = await result;
      if (cancellation === "none") {
        expect(transportCancelled).toBe(false);
        expect(settled).toMatchObject({
          state: "resolved",
          value: { ok: true, value: { versionId: "synthetic-version" } },
        });
        expect(head).toHaveBeenCalledTimes(1);
      } else {
        const observedCancelled =
          cancellation === "after-head" ? activeSignal?.aborted : transportCancelled;
        expect({ transportCancelled: observedCancelled, state: settled.state }).toEqual({
          transportCancelled: true,
          state: "rejected",
        });
        assert(settled.state === "rejected");
        expect(settled.reason).toBe(reason);
        expect(activeSignal?.reason).toBe(reason);
        if (phase === "complete") expect(head).not.toHaveBeenCalled();
      }
    } finally {
      released.resolve();
    }
  },
);
