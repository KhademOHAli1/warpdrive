import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { permissionSets, workflows } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { listWorkflows } from "./queries";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} }],
  edges: [],
};

it("returns a default 25-row library page with continuation and visible-scope existence", async () => {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: "Library page owner",
        flags: { "workflow.view": true, "workflow.create": true },
      })
      .returning();
    if (permissions === undefined) throw new Error("Missing library permissions");
    const owner = await seedUser(test.db, { permissionSetId: permissions.id });
    const other = await seedUser(test.db, { permissionSetId: permissions.id });
    const actor = await hydrateActor(test.db, owner.id, signal);
    if (actor === null) throw new Error("Missing library actor");
    await test.db.insert(workflows).values(
      Array.from({ length: 61 }, (_, index) => ({
        ownerId: owner.id,
        name: `Owned workflow ${String(index + 1).padStart(2, "0")}`,
        draft: definition,
        updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)),
      })),
    );
    const [hidden] = await test.db
      .insert(workflows)
      .values({ ownerId: other.id, name: "Hidden other-owner control", draft: definition })
      .returning();
    if (hidden === undefined) throw new Error("Missing hidden-owner control");
    expect(
      await test.db
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.ownerId, owner.id)),
    ).toHaveLength(61);
    expect(await test.db.select({ id: workflows.id }).from(workflows)).toHaveLength(62);
    const result = await listWorkflows(test.db, actor, signal);
    expect(result).toMatchObject({
      ok: true,
      value: {
        items: expect.any(Array),
        nextCursor: expect.any(String),
        scopeHasItems: true,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { items: expect.objectContaining({ length: 25 }) },
    });
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain(hidden.name);
  } finally {
    await test.close();
  }
});
