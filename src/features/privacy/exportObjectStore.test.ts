import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { createExportObjectStore } from "./exportObjectStore";
import { attemptRefSchema, exportObjectKey, objectRefSchema } from "./exportObjectStoreRefs";

const config = {
  endpoint: "http://127.0.0.1:1",
  accessKey: "synthetic-access",
  secretKey: "synthetic-secret",
  bucket: "synthetic-private",
  requestTimeoutMs: 1000,
};

test("C10: store configuration rejects URL credentials, paths and non-HTTP endpoints", () => {
  for (const endpoint of [
    "https://secret@example.com",
    "https://example.com/path",
    "ftp://example.com",
  ]) {
    expect(createExportObjectStore({ ...config, endpoint })).toEqual({
      ok: false,
      error: "invalid_store_config",
    });
  }
});

test("C01: caller object keys cannot cross the generated artifact reference boundary", async () => {
  const created = createExportObjectStore(config);
  assert(created.ok);
  const result = await created.value.stat(
    { artifactId: "not-a-uuid", attemptId: "not-a-uuid", versionId: "version" },
    AbortSignal.timeout(1000),
  );
  expect(result).toEqual({ ok: false, error: "invalid_object_ref" });
});

test("C06: an already-aborted operation propagates cancellation before a network effect", async () => {
  const created = createExportObjectStore(config);
  assert(created.ok);
  await expect(
    created.value.begin(created.value.allocate(), { maxBytes: 1024 }, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("C11: UUID references keep the same object key after PostgreSQL canonicalizes their spelling", () => {
  const artifactId = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
  const attemptId = "FEDCBAFE-DCBA-4FED-8CBA-FEDCBAFEDCBA";
  const parsed = attemptRefSchema.safeParse({ artifactId, attemptId });
  assert(parsed.success);
  expect(exportObjectKey(parsed.data)).toBe(
    `privacy-exports/v1/${artifactId.toLowerCase()}/${attemptId.toLowerCase()}.tar.gz`,
  );
});

test("C05: the mutable S3 null-version sentinel is never an immutable export version", () => {
  const ref = {
    artifactId: "00000000-0000-4000-8000-000000000001",
    attemptId: "00000000-0000-4000-8000-000000000002",
    versionId: "null",
  };
  expect(objectRefSchema.safeParse(ref).success).toBe(false);
});
