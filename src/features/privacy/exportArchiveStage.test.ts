import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import { stagePrivacyExportArchive } from "./exportArchiveStage";
import {
  archiveFixture,
  collectSink,
  deferred,
  entrySources,
  hash,
  readArchive,
} from "./exportArchiveTestKit";
import type { ExportObjectStore, ExportObjectUpload } from "./exportObjectStoreTypes";

const MAX_BYTES = 1024 * 1024;
function subject() {
  const attempt = {
    artifactId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
    attemptId: "fedcbafe-dcba-4fed-8cba-fedcbafedcba",
  };
  const fixture = archiveFixture();
  const sink = collectSink();
  const storedAttempt = { ...attempt };
  const ref = { ...storedAttempt, uploadId: "synthetic-upload" };
  const complete = vi.fn<ExportObjectUpload["complete"]>().mockImplementation((receipt) => {
    expect(sink.stream.writableFinished).toBe(true);
    return Promise.resolve(
      ok({
        ...storedAttempt,
        versionId: "synthetic-version",
        bytes: receipt.bytes,
        sha256: receipt.sha256,
      }),
    );
  });
  const upload = { ref, sink: sink.stream, complete };
  const begin = vi.fn<ExportObjectStore["begin"]>().mockResolvedValue(ok(upload));
  return { attempt, fixture, sink, upload, complete, store: { begin } };
}
function run(value: ReturnType<typeof subject>, signal = AbortSignal.timeout(5000)) {
  return stagePrivacyExportArchive(
    value.store,
    value.attempt,
    value.fixture.manifest,
    entrySources(value.fixture.entries),
    MAX_BYTES,
    signal,
  );
}
async function reached(gate: Promise<void>, operation: Promise<unknown>) {
  await Promise.race([
    gate,
    operation.then(() => assert.fail("synthetic_stage_settled_before_gate")),
  ]);
}

test("P09A: the real Unicode archive is completed once with its exact storage and codec receipt", async () => {
  const value = subject();
  const signal = AbortSignal.timeout(5000);
  const result = await run(value, signal);
  assert(result.ok);
  const bytes = value.sink.bytes();
  expect(result.value).toEqual({
    object: {
      ...value.attempt,
      versionId: "synthetic-version",
      bytes: bytes.length,
      sha256: hash(bytes),
    },
    receipt: { format: "tar.gz", bytes: bytes.length, sha256: hash(bytes), files: 2 },
  });
  const archive = await readArchive(bytes);
  expect(JSON.parse(archive.get("manifest.json")?.toString("utf8") ?? "null")).toEqual(
    value.fixture.manifest,
  );
  for (const entry of value.fixture.entries) expect(archive.get(entry.path)).toEqual(entry.body);
  expect(value.store.begin).toHaveBeenCalledExactlyOnceWith(
    value.attempt,
    { maxBytes: MAX_BYTES },
    signal,
  );
  expect(value.complete).toHaveBeenCalledExactlyOnceWith(result.value.receipt, signal);
});

test("P09B: a blocked manifest fails before storage or source I/O", async () => {
  const value = subject();
  const opened = vi.fn();
  value.fixture.manifest.state = "blocked";
  const result = await stagePrivacyExportArchive(
    value.store,
    value.attempt,
    value.fixture.manifest,
    entrySources(value.fixture.entries, opened),
    MAX_BYTES,
    AbortSignal.timeout(5000),
  );
  expect(result).toEqual(err({ phase: "preflight", code: "manifest_blocked", repair: null }));
  expect(value.store.begin).not.toHaveBeenCalled();
  expect(opened).not.toHaveBeenCalled();
});

test("C03: attempt and reviewed manifest are snapshotted before storage initiation awaits", async () => {
  const value = subject();
  const originalAttempt = { ...value.attempt };
  const originalManifest = structuredClone(value.fixture.manifest);
  value.attempt.artifactId = value.attempt.artifactId.toUpperCase();
  const started = deferred<void>();
  const release = deferred<void>();
  value.store.begin.mockImplementation(async () => {
    started.resolve();
    await release.promise;
    return ok(value.upload);
  });
  const pending = run(value);
  try {
    await reached(started.promise, pending);
    value.attempt.artifactId = "00000000-0000-4000-8000-000000000001";
    value.fixture.manifest.locale = "de";
    const category = value.fixture.manifest.categories[0];
    assert(category?.disposition === "include");
    const first = category.files[0];
    assert(first !== undefined);
    first.sha256 = "0".repeat(64);
    release.resolve();
    const result = await pending;
    assert(result.ok);
    expect(value.store.begin.mock.calls[0]?.[0]).toEqual(originalAttempt);
    const archive = await readArchive(value.sink.bytes());
    expect(JSON.parse(archive.get("manifest.json")?.toString("utf8") ?? "null")).toEqual(
      originalManifest,
    );
  } finally {
    release.resolve();
  }
});

test("P09B: a streamed checksum mismatch retains upload repair and never completes storage", async () => {
  const value = subject();
  const first = value.fixture.entries[0];
  assert(first !== undefined);
  first.body = Buffer.alloc(first.body.length, 1);
  const result = await run(value);
  expect(result).toEqual(
    err({
      phase: "archive",
      code: "entry_checksum_mismatch",
      repair: { attempt: value.attempt, upload: value.upload.ref },
    }),
  );
  expect(value.complete).not.toHaveBeenCalled();
  expect(value.sink.stream.destroyed).toBe(true);
});

test("C05: uncertain completion retains exact-attempt repair and is never retried", async () => {
  const value = subject();
  value.complete.mockResolvedValue(err("completion_uncertain"));
  expect(await run(value)).toEqual(
    err({
      phase: "complete",
      code: "completion_uncertain",
      repair: { attempt: value.attempt, upload: value.upload.ref },
    }),
  );
  expect(value.store.begin).toHaveBeenCalledTimes(1);
  expect(value.complete).toHaveBeenCalledTimes(1);
});

test("C06: cancellation after awaited completion rejects late success and destroys the owned sink", async () => {
  const value = subject();
  const controller = new AbortController();
  const started = deferred<void>();
  const release = deferred<void>();
  value.complete.mockImplementation(async (receipt) => {
    started.resolve();
    await release.promise;
    return ok({
      ...value.attempt,
      versionId: "synthetic-version",
      bytes: receipt.bytes,
      sha256: receipt.sha256,
    });
  });
  const pending = run(value, controller.signal);
  try {
    await reached(started.promise, pending);
    const reason = new DOMException("Synthetic stage cancellation", "AbortError");
    controller.abort(reason);
    release.resolve();
    await expect(pending).rejects.toBe(reason);
    expect(value.upload.sink.destroyed).toBe(true);
  } finally {
    release.resolve();
  }
});
