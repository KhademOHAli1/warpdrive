import { expect, it } from "vitest";
import { workflowRuns } from "@/db/schema";
import { retryWorkflowRun } from "./runRetry";
import { failLaterTask, retrySignal, setupRetryActor } from "./runRetry.test-helpers";

it("enforces complete receipts, one open failure and finite immutable failure facts in PostgreSQL", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await expect(
      h.pool.query("UPDATE workflow_run_failures SET retry_request_key=$1 WHERE id=$2", [
        crypto.randomUUID(),
        f.failure.id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "workflow_run_failure_retry_receipt_ck" });
    await expect(
      h.pool.query(
        "INSERT INTO workflow_run_failures(run_id,error_id,failed_at) VALUES($1,'E_PERM_001',clock_timestamp())",
        [f.run.id],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "workflow_run_open_failure_unique" });
    await expect(
      h.pool.query("UPDATE workflow_run_failures SET failed_at='infinity' WHERE id=$1", [
        f.failure.id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "workflow_run_failure_times_ck" });
    await expect(
      h.pool.query("UPDATE workflow_run_failures SET original_resume_at='infinity' WHERE id=$1", [
        f.failure.id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "workflow_run_failure_deadline_ck" });
    await expect(
      h.pool.query("UPDATE workflow_run_failures SET origin='invented_attempt' WHERE id=$1", [
        f.failure.id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "workflow_run_failure_origin_ck" });
    const foreignKeys = (
      await h.pool.query<{ confrelid: string; confdeltype: string }>(
        "SELECT confrelid::regclass::text,confdeltype FROM pg_constraint WHERE conrelid='workflow_run_failures'::regclass AND contype='f' ORDER BY confrelid::regclass::text",
      )
    ).rows;
    expect(foreignKeys).toEqual([
      { confrelid: "users", confdeltype: "a" },
      { confrelid: "workflow_runs", confdeltype: "a" },
    ]);
  } finally {
    await h.close();
  }
});

it("rejects client-selected authority and malformed commands without admitting a run", async () => {
  const h = await setupRetryActor();
  try {
    // A real DB fixture verifies this is the actual domain boundary. No run is
    // admitted; extra trusted-reference fields are never a serialized input.
    const raw = {
      runId: crypto.randomUUID(),
      failureId: crypto.randomUUID(),
      requestKey: crypto.randomUUID(),
      userId: h.user.id,
      sessionId: h.session.id,
    };
    expect(await retryWorkflowRun(h.db, h.who, raw, retrySignal())).toEqual({
      ok: false,
      error: "E_WORKFLOW_002",
    });
    expect(
      await retryWorkflowRun(h.db, h.who, { ...raw, runId: "invalid" }, retrySignal()),
    ).toEqual({ ok: false, error: "E_WORKFLOW_002" });
    expect(await h.db.select().from(workflowRuns)).toEqual([]);
  } finally {
    await h.close();
  }
});
