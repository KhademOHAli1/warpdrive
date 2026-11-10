import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { readPrivacyReviewerCase } from "./reviewerCase";
import {
  finishReviewerCaseBarrier,
  type HeldReviewerCase,
  holdReviewerCase,
  observeReviewerCase,
  observeReviewerCaseWait,
  type ReviewerCaseOutcome,
  waitReviewerSessionExpiry,
} from "./reviewerCase.barrier.test-helpers";
import { reviewerCaseFixture, reviewerCaseSnapshot } from "./reviewerCase.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

test("C03: reviewer session expiry during the actual case-row wait denies before intake disclosure", async ({
  signal,
}) => {
  const f = await reviewerCaseFixture(h);
  await authorityFixture(h, ["case.review"]);
  const applicationName = `privacy-reviewer-case-${randomUUID()}`;
  const readerPool = new Pool({
    connectionString: h.url,
    application_name: applicationName,
    max: 1,
    connectionTimeoutMillis: 1000,
    statement_timeout: 6000,
  });
  let holder: HeldReviewerCase | undefined;
  let outcome: Promise<ReviewerCaseOutcome> | undefined;
  let before: unknown;
  let primary: { error: unknown } | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  try {
    holder = await holdReviewerCase(h, f.privacyCase.id);
    await h.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=$1",
      [f.session.id],
    );
    before = await reviewerCaseSnapshot(h);
    outcome = observeReviewerCase(
      readPrivacyReviewerCase(
        drizzle(readerPool, { schema }),
        f.actor,
        { caseId: f.privacyCase.id },
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      ),
    );
    const barrier = await observeReviewerCaseWait(h, applicationName, holder.pid, outcome, signal);
    assert(
      barrier.kind !== "setup_deadline",
      "SETUP/TIMING: no case-row lock wait observed within two seconds",
    );
    assert(
      barrier.kind === "waiting",
      "BEHAVIOR: reader settled before reaching the native case-row barrier",
    );
    expect(barrier.readerPid).not.toBe(holder.pid);
    const active = await h.pool.query<{ active: boolean }>(
      "SELECT clock_timestamp()<expires_at AS active FROM sessions WHERE id=$1",
      [f.session.id],
    );
    assert(
      active.rows[0]?.active === true,
      "SETUP/TIMING: native reviewer session expired before the wait was observed",
    );
    await waitReviewerSessionExpiry(h, f.session.id, signal);
    await holder.finish();
    const result = await Promise.race([
      outcome,
      delay(2500, { status: "deadline" } as const, { ref: false }),
    ]);
    expect(result, "BEHAVIOR: released case-row wait must settle to an authority denial").toEqual({
      status: "resolved",
      value: { ok: false, error: "forbidden" },
    });
  } catch (error) {
    primary = { error };
  } finally {
    try {
      await finishReviewerCaseBarrier(holder, outcome, readerPool);
    } catch (error) {
      cleanupFailure = { error };
    }
  }
  let stateFailure: { error: unknown } | undefined;
  if (before !== undefined) {
    try {
      expect(await reviewerCaseSnapshot(h)).toEqual(before);
    } catch (error) {
      stateFailure = { error };
    }
  }
  const failures = [primary, cleanupFailure, stateFailure].filter(
    (failure): failure is { error: unknown } => failure !== undefined,
  );
  if (failures.length > 1)
    throw new AggregateError(
      failures.map((failure) => failure.error),
      "Reviewer-case assertion, cleanup or durable-state controls failed",
    );
  if (primary !== undefined) throw primary.error;
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
  if (stateFailure !== undefined) throw stateFailure.error;
});
