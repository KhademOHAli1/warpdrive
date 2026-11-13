import { build } from "esbuild";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PGBOSS_QUEUE_WORKFLOW_RUN } from "@/constants/jobNames";

const deps = vi.hoisted(() => ({ boss: null as PgBoss | null, send: vi.fn() }));
vi.mock("@/jobs/boss", () => ({ getBoss: () => deps.boss }));

import { enqueueWorkflowRun, nudgeWorkflowRun, nudgeWorkflowRunWithBoss } from "./queue";
import { enqueueWorkflowV2Run, nudgeWorkflowV2Run, WORKFLOW_V2_RUN_QUEUE } from "./v2/queue";

const runId = "663e4631-a1a7-4634-9ca5-b80f15e2b813";
const boss = { send: deps.send } as unknown as PgBoss;

beforeEach(() => {
  vi.resetAllMocks();
  deps.boss = null;
});
afterEach(() => vi.restoreAllMocks());

it("preserves the v1 wake/deadline singleton contract and a deduplicated null result", async () => {
  deps.send.mockResolvedValue(null);
  const deadline = new Date("2026-11-11T20:00:00.000Z");
  expect(await enqueueWorkflowRun(boss, runId, deadline)).toBeNull();
  expect(deps.send).toHaveBeenCalledExactlyOnceWith(
    PGBOSS_QUEUE_WORKFLOW_RUN,
    { runId },
    {
      retryLimit: 3,
      expireInSeconds: 60,
      singletonSeconds: 30,
      singletonKey: `${runId}:${deadline.getTime()}`,
      startAfter: deadline,
    },
  );
});

it("keeps immediate v1 admission distinct from v2's shorter singleton/retry contract", async () => {
  deps.boss = boss;
  await nudgeWorkflowRun(runId);
  await nudgeWorkflowV2Run(runId);
  expect(deps.send.mock.calls).toEqual([
    [
      PGBOSS_QUEUE_WORKFLOW_RUN,
      { runId },
      { retryLimit: 3, expireInSeconds: 60, singletonSeconds: 30, singletonKey: runId },
    ],
    [
      WORKFLOW_V2_RUN_QUEUE,
      { runId },
      { retryLimit: 2, expireInSeconds: 60, singletonSeconds: 1, singletonKey: runId },
    ],
  ]);
});

it("does not turn absent producer startup into a consumer or queue call", async () => {
  await nudgeWorkflowRun(runId);
  await nudgeWorkflowV2Run(runId);
  expect(deps.send).not.toHaveBeenCalled();
});

it("keeps persisted admission successful on queue outage without retaining the raw cause", async () => {
  deps.boss = boss;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  deps.send.mockRejectedValue(new Error("private queue connection detail"));
  await expect(nudgeWorkflowRun(runId)).resolves.toBeUndefined();
  await expect(nudgeWorkflowV2Run(runId)).resolves.toBeUndefined();
  await expect(nudgeWorkflowRunWithBoss(boss, runId)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private queue connection detail");
  await expect(enqueueWorkflowV2Run(boss, runId)).rejects.toThrow(
    "private queue connection detail",
  );
});

it.each(["src/features/workflows/queue.ts", "src/features/workflows/v2/queue.ts"])(
  "bundles producer %s without consumer/execution/provider modules",
  async (entry) => {
    const output = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      logLevel: "silent",
    });
    const permitted = new Set([entry, "src/jobs/boss.ts", "src/constants/jobNames.ts"]);
    expect(Object.keys(output.metafile.inputs).every((path) => permitted.has(path))).toBe(true);
    expect(Object.keys(output.metafile.inputs)).toContain("src/jobs/boss.ts");
  },
);
