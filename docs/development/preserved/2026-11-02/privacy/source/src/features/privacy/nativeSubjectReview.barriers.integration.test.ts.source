import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import {
  durableSubjectReviewSnapshot,
  finishSourceReviewBarrier,
  holdContactSource,
  observeSourceWaitOrOutcome,
  observeSubjectReview,
  type ReviewOutcome,
  waitForNativeSessionExpiry,
} from "./nativeSubjectReview.barrier.test-helpers";
import { subjectReviewFixture } from "./nativeSubjectReview.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

for (const boundary of ["session expiry", "committed source growth"] as const)
  test(`C03/C11: native ${boundary} is checked after the actual source lock wait`, async ({
    signal,
  }) => {
    const f = await subjectReviewFixture(h);
    const source = await holdContactSource(h, f.contact.id, boundary === "committed source growth");
    const applicationName = `privacy-native-subject-${randomUUID()}`;
    const pool = new Pool({
      connectionString: h.url,
      application_name: applicationName,
      max: 1,
      connectionTimeoutMillis: 1000,
      statement_timeout: 10000,
    });
    let outcome: Promise<ReviewOutcome> | undefined;
    let primary: { error: unknown } | undefined;
    let cleanupFailure: { error: unknown } | undefined;
    const before = await durableSubjectReviewSnapshot(h, f);
    try {
      if (boundary === "session expiry") {
        await h.pool.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",
          [f.reviewer.session.id],
        );
      }
      outcome = observeSubjectReview(
        loadPrivacyNativeSubjectReview(
          drizzle(pool, { schema }),
          f.reviewer.actor,
          { caseId: f.privacyCase.id },
          AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        ),
      );
      const barrier = await observeSourceWaitOrOutcome(
        h,
        applicationName,
        source.pid,
        outcome,
        signal,
      );
      assert(
        barrier.kind !== "setup_deadline",
        "SETUP/TIMING: no source lock wait observed within two seconds",
      );
      // An immediate scaffold denial fails this behavior assertion, not the observation deadline.
      assert(
        barrier.kind === "waiting",
        "BEHAVIOR: loader settled before reaching the native source lock barrier",
      );
      expect(barrier.readerPid).not.toBe(source.pid);
      if (boundary === "session expiry") {
        const current = await h.pool.query<{ active: boolean }>(
          "SELECT clock_timestamp()<expires_at AS active FROM sessions WHERE id=$1",
          [f.reviewer.session.id],
        );
        assert(
          current.rows[0]?.active === true,
          "SETUP/TIMING: fixture expired before the native source wait was observed",
        );
        await waitForNativeSessionExpiry(h, f.reviewer.session.id, signal);
        await source.finish("ROLLBACK");
      } else await source.finish("COMMIT");
      const result = await Promise.race([
        outcome,
        delay(2500, { status: "deadline" } as const, { ref: false }),
      ]);
      expect(result, "BEHAVIOR: action must settle after the owned source holder releases").toEqual(
        {
          status: "resolved",
          value: { ok: false, error: boundary === "session expiry" ? "forbidden" : "source_limit" },
        },
      );
    } catch (error) {
      primary = { error };
    } finally {
      try {
        await finishSourceReviewBarrier(source, outcome, pool);
      } catch (error) {
        cleanupFailure = { error };
      }
    }
    let stateFailure: { error: unknown } | undefined;
    try {
      expect(await durableSubjectReviewSnapshot(h, f)).toEqual(before);
    } catch (error) {
      stateFailure = { error };
    }
    const failures = [primary, cleanupFailure, stateFailure].filter(
      (failure): failure is { error: unknown } => failure !== undefined,
    );
    if (failures.length > 1)
      throw new AggregateError(
        failures.map((failure) => failure.error),
        "Native review primary assertion, cleanup or durable-state controls failed",
      );
    if (primary !== undefined) throw primary.error;
    if (cleanupFailure !== undefined) throw cleanupFailure.error;
    if (stateFailure !== undefined) throw stateFailure.error;
  });
