import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { writePrivacyExportArchive } from "./exportArchive";
import { archiveFixture, entrySources, hash, readArchive } from "./exportArchiveTestKit";
import { createExportObjectStore } from "./exportObjectStore";
import {
  objectKey,
  readBytes,
  type S3Fixture,
  startS3Fixture,
} from "./exportObjectStore.test-helpers";
import { createStorageDiagnostics } from "./exportObjectStoreDiagnostics.test-helpers";
import { exportStoreClient } from "./exportObjectStoreTransport";

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
      JSON.stringify({ diagnostic: "seaweed_core_fixture_readiness", ...readiness.snapshot() }),
    );
  }
});
const signal = () => AbortSignal.timeout(10_000);

test.each(["native", "bounded"] as const)(
  "SeaweedFS protocol qualification: %s transport multipart completion returns an exact version",
  async (transport) => {
    const client =
      transport === "native" ? fixture.client : exportStoreClient(fixture.config, signal());
    const key = "synthetic-protocol-check";
    const id = await client.initiateNewMultipartUpload(fixture.config.bucket, key, {});
    const part = await client.uploadPart(
      {
        bucketName: fixture.config.bucket,
        objectName: key,
        uploadID: id,
        partNumber: 1,
        headers: {},
      },
      Buffer.from("synthetic"),
    );
    const timer = new AbortController();
    try {
      const completed = await Promise.race([
        client.completeMultipartUpload(fixture.config.bucket, key, id, [
          { part: 1, etag: part.etag },
        ]),
        delay(4000, undefined, { signal: timer.signal }).then(() =>
          assert.fail("synthetic_completion_timeout"),
        ),
      ]);
      expect(completed.versionId).not.toBeNull();
    } finally {
      timer.abort();
    }
  },
);

test("P09A storage subset: real SeaweedFS S3 archive is private, versioned and integrity checked", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const store = created.value;
  const begun = await store.begin(store.allocate(), { maxBytes: 1024 * 1024 }, signal());
  assert(begun.ok);
  const data = archiveFixture();
  const codec = await writePrivacyExportArchive(
    data.manifest,
    entrySources(data.entries),
    begun.value.sink,
    signal(),
  );
  assert(codec.ok);
  const completed = await begun.value.complete(codec.value, signal());
  expect(completed.ok).toBe(true);
  assert(completed.ok);
  expect(completed.value.versionId.length).toBeGreaterThan(0);
  const opened = await store.open(completed.value, signal());
  assert(opened.ok);
  const bytes = await readBytes(opened.value);
  expect(hash(bytes)).toBe(codec.value.sha256);
  expect(bytes.length).toBe(codec.value.bytes);
  expect([...(await readArchive(bytes)).keys()].sort()).toEqual(
    ["manifest.json", ...data.entries.map((entry) => entry.path)].sort(),
  );
  const anonymous = await fetch(
    `${fixture.config.endpoint}/${fixture.config.bucket}/${objectKey(completed.value)}`,
    { signal: signal() },
  );
  expect(anonymous.status).toBe(403);
  await anonymous.body?.cancel();
  expect(await store.remove(completed.value, signal())).toEqual({
    ok: true,
    value: "absent_verified",
  });
  expect(await store.stat(completed.value, signal())).toEqual({
    ok: false,
    error: "object_missing",
  });
});

test("C05/C10: an unfinished sink or counterfeit codec receipt cannot complete an upload", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const store = created.value;
  const attempt = store.allocate();
  const begun = await store.begin(attempt, { maxBytes: 1024 }, signal());
  assert(begun.ok);
  const body = Buffer.from("synthetic-storage-bytes");
  const receipt = { format: "tar.gz" as const, bytes: body.length, sha256: hash(body), files: 0 };
  expect(await begun.value.complete(receipt, signal())).toEqual({
    ok: false,
    error: "upload_not_finished",
  });
  await pipeline(Readable.from([body]), begun.value.sink, { signal: signal() });
  expect(await begun.value.complete({ ...receipt, sha256: "0".repeat(64) }, signal())).toEqual({
    ok: false,
    error: "receipt_mismatch",
  });
  const inspected = await store.inspect(attempt, signal());
  assert(inspected.ok);
  expect(inspected.value.objects).toHaveLength(0);
  expect(inspected.value.uploads).toHaveLength(1);
  expect(await store.abort(begun.value.ref, signal())).toEqual({
    ok: true,
    value: "upload_absent_verified",
  });
});

test("C08: a storage byte quota stops writes and preserves an explicit incomplete upload for cleanup", async () => {
  const created = createExportObjectStore(fixture.config);
  assert(created.ok);
  const begun = await created.value.begin(created.value.allocate(), { maxBytes: 1 }, signal());
  assert(begun.ok);
  const data = archiveFixture();
  const encoded = await writePrivacyExportArchive(
    data.manifest,
    entrySources(data.entries),
    begun.value.sink,
    signal(),
  );
  expect(encoded).toEqual({ ok: false, error: "archive_write_failed" });
  expect(
    await begun.value.complete(
      { format: "tar.gz", bytes: 0, sha256: "0".repeat(64), files: 0 },
      signal(),
    ),
  ).toEqual({ ok: false, error: "quota_exceeded" });
  expect(await created.value.abort(begun.value.ref, signal())).toEqual({
    ok: true,
    value: "upload_absent_verified",
  });
});
