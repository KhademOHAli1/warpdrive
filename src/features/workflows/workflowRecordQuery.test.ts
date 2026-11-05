import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { pickWorkflowRecord } from "./workflowRecordPick";
import { searchWorkflowRecords } from "./workflowRecordQuery";
import { boundedRecordLookupConfig } from "./workflowRecordQueryBounds";
import {
  recordPickConfig,
  recordSearchBindingTarget,
  recordSearchConfig,
} from "./workflowRecordQueryContract";

const one = "af198b82-93d9-42b0-a48c-31a21390e161";
const two = "c72da16c-ab29-4ee8-8417-89c4f69dcb65";
const hidden = "f120bd54-379e-4df5-a588-e526f62848c7";
const actor: PermSetUser = {
  id: "1bf8175d-07a4-4867-9bea-0517a8a8f156",
  type: "regular",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
};
const workflowId = "8e9d011d-9bed-49a7-a89d-094fdf76080b";
const groupId = "17c27991-5b54-484f-a90d-919b36431c0a";
const entryId = "9dc89009-dfc1-4f78-83eb-aa20aef43b88";
const clock = "2030-03-20T12:30:00.000Z";
const signal = new AbortController().signal;
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [], edges: [] };
const draft = (config: WorkflowNode["config"]) => ({ id: "lookup", version: 1 as const, config });
const person = (id: string, name: string) => ({ id, name, createdAt: clock, updatedAt: clock });
const deal = {
  id: one,
  title: "Visible deal",
  value: "100.50",
  currency: "EUR",
  expectedCloseDate: "2030-03-24",
  status: "open",
  createdAt: clock,
  updatedAt: clock,
};
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };

function database(...results: unknown[][]) {
  const execute = vi.fn<(statement: SQL) => Promise<{ rows: unknown[] }>>();
  for (const rows of results) execute.mockResolvedValueOnce({ rows });
  const db = { execute } as unknown as Db;
  return {
    db,
    execute,
    queries: () => execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement)),
  };
}

function filter(field: string, operator: string, value?: WorkflowNode["config"][string]) {
  return {
    kind: "group",
    id: groupId,
    combinator: "and",
    entries: [
      {
        kind: "condition",
        id: entryId,
        field,
        operator,
        ...(value === undefined ? {} : { value }),
      },
    ],
  };
}

it("searches a filtered, authorized page, applies a stable tie-break, and returns only reviewed fields", async () => {
  const needle = "x%_'); SELECT secret FROM users; --";
  const test = database([
    {
      records: [
        { ...deal, note: "private note", personId: hidden, customFields: { private: true } },
      ],
      totalCount: "24",
    },
  ]);
  const node = draft({
    entity: "deal",
    filter: filter("title", "contains", { kind: "value", value: needle }),
    orderBy: [{ field: "expectedCloseDate", direction: "desc" }],
    limit: { kind: "value", value: 5 },
    offset: { kind: "value", value: 4 },
  });
  expect(await searchWorkflowRecords(test.db, actor, node, {}, definition, signal)).toEqual({
    ok: true,
    value: { first: deal, all: [deal], firstId: one, totalCount: 24 },
  });
  const [query] = test.queries();
  expect(query?.sql).toMatch(/JOIN pipelines p[\s\S]*p\.is_archived = false/);
  expect(query?.sql).toContain('"d"."deleted_at" IS NULL');
  expect(query?.sql).toContain('"d"."expected_close_date" DESC NULLS LAST, "d"."id" ASC');
  expect(query?.sql).toContain("strpos(");
  expect(query?.sql).not.toContain(needle);
  expect(query?.params).toEqual(expect.arrayContaining([needle, 5, 4]));
  expect(query?.sql).not.toMatch(/custom_fields|primary_email|video_call_url/);
});

it("returns the full visible count even when an offset page is empty", async () => {
  const test = database([{ records: [], totalCount: "2" }]);
  const node = draft({ entity: "lead", offset: { kind: "value", value: 5 } });
  expect(await searchWorkflowRecords(test.db, actor, node, {}, definition, signal)).toEqual({
    ok: true,
    value: { first: null, all: [], firstId: null, totalCount: 2 },
  });
  expect(test.queries()[0]?.params).toEqual(expect.arrayContaining([1, 5]));
});

it("builds grouped expressions and refuses unsupported fields, sorts, and bounds before reading", async () => {
  const nested = {
    kind: "group",
    id: groupId,
    combinator: "or",
    entries: [
      { kind: "condition", id: entryId, field: "value", operator: "isEmpty" },
      {
        kind: "group",
        id: "7205f875-081f-40ba-a224-d0ce7faea4a2",
        combinator: "and",
        entries: [
          {
            kind: "condition",
            id: "248dc717-533d-44ad-a890-3fd7ece9c5d4",
            field: "value",
            operator: "greaterThan",
            value: { kind: "value", value: "10.00" },
          },
        ],
      },
    ],
  };
  const test = database([{ records: [], totalCount: "0" }]);
  expect(
    (
      await searchWorkflowRecords(
        test.db,
        actor,
        draft({ entity: "deal", filter: nested }),
        {},
        definition,
        signal,
      )
    ).ok,
  ).toBe(true);
  expect(test.queries()[0]?.sql).toMatch(/\("d"\."value" IS NULL\) OR \("d"\."value" > \$\d+\)/);
  const invalidInputs: WorkflowNode["config"][] = [
    { entity: "person", filter: filter("value", "equals", { kind: "value", value: "10" }) },
    { entity: "deal", filter: filter("value", "contains", { kind: "value", value: "1" }) },
    { entity: "deal", orderBy: [{ field: "title; DROP TABLE deals", direction: "asc" }] },
    { entity: "deal", limit: { kind: "value", value: 101 } },
    { entity: "deal", offset: { kind: "value", value: -1 } },
  ];
  for (const config of invalidInputs)
    expect(
      await searchWorkflowRecords(test.db, actor, draft(config), {}, definition, signal),
    ).toEqual(invalid);
  expect(test.execute).toHaveBeenCalledTimes(1);
});

it("bounds recursive drafts and gives only exact typed mapping paths", () => {
  const circular = { kind: "group", id: groupId, combinator: "and", entries: [] as unknown[] };
  circular.entries.push(circular);
  expect(boundedRecordLookupConfig({ entity: "deal", filter: circular })).toBe(false);
  expect(recordSearchConfig.safeParse({ entity: "deal", filter: circular }).success).toBe(false);
  const cfg = recordSearchConfig.parse({
    entity: "deal",
    filter: filter("expectedCloseDate", "equals", {
      kind: "reference",
      nodeId: "read",
      path: ["expectedCloseDate"],
    }),
  });
  expect(
    recordSearchBindingTarget("lookup", cfg, ["filter", "entries", "0", "value"]),
  ).toMatchObject({ contract: { kind: "date", nullable: false }, required: true });
  expect(recordSearchBindingTarget("lookup", cfg, ["filter.entries.0.value"])).toBeUndefined();
  expect(recordSearchBindingTarget("lookup", cfg, ["limit"])).toMatchObject({
    contract: { kind: "number" },
    acceptedKinds: ["number", "decimal"],
  });
});

it("uses only current visible candidates and rejects unsupported selection configuration", async () => {
  const test = database([], [{ record: person(two, "Visible person") }]);
  const node = draft({ entity: "person", strategy: "RANDOM", recordIds: [hidden, two] });
  const run = { workflowId, simulation: false };
  expect(await pickWorkflowRecord(test.db, actor, node, run, signal)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
  expect(await pickWorkflowRecord(test.db, actor, node, run, signal)).toEqual({
    ok: true,
    value: person(two, "Visible person"),
  });
  expect(test.queries()[0]?.sql).toMatch(
    /FROM persons r[\s\S]*"r"\."deleted_at" IS NULL[\s\S]*ORDER BY "r"\."id" ASC/,
  );
  expect(
    recordPickConfig.safeParse({
      entity: "person",
      strategy: "RANDOM",
      recordIds: [one, one.toUpperCase()],
    }).success,
  ).toBe(false);
  expect(
    recordPickConfig.safeParse({
      entity: "person",
      strategy: "LOAD_BALANCED",
      recordIds: [one],
      loadBalance: { entity: "activity", field: "dealId" },
    }).success,
  ).toBe(false);
});

it("locks the same live node rotation before counting receipts and leaves simulation unconsumed", async () => {
  const a = person(one, "A");
  const b = person(two, "B");
  const test = database(
    [],
    [{ record: a }, { record: b }],
    [{ count: "1" }],
    [{ record: a }, { record: b }],
    [{ count: "1" }],
  );
  const node = draft({ entity: "person", strategy: "ROUND_ROBIN", recordIds: [two, one] });
  const profile = "record.pick:1:person:ROUND_ROBIN";
  expect(
    await pickWorkflowRecord(test.db, actor, node, { workflowId, simulation: false }, signal),
  ).toEqual({ ok: true, value: { ...b, __pickProfile: profile } });
  expect(
    await pickWorkflowRecord(test.db, actor, node, { workflowId, simulation: true }, signal),
  ).toEqual({ ok: true, value: b });
  const [lock, , live, simulationCandidates, simulation] = test.queries();
  expect(lock?.sql).toContain("pg_advisory_xact_lock");
  expect(lock?.params).toEqual([`workflow-pick:${workflowId}:lookup:${profile}`]);
  expect(live?.sql).toContain("r.mode = 'live' AND s.simulated = false");
  expect(live?.params).toEqual([workflowId, "lookup", profile]);
  expect(simulationCandidates?.sql).not.toContain("pg_advisory");
  expect(simulation).toEqual(live);
});

it("counts only visible related tasks against visible candidates and resolves ties by UUID order", async () => {
  const a = person(one, "A");
  const b = person(two, "B");
  const records = [{ record: a }, { record: b }];
  const test = database(records, [{ id: one, count: "4" }], records, []);
  const node = draft({
    entity: "person",
    strategy: "LOAD_BALANCED",
    recordIds: [two, hidden, one],
    loadBalance: { entity: "activity", field: "personId" },
  });
  const run = { workflowId, simulation: false };
  expect(await pickWorkflowRecord(test.db, actor, node, run, signal)).toEqual({
    ok: true,
    value: b,
  });
  expect(await pickWorkflowRecord(test.db, actor, node, run, signal)).toEqual({
    ok: true,
    value: a,
  });
  const counts = test.queries()[1];
  expect(counts?.sql).toMatch(
    /JOIN activity_types t[\s\S]*t\.key = 'task'[\s\S]*activity_participants[\s\S]*GROUP BY "r"\."person_id"/,
  );
  expect(counts?.params).toEqual(expect.arrayContaining([one, two, actor.id]));
  expect(counts?.params).not.toContain(hidden);
});

it("fails before query execution for an inactive actor or an aborted run", async () => {
  const test = database();
  const node = draft({ entity: "person" });
  expect(
    await searchWorkflowRecords(
      test.db,
      { ...actor, isActive: false },
      node,
      {},
      definition,
      signal,
    ),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_DENIED });
  await expect(
    pickWorkflowRecord(
      test.db,
      actor,
      node,
      { workflowId, simulation: false },
      AbortSignal.abort(),
    ),
  ).rejects.toHaveProperty("name", "AbortError");
  expect(test.execute).not.toHaveBeenCalled();
});
