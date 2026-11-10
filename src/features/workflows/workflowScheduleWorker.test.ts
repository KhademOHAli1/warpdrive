import { DrizzleQueryError } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { assert, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_WORKFLOW_SCHEDULE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import { registerWorkflowJobs } from "./worker";
import { dispatchWorkflowSchedules, workflowScheduleMaxPages } from "./workflowScheduleWorker";

const deps = vi.hoisted(() => ({ page: vi.fn(), admit: vi.fn() }));
vi.mock("./workflowSchedulePoll", () => ({ readDueScheduledWorkflowPage: deps.page }));
vi.mock("./workflowScheduleAdmission", () => ({ admitScheduledWorkflowOccurrence: deps.admit }));
vi.mock("./execution", () => ({ advanceWorkflowRun: vi.fn() }));

const db = {} as Db;
const signal = new AbortController().signal;
const scheduledAt = "2026-11-02T09:05:00.000Z";
const occurrence = {
  workflowId: "e0e3141a-aa0c-4892-90fa-42e5c977c498",
  versionId: "8f78a00d-6a65-4816-99a2-66c83f7756dd",
  scheduledAt,
};
const runId = "055bfb67-97e3-41d4-8c9d-12f58a2fb34b";

beforeEach(() => vi.resetAllMocks());

it("anchors every page to the original minute and nudges only admitted runs", async () => {
  const second = { ...occurrence, workflowId: "ff27287b-2f28-466f-a3e0-8738b2a0f7f0" };
  deps.page
    .mockResolvedValueOnce({
      occurrences: [occurrence, second],
      scheduledAt,
      nextAfterId: second.workflowId,
    })
    .mockResolvedValueOnce({
      occurrences: [],
      scheduledAt: "2026-11-02T09:06:00.000Z",
      nextAfterId: null,
    });
  const nudge = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  deps.admit.mockResolvedValueOnce(err(ERROR_IDS.WORKFLOW_CONFLICT)).mockImplementationOnce(() => {
    expect(nudge).not.toHaveBeenCalled();
    return Promise.resolve(ok(runId));
  });
  expect(await dispatchWorkflowSchedules(db, null, nudge, signal)).toBe(second.workflowId);
  expect(deps.page).toHaveBeenNthCalledWith(1, db, null, signal, undefined);
  expect(deps.page).toHaveBeenNthCalledWith(2, db, second.workflowId, signal, scheduledAt);
  expect(deps.admit).toHaveBeenNthCalledWith(1, db, occurrence, expect.any(Function), signal);
  expect(deps.admit).toHaveBeenNthCalledWith(2, db, second, expect.any(Function), signal);
  expect(nudge).toHaveBeenCalledExactlyOnceWith(runId);
});

it("caps the scan and hands the next invocation a forward cursor", async () => {
  const nudge = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  let pages = 0;
  deps.page.mockImplementation(() =>
    Promise.resolve({ occurrences: [], scheduledAt, nextAfterId: `cursor-${++pages}` }),
  );
  expect(await dispatchWorkflowSchedules(db, "prior-cursor", nudge, signal)).toBe(
    `cursor-${workflowScheduleMaxPages}`,
  );
  expect(deps.page).toHaveBeenCalledTimes(workflowScheduleMaxPages);
  expect(deps.page).toHaveBeenNthCalledWith(1, db, "prior-cursor", signal, undefined);
  expect(nudge).not.toHaveBeenCalled();
});

it("registers a private minutely queue and sanitizes stored job failures", async () => {
  const work = vi
    .fn<
      (name: string, handler: (jobs: { signal: AbortSignal }[]) => Promise<void>) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const createQueue = vi.fn().mockResolvedValue(undefined);
  const schedule = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(undefined);
  const boss = { createQueue, schedule, send, work } as unknown as PgBoss;
  await registerWorkflowJobs(boss, db);
  expect(createQueue).toHaveBeenCalledWith(PGBOSS_QUEUE_WORKFLOW_SCHEDULE);
  expect(schedule).toHaveBeenCalledWith(PGBOSS_QUEUE_WORKFLOW_SCHEDULE, "* * * * *");
  expect(send).toHaveBeenCalledWith(PGBOSS_QUEUE_WORKFLOW_SCHEDULE);
  const handler = work.mock.calls.find(([name]) => name === PGBOSS_QUEUE_WORKFLOW_SCHEDULE)?.[1];
  assert(handler !== undefined);
  const detail = "Private authored workflow value";
  deps.page.mockRejectedValueOnce(
    new DrizzleQueryError("SELECT definition", [detail], new Error("Connection lost")),
  );
  const error: unknown = await handler([{ signal }]).catch((reason: unknown) => reason);
  assert(error instanceof AppError);
  expect(error.id).toBe(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  expect(error.message).toBe("Workflow schedule scan failed");
  expect(error.stack).not.toContain(detail);
  expect(error.cause).toBeUndefined();
});
