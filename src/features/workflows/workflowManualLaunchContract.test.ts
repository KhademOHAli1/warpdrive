import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { executeRunNode } from "./runActions";
import { admitManualRun } from "./runAdmission";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  prepareWorkflowManualLaunch,
  readWorkflowManualLaunch,
  type WorkflowManualLaunchPayload,
  workflowManualLaunchScope,
} from "./workflowManualLaunchContract";

const native = vi.hoisted(() => ({ hydrateActor: vi.fn() }));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: native.hydrateActor }));

const actor: PermSetUser = {
  id: "98bf8a5d-8d59-4764-81c9-c6f377ff6fb1",
  type: "regular",
  isActive: true,
  flags: new Set(["workflow.run"]),
  groupIds: new Set(),
};
const workflowId = "4f80b032-4523-4bac-93a8-8e4d9b5d5415";
const runId = "f0df04d5-0b55-478f-a7fa-503990c983c8";
const recordId = "10110795-F2B1-4933-9DFE-A742AB9B44DC";
const command = { workflowId, requestKey: "7f170840-3d5c-44bb-8f82-d00af92f161e", mode: "live" };
const signal = new AbortController().signal;
const deal: WorkflowNode = {
  id: "start",
  type: "trigger.manual",
  version: 1,
  name: "Launch manually",
  config: {},
};
const global: WorkflowNode = { ...deal, config: { scope: "global" } };
const definition = (node: WorkflowNode): WorkflowDefinition => ({
  schemaVersion: 1,
  nodes: [node],
  edges: [],
});
const dealVersion = {
  id: "e159db31-1950-4415-9c40-c7262d877ef8",
  number: 1,
  definition: definition(deal),
};
const globalVersion = {
  id: "05740170-2d63-43fd-8951-582548752f69",
  number: 2,
  definition: definition(global),
};
type Version = typeof dealVersion;

beforeEach(() => {
  native.hydrateActor.mockResolvedValue(actor);
});

function database(
  current: Version,
  existing?: { id: string; versionId: string; mode: string; trigger: WorkflowManualLaunchPayload },
  pinned?: Version,
) {
  const versions = [current, pinned];
  const lock = vi.fn();
  const select = () => ({
    from: (table: object) => ({
      where: () => {
        const rows = new Map<object, unknown>([
          [
            workflows,
            { id: workflowId, ownerId: actor.id, active: true, publishedNumber: current.number },
          ],
          [workflowRuns, existing],
        ]);
        const row = table === workflowVersions ? versions.shift() : rows.get(table);
        const result = Promise.resolve(row === undefined ? [] : [row]);
        return Object.assign(result, {
          for: (mode: string) => {
            lock(table, mode);
            return result;
          },
        });
      },
    }),
  });
  const insert = vi.fn((row: typeof workflowRuns.$inferInsert) => ({
    returning: () => Promise.resolve([{ id: runId, ...row }]),
  }));
  const tx = { select, insert: () => ({ values: insert }) } as unknown as Db;
  const db = {
    transaction: (operation: (transaction: Db) => Promise<unknown>) => operation(tx),
  } as unknown as Db;
  return { db, insert, lock };
}

it("requires the exact payload shape appropriate to the explicit pinned scope", () => {
  expect(workflowManualLaunchScope({})).toBe("deal");
  expect(workflowManualLaunchScope({ scope: "global" })).toBe("global");
  expect(workflowManualLaunchScope({ scope: "deal" })).toBeNull();
  expect(prepareWorkflowManualLaunch(deal.config, recordId)).toEqual({ recordId });
  expect(prepareWorkflowManualLaunch(deal.config, undefined)).toBeNull();
  expect(prepareWorkflowManualLaunch(global.config, undefined)).toEqual({ scope: "global" });
  expect(prepareWorkflowManualLaunch(global.config, recordId)).toBeNull();
  for (const invalid of [null, {}, { scope: "global", recordId }, { recordId, extra: true }]) {
    expect(readWorkflowManualLaunch(globalVersion.definition, invalid)).toBeNull();
    expect(readWorkflowManualLaunch(dealVersion.definition, invalid)).toBeNull();
  }
  expect(
    readWorkflowManualLaunch({ nodes: [deal, { ...global, id: "another" }] }, { scope: "global" }),
  ).toBeNull();
});

it.each([
  { current: dealVersion, selected: { recordId }, launch: { recordId } },
  { current: globalVersion, selected: {}, launch: { scope: "global" } },
])(
  "admits the published trigger for $current.number with its original JSON shape",
  async ({ current, selected, launch }) => {
    const test = database(current);
    const run = await admitManualRun(
      test.db,
      actor,
      { ...command, ...selected, reviewedVersionId: current.id },
      signal,
    );
    expect(run).toMatchObject({ ok: true, value: { trigger: launch, versionId: current.id } });
    expect(test.lock).toHaveBeenCalledExactlyOnceWith(workflows, "update");
    expect(test.insert).toHaveBeenCalledOnce();
  },
);

it.each([
  { current: dealVersion, selected: {} },
  { current: globalVersion, selected: { recordId } },
  { current: globalVersion, selected: { scope: "global" } },
])(
  "rejects a missing, unexpected, or forged selection before inserting",
  async ({ current, selected }) => {
    const test = database(current);
    expect(await admitManualRun(test.db, actor, { ...command, ...selected }, signal)).toEqual(
      err(ERROR_IDS.WORKFLOW_INVALID),
    );
    expect(test.insert).not.toHaveBeenCalled();
  },
);

it("replays the original Deal command after Global is published", async () => {
  const original = {
    id: runId,
    versionId: dealVersion.id,
    workflowId,
    mode: "live",
    trigger: { recordId },
  };
  const test = database(globalVersion, original, dealVersion);
  expect(
    await admitManualRun(
      test.db,
      actor,
      { ...command, recordId, reviewedVersionId: dealVersion.id },
      signal,
    ),
  ).toEqual(ok(original));
  expect(test.insert).not.toHaveBeenCalled();
});

it("refuses a forged Global replay for a Deal-pinned run", async () => {
  const original = {
    id: runId,
    versionId: dealVersion.id,
    workflowId,
    mode: "live",
    trigger: { scope: "global" as const },
  };
  const test = database(globalVersion, original, dealVersion);
  expect(await admitManualRun(test.db, actor, command, signal)).toEqual(
    err(ERROR_IDS.WORKFLOW_CONFLICT),
  );
  expect(test.insert).not.toHaveBeenCalled();
});

it("emits an empty Global output and keeps the Deal trigger output unchanged", async () => {
  const db = {} as Db;
  const run = (node: WorkflowNode, payload: WorkflowManualLaunchPayload) =>
    executeRunNode(db, actor, node, {}, payload, false, definition(node), signal);
  expect(await run(global, { scope: "global" })).toEqual(ok({}));
  expect(await run(deal, { recordId })).toEqual(ok({ recordId }));
  expect(await run(deal, { scope: "global" })).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(await run(global, { recordId })).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
});
