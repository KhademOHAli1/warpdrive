import { DrizzleQueryError } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { assert, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { err } from "@/types/result";
import { advanceWorkflowRun } from "./execution";
import { registerWorkflowJobs } from "./worker";

vi.mock("./execution", () => ({ advanceWorkflowRun: vi.fn() }));

type RunJob = { data: { runId: string }; signal: AbortSignal };
const answer = "Synthetic private form answer";

it.each(["rejection", "result"] as const)(
  "exposes only the fixed workflow failure to pg-boss for an advance %s",
  async (failure) => {
    const advance = vi.mocked(advanceWorkflowRun);
    advance.mockReset();
    if (failure === "rejection") {
      advance.mockRejectedValueOnce(
        new DrizzleQueryError(
          "UPDATE workflow_runs SET outputs=$1",
          [answer],
          new Error("Database write interrupted"),
        ),
      );
    } else {
      advance.mockResolvedValueOnce(err(ERROR_IDS.WORKFLOW_INVALID));
    }
    const work = vi
      .fn<(name: string, handler: (jobs: RunJob[]) => Promise<void>) => Promise<void>>()
      .mockResolvedValue(undefined);
    const boss = {
      work,
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as PgBoss;
    await registerWorkflowJobs(boss, {} as Db);
    const run = work.mock.calls.find(([name]) => name === PGBOSS_QUEUE_WORKFLOW_RUN)?.[1];
    assert(run !== undefined);
    const error: unknown = await run([
      { data: { runId: crypto.randomUUID() }, signal: new AbortController().signal },
    ]).catch((reason: unknown) => reason);

    assert(error instanceof AppError);
    expect(error.id).toBe(ERROR_IDS.WORKFLOW_WRITE_FAILED);
    expect(error.message).toBe("Workflow advance failed");
    expect(error.stack).not.toContain(answer);
    expect(error.context).toBeUndefined();
    expect(error.cause).toBeUndefined();
    expect(error).not.toHaveProperty("params");
  },
);
