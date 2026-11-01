import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { hash } from "./exportArchiveTestKit";
import { createExportObjectStore, type ExportObjectStore } from "./exportObjectStore";
import { readBytes, type S3Fixture, startS3Fixture } from "./exportObjectStore.test-helpers";
import { createStorageDiagnostics } from "./exportObjectStoreDiagnostics.test-helpers";
import { EXPORT_PART_BYTES } from "./exportObjectStoreParts";
import { startStorageProxy } from "./exportObjectStoreProxy.test-helpers";

let fixture: S3Fixture;
const readiness = createStorageDiagnostics(Buffer.from("synthetic-readiness-observer"));
beforeAll(async () => {
  const deadline = performance.now() + 60_000;
  const startupSignal = AbortSignal.timeout(60_000);
  fixture = await startS3Fixture({
    observeLogs: readiness.observeLogs,
    diagnosticLogToStderr: true,
  });
  const observed = await readiness.readiness.wait(fixture.container, deadline, startupSignal);
  assert.equal(observed.state, "ready", "synthetic_provider_readiness");
});
afterAll(async () => {
  try {
    await fixture?.container.stop();
  } finally {
    console.warn(
      JSON.stringify({ diagnostic: "seaweed_failure_fixture_readiness", ...readiness.snapshot() }),
    );
  }
});
const signal = () => AbortSignal.timeout(10_000);

async function stage(store: ExportObjectStore, body: Buffer, abort: AbortSignal) {
  const attempt = store.allocate();
  const begun = await store.begin(attempt, { maxBytes: body.length }, abort);
  assert(begun.ok);
  await pipeline(Readable.from([body]), begun.value.sink, { signal: abort });
  return {
    attempt,
    upload: begun.value,
    receipt: { format: "tar.gz" as const, files: 0, bytes: body.length, sha256: hash(body) },
  };
}

test("C06: finishing bytes does not release the original attempt cancellation fence", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const controller = new AbortController();
  const body = Buffer.from("synthetic-cancelled-attempt");
  const data = await stage(created.value, body, controller.signal);
  controller.abort();
  await expect(data.upload.complete(data.receipt, signal())).rejects.toMatchObject({
    name: "AbortError",
  });
  const inspected = await created.value.inspect(data.attempt, signal());
  assert(inspected.ok);
  expect(inspected.value.objects).toHaveLength(0);
  expect(await created.value.abort(data.upload.ref, signal())).toEqual({
    ok: true,
    value: "upload_absent_verified",
  });
});

test("C05: accepted completion with a lost response is uncertain and is not automatically repeated", async () => {
  const proxy = await startStorageProxy(fixture.config.endpoint, "drop_complete", signal());
  try {
    const created = createExportObjectStore({ ...fixture.config, endpoint: proxy.endpoint });
    assert(created.ok);
    const data = await stage(created.value, Buffer.from("synthetic-completion-receipt"), signal());
    expect(await data.upload.complete(data.receipt, signal())).toEqual({
      ok: false,
      error: "completion_uncertain",
    });
    expect(await data.upload.complete(data.receipt, signal())).toEqual({
      ok: false,
      error: "completion_uncertain",
    });
    expect(proxy.counts().completeRequests).toBe(1);
    expect(proxy.counts().droppedResponses).toBe(1);
    const inspected = await created.value.inspect(data.attempt, signal());
    assert(inspected.ok);
    expect(inspected.value.uploads).toHaveLength(0);
    expect(inspected.value.objects).toHaveLength(1);
    const object = inspected.value.objects[0];
    assert(object !== undefined);
    const opened = await created.value.open(object.ref, signal());
    assert(opened.ok);
    expect(hash(await readBytes(opened.value))).toBe(data.receipt.sha256);
    expect(await created.value.remove(object.ref, signal())).toEqual({
      ok: true,
      value: "absent_verified",
    });
  } finally {
    await proxy.close();
  }
});

test("C05/C17: exact-version deletion preserves the other version and repeated cleanup stays safe", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const first = await stage(created.value, Buffer.from("synthetic-version-one"), signal());
  const storedFirst = await first.upload.complete(first.receipt, signal());
  assert(storedFirst.ok);
  const next = await created.value.begin(first.attempt, { maxBytes: 1024 }, signal());
  assert(next.ok);
  const body = Buffer.from("synthetic-version-two");
  await pipeline(Readable.from([body]), next.value.sink, { signal: signal() });
  const storedNext = await next.value.complete(
    { format: "tar.gz", files: 0, bytes: body.length, sha256: hash(body) },
    signal(),
  );
  assert(storedNext.ok);
  expect(storedNext.value.versionId).not.toBe(storedFirst.value.versionId);
  expect(await created.value.remove(storedFirst.value, signal())).toEqual({
    ok: true,
    value: "absent_verified",
  });
  expect(await created.value.remove(storedFirst.value, signal())).toEqual({
    ok: true,
    value: "absent_verified",
  });
  const opened = await created.value.open(storedNext.value, signal());
  assert(opened.ok);
  expect(await readBytes(opened.value)).toEqual(body);
  expect(await created.value.remove(storedNext.value, signal())).toEqual({
    ok: true,
    value: "absent_verified",
  });
});

test("C05: a lost deletion acknowledgement remains uncertain until separate exact-version reconciliation", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const data = await stage(created.value, Buffer.from("synthetic-delete-receipt"), signal());
  const stored = await data.upload.complete(data.receipt, signal());
  assert(stored.ok);
  const proxy = await startStorageProxy(fixture.config.endpoint, "drop_delete", signal());
  try {
    const uncertain = createExportObjectStore({ ...fixture.config, endpoint: proxy.endpoint });
    assert(uncertain.ok);
    expect(await uncertain.value.remove(stored.value, signal())).toEqual({
      ok: false,
      error: "delete_uncertain",
    });
    expect(proxy.counts().deleteRequests).toBe(1);
    expect(proxy.counts().droppedResponses).toBe(1);
    expect(await created.value.stat(stored.value, signal())).toEqual({
      ok: false,
      error: "object_missing",
    });
  } finally {
    await proxy.close();
  }
});

test("C08: multipart receipt hashes the owned part bytes rather than a producer buffer changed during backpressure", async () => {
  const proxy = await startStorageProxy(fixture.config.endpoint, "hold_part", signal());
  try {
    const created = createExportObjectStore({ ...fixture.config, endpoint: proxy.endpoint });
    assert(created.ok);
    const body = Buffer.alloc(EXPORT_PART_BYTES + 128, 1);
    const receipt = { format: "tar.gz" as const, files: 0, bytes: body.length, sha256: hash(body) };
    const begun = await created.value.begin(
      created.value.allocate(),
      { maxBytes: body.length },
      signal(),
    );
    assert(begun.ok);
    const ended = finished(begun.value.sink);
    begun.value.sink.end(body);
    await proxy.reached;
    body.fill(2, EXPORT_PART_BYTES);
    proxy.release();
    await ended;
    expect(proxy.counts().partRequests).toBe(2);
    expect(await begun.value.complete(receipt, signal())).toEqual({
      ok: false,
      error: "receipt_mismatch",
    });
    expect(await created.value.abort(begun.value.ref, signal())).toEqual({
      ok: true,
      value: "upload_absent_verified",
    });
  } finally {
    await proxy.close();
  }
});
