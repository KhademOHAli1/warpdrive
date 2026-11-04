import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { assert } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  deals,
  permissionSets,
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { createWorkflow, publishWorkflow } from "./persistence";
import { readRunHistoryPage } from "./runHistoryPage";
import type { WorkflowDefinition } from "./schemas";

export const HISTORY_TEST_TIMEOUT = 30_000;
type RunStatus = (typeof workflowRuns.$inferSelect)["status"];
type RunMode = (typeof workflowRuns.$inferSelect)["mode"];
interface HistorySpec {
  id?: string;
  createdAt?: string;
  status?: RunStatus;
  mode?: RunMode;
}
interface HistoricalRow {
  id: string;
  createdAt: string;
  status: RunStatus;
  mode: RunMode;
}
interface PublishedHistoryWorkflow {
  actor: PermSetUser;
  workflow: typeof workflows.$inferSelect;
  version: typeof workflowVersions.$inferSelect;
}
interface HistoryFixture extends TestDb, PublishedHistoryWorkflow {
  signal: AbortSignal;
  permissions: typeof permissionSets.$inferSelect;
  outsider: PermSetUser;
  admin: PermSetUser;
  deal: typeof deals.$inferSelect;
}

const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
    {
      id: "read",
      type: "record.read",
      version: 1,
      name: "Read visible deal",
      config: {
        entity: "deal",
        recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
      },
    },
    {
      id: "wait",
      type: "delay",
      version: 1,
      name: "One minute",
      config: { minutes: { kind: "value", value: 1 } },
    },
  ],
  edges: [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "wait", port: "next" },
  ],
};

export async function publishHistoryWorkflow(
  test: { db: Db; signal: AbortSignal },
  actor: PermSetUser,
  name: string,
): Promise<PublishedHistoryWorkflow> {
  const created = await createWorkflow(test.db, actor, { name, definition }, test.signal);
  assert(created.ok, "Public fixture workflow creation failed");
  const published = await publishWorkflow(
    test.db,
    actor,
    created.value.id,
    created.value.revision,
    test.signal,
  );
  assert(published.ok, "Public fixture workflow publication failed");
  const [workflow] = await test.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, created.value.id));
  assert(workflow !== undefined, "Published fixture workflow missing");
  test.signal.throwIfAborted();
  return { actor, workflow, version: published.value };
}

async function seedHistoryDeal(test: TestDb, actor: PermSetUser) {
  const pipeline = await seedPipelineWithStages(test.db, ["History fixture stage"]);
  const stage = pipeline.stages[0];
  assert(stage !== undefined, "History fixture stage missing");
  const [deal] = await test.db
    .insert(deals)
    .values({
      title: "Synthetic private history customer",
      ownerId: actor.id,
      pipelineId: pipeline.pipeline.id,
      stageId: stage.id,
      visibilityLevel: "owner",
      expectedCloseDate: "2026-11-30",
    })
    .returning();
  assert(deal !== undefined, "History fixture deal missing");
  return deal;
}

async function setupHistory(signal: AbortSignal): Promise<HistoryFixture> {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: "History fixture " + randomUUID(),
        flags: {
          "workflow.view": true,
          "workflow.create": true,
          "workflow.edit": true,
          "workflow.publish": true,
          "workflow.run": true,
          "workflow.cancel": true,
          "deal.view": true,
        },
      })
      .returning();
    assert(permissions !== undefined, "History fixture permissions missing");
    const owner = await seedUser(test.db, { permissionSetId: permissions.id });
    const other = await seedUser(test.db, { permissionSetId: permissions.id });
    const administrator = await seedUser(test.db, {
      isAdmin: true,
      permissionSetId: permissions.id,
    });
    const actor = await hydrateActor(test.db, owner.id, signal);
    const outsider = await hydrateActor(test.db, other.id, signal);
    const admin = await hydrateActor(test.db, administrator.id, signal);
    assert(actor !== null && outsider !== null && admin !== null, "History fixture actors missing");
    const deal = await seedHistoryDeal(test, actor);
    const published = await publishHistoryWorkflow(
      { db: test.db, signal },
      actor,
      "Synthetic history",
    );
    return { ...test, ...published, signal, permissions, outsider, admin, deal };
  } catch (error) {
    await test.close();
    throw error;
  }
}

export async function withHistory(
  body: (test: HistoryFixture, signal: AbortSignal) => Promise<void>,
) {
  const signal = AbortSignal.timeout(20_000);
  const test = await setupHistory(signal);
  try {
    await body(test, signal);
  } finally {
    await test.close();
  }
}

export function historicalSpecs(count: number): HistorySpec[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
  }));
}

function historicalNextNode(status: RunStatus) {
  if (status === "queued") return "start";
  if (status === "running") return "read";
  return status === "waiting" || status === "failed" ? "wait" : null;
}

function readOutput(test: HistoryFixture) {
  return {
    id: test.deal.id,
    title: test.deal.title,
    ownerId: test.deal.ownerId,
    expectedCloseDate: test.deal.expectedCloseDate,
    privateCanary: "private-history-output",
  };
}

function historicalOutputs(test: HistoryFixture, row: HistoricalRow) {
  if (row.status === "queued") return {};
  const start = { recordId: test.deal.id };
  if (row.status === "running") return { start };
  return { start, read: readOutput(test) };
}

function historicalSteps(
  test: HistoryFixture,
  row: HistoricalRow,
): (typeof workflowSteps.$inferInsert)[] {
  if (row.status === "queued") return [];
  const completedAt = new Date(row.createdAt);
  const common = { runId: row.id, simulated: row.mode === "simulation", completedAt };
  const steps: (typeof workflowSteps.$inferInsert)[] = [
    { ...common, nodeId: "start", output: { recordId: test.deal.id } },
  ];
  if (row.status !== "running")
    steps.push({
      ...common,
      nodeId: "read",
      output: readOutput(test),
      completedAt: new Date(completedAt.getTime() + 1),
    });
  if (row.status === "succeeded")
    steps.push({
      ...common,
      nodeId: "wait",
      output: { resumeAt: new Date(completedAt.getTime() + 60_000).toISOString() },
      completedAt: new Date(completedAt.getTime() + 60_000),
    });
  return steps;
}

export async function seedHistoricalRuns(
  test: HistoryFixture,
  specs: readonly HistorySpec[],
  published: PublishedHistoryWorkflow = test,
  options: { receipts?: boolean } = {},
): Promise<HistoricalRow[]> {
  const rows: HistoricalRow[] = specs.map((spec, index) => ({
    id: spec.id ?? randomUUID(),
    createdAt: spec.createdAt ?? new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
    status: spec.status ?? "succeeded",
    mode: spec.mode ?? "live",
  }));
  if (rows.length === 0) return rows;
  const records = rows.map((row) => ({
    ...row,
    workflowId: published.workflow.id,
    versionId: published.version.id,
    actorId: published.actor.id,
    requestKey: randomUUID(),
    trigger: { recordId: test.deal.id },
    nextNodeId: historicalNextNode(row.status),
    resumeAt: row.status === "waiting" ? "2099-01-01T00:00:00Z" : null,
    outputs: historicalOutputs(test, row),
    errorId: row.status === "failed" ? ERROR_IDS.WORKFLOW_DENIED : null,
  }));
  // These are explicitly synthetic persisted-history fixtures under a publicly
  // created/published valid graph. They do not claim public effect execution.
  // Bind timestamp text directly to PostgreSQL, retaining all six fractional digits.
  await test.pool.query(
    `INSERT INTO workflow_runs
      (id,workflow_id,version_id,actor_id,request_key,mode,status,trigger,
       next_node_id,resume_at,outputs,error_id,created_at,updated_at)
     SELECT (r->>'id')::uuid,(r->>'workflowId')::uuid,(r->>'versionId')::uuid,
       (r->>'actorId')::uuid,(r->>'requestKey')::uuid,r->>'mode',r->>'status',
       r->'trigger',r->>'nextNodeId',(r->>'resumeAt')::timestamptz,r->'outputs',
       r->>'errorId',(r->>'createdAt')::timestamptz,(r->>'createdAt')::timestamptz
     FROM jsonb_array_elements($1::jsonb) AS r`,
    [JSON.stringify(records)],
  );
  test.signal.throwIfAborted();
  if (options.receipts === false) return rows;
  const steps = rows.flatMap((row) => historicalSteps(test, row));
  for (let offset = 0; offset < steps.length; offset += 500) {
    await test.db.insert(workflowSteps).values(steps.slice(offset, offset + 500));
    test.signal.throwIfAborted();
  }
  return rows;
}

export async function historyPage(
  test: HistoryFixture,
  signal: AbortSignal,
  options: Record<string, unknown> = {},
  actor: PermSetUser = test.actor,
) {
  const result = await readRunHistoryPage(test.db, actor, signal, {
    id: test.workflow.id,
    ...options,
  });
  assert(result.ok, "Expected an authorized run-history page");
  return result.value;
}

export function historyCursorBody(cursor: string): Record<string, unknown> {
  const body: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  return z.record(z.string(), z.unknown()).parse(body);
}

export async function historySnapshot(db: Db) {
  return {
    workflows: await db.select().from(workflows).orderBy(workflows.id),
    versions: await db.select().from(workflowVersions).orderBy(workflowVersions.id),
    runs: await db.select().from(workflowRuns).orderBy(workflowRuns.id),
    steps: await db.select().from(workflowSteps).orderBy(workflowSteps.id),
    failures: await db.select().from(workflowRunFailures).orderBy(workflowRunFailures.id),
  };
}

export function loggedHistoryDb(pool: Pool) {
  const queries: { query: string; params: unknown[] }[] = [];
  const db = drizzle(pool, {
    schema,
    logger: {
      logQuery(query: string, params: unknown[]) {
        queries.push({ query, params: params.slice() });
      },
    },
  });
  return { db, queries };
}
