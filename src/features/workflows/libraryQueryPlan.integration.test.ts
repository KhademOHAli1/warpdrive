import { inArray, type SQL, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/client";
import { permissionSets, workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import {
  buildWorkflowLibraryQuery,
  buildWorkflowOwnersQuery,
  listWorkflowOwners,
  listWorkflows,
  workflowLibraryInputSchema,
  workflowOwnersInputSchema,
} from "./library";
import { readWorkflowLibraryCursor } from "./libraryCursor";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "trigger.manual",
      version: 1,
      name: "Synthetic plan definition",
      config: {},
    },
  ],
  edges: [],
};
const explainDocument = z
  .array(
    z
      .object({
        Plan: z
          .object({
            "Node Type": z.string(),
            "Actual Rows": z.number().nonnegative(),
            "Actual Loops": z.number().nonnegative(),
          })
          .passthrough(),
        "Execution Time": z.number().nonnegative(),
      })
      .passthrough(),
  )
  .min(1);

async function explain(db: Db, label: string, query: SQL, limit: number) {
  const result = await db.execute<{ "QUERY PLAN": unknown }>(
    sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
  );
  const document = explainDocument.parse(result.rows[0]?.["QUERY PLAN"]);
  const top = document[0];
  assert(top !== undefined);
  expect(top.Plan["Actual Rows"]).toBeLessThanOrEqual(limit + 1);
  const serialized = JSON.stringify(document);
  expect(serialized).toMatch(/"Shared (?:Hit|Read) Blocks":\d+/);
  // Synthetic disposable data only. Keep the actual plan, not a timing or node-shape
  // golden, so qualification can assess buffers/loops without a production cost claim.
  console.warn(
    "WF016_SYNTHETIC_QUERY_PLAN",
    JSON.stringify({ label, workflows: 2000, owners: 10, runs: 9000, plan: document }),
  );
}

it("LC20/21 records real query plans over a finite mixed-owner library and live-run history", async () => {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: "Synthetic plan scope",
        flags: { "workflow.view": true, "workflow.create": true, "workflow.edit": true },
      })
      .returning();
    assert(permissions !== undefined);
    const owners = [];
    for (let index = 0; index < 10; index++)
      owners.push(
        await seedUser(test.db, {
          name: `Synthetic plan owner ${index}`,
          permissionSetId: permissions.id,
        }),
      );
    const regularOwner = owners[0];
    assert(regularOwner !== undefined);
    const admin = await seedUser(test.db, { name: "Synthetic plan administrator", isAdmin: true });
    const actor = await hydrateActor(test.db, regularOwner.id, signal);
    const administrator = await hydrateActor(test.db, admin.id, signal);
    assert(actor !== null && administrator !== null);
    const rows = Array.from({ length: 2000 }, (_, index) => {
      const owner = owners[index % owners.length];
      assert(owner !== undefined);
      return {
        id: crypto.randomUUID(),
        ownerId: owner.id,
        name: `${index % 5 === 0 ? "Synthetic Rückruf %_\\ پیگیری" : "Synthetic normal"} ${String(index).padStart(4, "0")}`,
        draft: definition,
        archivedAt: index % 8 === 0 ? new Date("2026-11-01T00:00:00Z") : null,
        updatedAt: new Date(Date.UTC(2026, 10, 2, 0, 0, index)),
      };
    });
    for (let offset = 0; offset < rows.length; offset += 250)
      await test.db.insert(workflows).values(rows.slice(offset, offset + 250));
    const published = rows.flatMap((row, index) =>
      index % 4 === 0
        ? []
        : [
            {
              id: crypto.randomUUID(),
              workflowId: row.id,
              number: 1,
              name: row.name,
              definition,
              publishedBy: row.ownerId,
            },
          ],
    );
    for (let offset = 0; offset < published.length; offset += 250)
      await test.db.insert(workflowVersions).values(published.slice(offset, offset + 250));
    await test.db
      .update(workflows)
      .set({ publishedNumber: 1 })
      .where(
        inArray(
          workflows.id,
          published.map((version) => version.workflowId),
        ),
      );
    const activeIds = rows
      .filter((row, index) => row.archivedAt === null && index % 4 > 1)
      .map((row) => row.id);
    await test.db.update(workflows).set({ active: true }).where(inArray(workflows.id, activeIds));
    const sourceById = new Map(rows.map((row) => [row.id, row]));
    const sourceIndexById = new Map(rows.map((row, index) => [row.id, index]));
    const runs: (typeof workflowRuns.$inferInsert)[] = [];
    for (const [index, version] of published.entries()) {
      const source = sourceById.get(version.workflowId);
      assert(source !== undefined);
      const sourceIndex = sourceIndexById.get(version.workflowId);
      assert(sourceIndex !== undefined);
      const latestState = Math.floor(sourceIndex / 10) % 3;
      for (let generation = 0; generation < 6; generation++) {
        const mode = generation % 2 === 0 ? "live" : "simulation";
        const status =
          generation === 4
            ? latestState === 0
              ? "failed"
              : latestState === 1
                ? "succeeded"
                : "waiting"
            : generation === 2
              ? "succeeded"
              : "failed";
        runs.push({
          workflowId: version.workflowId,
          versionId: version.id,
          actorId: source.ownerId,
          requestKey: crypto.randomUUID(),
          mode,
          status,
          trigger: { recordId: crypto.randomUUID() },
          outputs: { start: { value: "Synthetic plan output" } },
          createdAt: new Date(Date.UTC(2026, 10, 3, 0, generation, index)),
          nextNodeId: status === "waiting" ? "start" : null,
          resumeAt: status === "waiting" ? new Date("2099-01-01T00:00:00Z") : null,
        });
      }
    }
    expect(rows).toHaveLength(2000);
    expect(published).toHaveLength(1500);
    expect(runs).toHaveLength(9000);
    for (let offset = 0; offset < runs.length; offset += 250)
      await test.db.insert(workflowRuns).values(runs.slice(offset, offset + 250));
    // Own disposable statistics only; no index/extension/DDL is introduced by this test.
    await test.pool.query("ANALYZE workflows, workflow_versions, workflow_runs, users");

    const defaultInput = workflowLibraryInputSchema.parse(undefined);
    const first = await listWorkflows(test.db, actor, signal, defaultInput);
    assert(first.ok, JSON.stringify(first));
    expect(first.value.items).toHaveLength(25);
    expect(first.value.scopeHasItems).toBe(true);
    expect(
      first.value.items.every((row) => row.owner.id === actor.id && row.archivedAt === null),
    ).toBe(true);
    await explain(
      test.db,
      "regular-default",
      buildWorkflowLibraryQuery(actor, defaultInput),
      defaultInput.limit,
    );

    const filteredInput = workflowLibraryInputSchema.parse({
      query: "%_\\",
      status: "active",
      health: "latest-live-failed",
      limit: 25,
    });
    const filtered = await listWorkflows(test.db, actor, signal, filteredInput);
    assert(filtered.ok, JSON.stringify(filtered));
    expect(filtered.value.items.length).toBeGreaterThan(0);
    expect(filtered.value.items.length).toBeLessThanOrEqual(25);
    expect(
      filtered.value.items.every(
        (row) =>
          row.owner.id === actor.id &&
          row.lifecycle === "active" &&
          row.latestLiveRun?.status === "failed" &&
          row.name.includes("%_\\"),
      ),
    ).toBe(true);
    await explain(
      test.db,
      "regular-literal-filtered-health",
      buildWorkflowLibraryQuery(actor, filteredInput),
      filteredInput.limit,
    );

    const nameInput = workflowLibraryInputSchema.parse({ sort: "name-asc", limit: 25 });
    const named = await listWorkflows(test.db, actor, signal, nameInput);
    assert(named.ok, JSON.stringify(named));
    const expectedNames = await test.pool.query<{ id: string }>(
      `SELECT id FROM workflows WHERE owner_id = $1 AND archived_at IS NULL ORDER BY name COLLATE "C" ASC, id ASC LIMIT 25`,
      [actor.id],
    );
    expect(named.value.items.map((row) => row.id)).toEqual(expectedNames.rows.map((row) => row.id));
    await explain(
      test.db,
      "regular-name-collation",
      buildWorkflowLibraryQuery(actor, nameInput),
      nameInput.limit,
    );

    const cursor = first.value.nextCursor;
    assert(cursor !== null);
    const next = await listWorkflows(test.db, actor, signal, { ...defaultInput, cursor });
    assert(next.ok, JSON.stringify(next));
    expect(next.value.items).toHaveLength(25);
    expect(next.value.items.every((row) => row.owner.id === actor.id)).toBe(true);
    expect(
      next.value.items.some((row) => first.value.items.some((earlier) => earlier.id === row.id)),
    ).toBe(false);
    // Decode the actual service-produced cursor through the production validator.
    // The fingerprint is taken from that synthetic receipt, not recreated in the test.
    const opaque: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const receipt = z.object({ fingerprint: z.string() }).parse(opaque);
    const decoded = readWorkflowLibraryCursor(cursor, receipt.fingerprint);
    assert(decoded.ok, JSON.stringify(decoded));
    await explain(
      test.db,
      "regular-exact-keyset",
      buildWorkflowLibraryQuery(actor, defaultInput, decoded.value),
      defaultInput.limit,
    );

    const ownersInput = workflowOwnersInputSchema.parse({
      query: "Synthetic plan owner",
      limit: 5,
    });
    const options = await listWorkflowOwners(test.db, administrator, signal, ownersInput);
    assert(options.ok, JSON.stringify(options));
    expect(options.value.items).toHaveLength(5);
    expect(options.value.nextCursor).not.toBeNull();
    expect(new Set(options.value.items.map((owner) => owner.id)).size).toBe(5);
    expect(
      options.value.items.every((owner) => owners.some((seeded) => seeded.id === owner.id)),
    ).toBe(true);
    await explain(
      test.db,
      "administrator-owner-options",
      buildWorkflowOwnersQuery(administrator, ownersInput),
      ownersInput.limit,
    );
  } finally {
    await test.close();
  }
}, 60_000);
