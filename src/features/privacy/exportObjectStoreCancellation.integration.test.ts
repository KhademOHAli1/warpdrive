import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { hash } from "./exportArchiveTestKit";
import {
  createExportObjectStore,
  type ExportAttemptRef,
  type ExportObjectStore,
} from "./exportObjectStore";
import { type S3Fixture, startS3Fixture } from "./exportObjectStore.test-helpers";
import { createStorageDiagnostics } from "./exportObjectStoreDiagnostics.test-helpers";
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
      JSON.stringify({
        diagnostic: "seaweed_cancellation_fixture_readiness",
        ...readiness.snapshot(),
      }),
    );
  }
});
const signal = () => AbortSignal.timeout(10_000);

async function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = new AbortController();
  try {
    return await Promise.race([
      operation,
      delay(timeoutMs, undefined, { signal: deadline.signal }).then(() =>
        assert.fail("synthetic_native_observation_deadline"),
      ),
    ]);
  } finally {
    deadline.abort();
  }
}

async function reconcileOwnedAttempt(store: ExportObjectStore, attempt: ExportAttemptRef) {
  const inspected = await store.inspect(attempt, signal());
  assert(inspected.ok, "synthetic_owned_attempt_inspection");
  for (const upload of inspected.value.uploads)
    expect(await store.abort(upload, signal())).toEqual({
      ok: true,
      value: "upload_absent_verified",
    });
  for (const object of inspected.value.objects)
    expect(await store.remove(object.ref, signal())).toEqual({
      ok: true,
      value: "absent_verified",
    });
  expect(await store.inspect(attempt, signal())).toEqual({
    ok: true,
    value: { objects: [], uploads: [] },
  });
}

test.each(["hold_complete", "hold_head"] as const)(
  "C06: original attempt cancellation disconnects native %s without completion replay",
  async (mode) => {
    const direct = createExportObjectStore(fixture.config);
    assert(direct.ok);
    const attempt = direct.value.allocate();
    const proxy = await startStorageProxy(fixture.config.endpoint, mode, signal());
    const controller = new AbortController();
    try {
      const created = createExportObjectStore({ ...fixture.config, endpoint: proxy.endpoint });
      assert(created.ok);
      const body = Buffer.from("synthetic-pending-completion-cancellation");
      const begun = await created.value.begin(
        attempt,
        { maxBytes: body.length },
        controller.signal,
      );
      assert(begun.ok);
      await pipeline(Readable.from([body]), begun.value.sink, { signal: controller.signal });
      const receipt = {
        format: "tar.gz" as const,
        files: 0,
        bytes: body.length,
        sha256: hash(body),
      };
      const completed = begun.value.complete(receipt, signal()).then(
        (result) => ({ state: "resolved" as const, result }),
        (reason: unknown) => ({ state: "rejected" as const, reason }),
      );
      await within(
        Promise.race([
          proxy.reached,
          completed.then(() => assert.fail("synthetic_completion_before_gate")),
        ]),
        3000,
      );
      const reason = new DOMException("Synthetic original attempt cancellation", "AbortError");
      controller.abort(reason);
      // Keep the gate closed so the three-second request deadline cannot stand in for abort.
      const [settled] = await within(Promise.all([completed, proxy.disconnected]), 1000);
      expect(settled.state).toBe("rejected");
      assert(settled.state === "rejected");
      expect(settled.reason).toBe(reason);
      expect(proxy.counts().completeRequests).toBe(1);
      await expect(begun.value.complete(receipt, signal())).rejects.toBe(reason);
      expect(proxy.counts().completeRequests).toBe(1);
      const inspected = await direct.value.inspect(attempt, signal());
      assert(inspected.ok);
      if (mode === "hold_complete") {
        expect(inspected.value.objects).toHaveLength(0);
        expect(inspected.value.uploads).toHaveLength(1);
      } else {
        // Accepted completion can survive cancellation and requires separate version cleanup.
        expect(inspected.value.objects).toHaveLength(1);
        expect(inspected.value.uploads).toHaveLength(0);
      }
    } finally {
      controller.abort();
      try {
        await proxy.close();
      } finally {
        await reconcileOwnedAttempt(direct.value, attempt);
      }
    }
  },
);
