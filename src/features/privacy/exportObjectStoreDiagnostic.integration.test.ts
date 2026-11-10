import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { expect, test } from "vitest";
import { createExportObjectStore } from "./exportObjectStore";
import { objectKey, type S3Fixture, startS3Fixture } from "./exportObjectStore.test-helpers";
import {
  createStorageDiagnostics,
  diagnosticErrorKind,
} from "./exportObjectStoreDiagnostics.test-helpers";
import { ExportMultipartSink } from "./exportObjectStoreParts";
import { storeErrorCode } from "./exportObjectStoreTransport";

type Diagnostics = ReturnType<typeof createStorageDiagnostics>;
type Outcome = {
  stage: "readiness_failed" | "metadata_failed" | "part_failed" | "part_staged";
  errorKind?: ReturnType<typeof diagnosticErrorKind>;
  cleanup: "not_created" | "aborted" | "already_absent" | "failed";
  fixtureCleanup: "not_returned" | "stopped" | "failed";
};

async function cleanupDiagnosticUpload(
  fixture: S3Fixture,
  key: string,
  uploadId: string | undefined,
  diagnostics: Diagnostics,
  signal: AbortSignal,
): Promise<Outcome["cleanup"]> {
  try {
    const cleanup = diagnostics.client(fixture.config, signal);
    if (uploadId === undefined) {
      const listed = await cleanup.listIncompleteUploadsQuery(
        fixture.config.bucket,
        key,
        "",
        "",
        "",
      );
      const exact = listed.uploads.filter((item) => item.key === key);
      assert(!listed.isTruncated && exact.length <= 1, "synthetic_cleanup_locator");
      uploadId = exact[0]?.uploadId;
    }
    if (uploadId === undefined) return "already_absent";
    await cleanup.abortMultipartUpload(fixture.config.bucket, key, encodeURIComponent(uploadId));
    return "aborted";
  } catch (cause) {
    return storeErrorCode(cause) === "NoSuchUpload" ? "already_absent" : "failed";
  }
}

// Temporary investigation, not a new acceptance gate. One cold write, no completion.
test("TEMP diagnostic: first bounded small part against a fresh SeaweedFS fixture", async () => {
  const body = Buffer.from("synthetic-cold-small-part");
  const diagnostics = createStorageDiagnostics(body);
  const outcome: Outcome = {
    stage: "readiness_failed",
    cleanup: "not_created",
    fixtureCleanup: "not_returned",
  };
  let fixture: S3Fixture | undefined;
  let key: string | undefined;
  let uploadId: string | undefined;
  let initiationIssued = false;
  const startupDeadlineMs = performance.now() + 60_000;
  const startupSignal = AbortSignal.timeout(60_000);
  try {
    fixture = await startS3Fixture({
      observeLogs: diagnostics.observeLogs,
      diagnosticLogToStderr: true,
    });
    const readiness = await diagnostics.readiness.wait(
      fixture.container,
      startupDeadlineMs,
      startupSignal,
    );
    assert.equal(readiness.state, "ready", "synthetic_provider_readiness");
    outcome.stage = "metadata_failed";
    assert.equal(fixture.config.requestTimeoutMs, 3000);
    const store = createExportObjectStore(fixture.config);
    assert(store.ok);
    key = objectKey(store.value.allocate());
    const operation = AbortSignal.timeout(10_000);
    const client = diagnostics.client(fixture.config, operation);
    const versioning = await client.getBucketVersioning(fixture.config.bucket);
    assert.equal(versioning.Status, "Enabled");
    initiationIssued = true;
    uploadId = await client.initiateNewMultipartUpload(fixture.config.bucket, key, {
      "Content-Type": "application/gzip",
      "Cache-Control": "no-store",
    });
    outcome.stage = "part_failed";
    const sink = new ExportMultipartSink(
      client,
      fixture.config.bucket,
      key,
      uploadId,
      body.length,
      operation,
    );
    await pipeline(Readable.from([body]), sink, { signal: operation });
    assert.equal(sink.failure, null);
    assert.equal(sink.writableFinished, true);
    assert.equal(sink.parts.length, 1);
    assert.deepEqual(sink.digest, {
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    outcome.stage = "part_staged";
  } catch (cause) {
    outcome.errorKind = diagnosticErrorKind(cause);
  } finally {
    if (fixture !== undefined && key !== undefined && initiationIssued) {
      outcome.cleanup = await cleanupDiagnosticUpload(
        fixture,
        key,
        uploadId,
        diagnostics,
        AbortSignal.timeout(4000),
      );
    }
    if (fixture !== undefined) {
      try {
        await fixture.container.stop();
        outcome.fixtureCleanup = "stopped";
      } catch {
        outcome.fixtureCleanup = "failed";
      }
    }
    console.warn(
      JSON.stringify({
        diagnostic: "seaweed_cold_small_part",
        requestTimeoutMs: 3000,
        bodyBytes: body.length,
        outcome,
        ...diagnostics.snapshot(),
      }),
    );
  }
  expect(outcome.stage).toBe("part_staged");
  expect(diagnostics.snapshot().readiness.state).toBe("ready");
  expect(["aborted", "already_absent"]).toContain(outcome.cleanup);
  expect(outcome.fixtureCleanup).toBe("stopped");
  const delivery = diagnostics.snapshot().logDelivery;
  expect(delivery.consumersAttached).toBe(1);
  expect(delivery.dataChunks + delivery.errChunks).toBeGreaterThan(0);
  expect(delivery.bytes).toBeGreaterThan(0);
  expect(delivery.completeLines).toBeGreaterThan(0);
  expect(delivery.matchedLines).toBeGreaterThan(0);
}, 90_000);
