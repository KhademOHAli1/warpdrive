import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { WorkflowV2Definition } from "@/features/blocks/contracts";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

it("upgrades populated 0107 to 0108, preserving legacy workflows and installing guarded record events", async () => {
  const prefix = 108;
  const h = await freshMigrationDb();
  const target = await migrationFolder(prefix + 1);
  try {
    await installPrefix(h, prefix);
    const owner = await seedUser(h.db, { isAdmin: true });
    const [legacy] = await h.db
      .insert(schema.workflows)
      .values({
        ownerId: owner.id,
        name: "Existing active workflow",
        draft: {
          schemaVersion: 1,
          nodes: [{ id: "start", type: "trigger.manual", name: "Manual", version: 1, config: {} }],
          edges: [],
        },
      })
      .returning();
    if (legacy === undefined) throw new Error("missing retained workflow fixture");
    await h.db.insert(schema.workflowVersions).values({
      workflowId: legacy.id,
      number: 1,
      name: legacy.name,
      definition: legacy.draft,
      publishedBy: owner.id,
    });
    const [retained] = await h.db
      .update(schema.workflows)
      .set({ active: true, publishedNumber: 1 })
      .where(eq(schema.workflows.id, legacy.id))
      .returning();
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(prefix);
    const signal = AbortSignal.timeout(30_000);
    expect(await applyMigrations(h.db, signal, target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    const admitted = await ledger(h);
    expect(admitted).toHaveLength(prefix + 1);
    expect(admitted.slice(0, prefix)).toEqual(oldLedger);
    expect(
      await h.db.select().from(schema.workflows).where(eq(schema.workflows.id, legacy.id)),
    ).toEqual([retained]);
    expect(
      await h.db
        .select()
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, legacy.id)),
    ).toHaveLength(1);
    await h.db
      .insert(schema.organizations)
      .values({ name: "No subscriber", ownerId: owner.id, visibilityLevel: "owner" });
    expect(await h.db.select().from(schema.workflowV2RecordEvents)).toEqual([]);
    const definition: WorkflowV2Definition = {
      schemaVersion: 2,
      trigger: { type: "record.created", config: { objectName: "organization" } },
      nodes: [],
      edges: [],
      entryNodeIds: [],
    };
    const [workflow] = await h.db
      .insert(schema.workflowsV2)
      .values({
        ownerId: owner.id,
        name: "Record event subscriber",
        draft: definition,
        publishedNumber: 1,
        active: true,
      })
      .returning();
    if (workflow === undefined) throw new Error("missing v2 fixture");
    const [version] = await h.db
      .insert(schema.workflowV2Versions)
      .values({
        workflowId: workflow.id,
        number: 1,
        name: workflow.name,
        definition,
        publishedBy: owner.id,
      })
      .returning();
    if (version === undefined) throw new Error("missing version fixture");
    const orgId = randomUUID();
    await h.db.insert(schema.organizations).values({
      id: orgId,
      name: "Recorded after subscription",
      ownerId: owner.id,
      visibilityLevel: "owner",
    });
    expect(await h.db.select().from(schema.workflowV2RecordEvents)).toMatchObject([
      { recordId: orgId, eventName: "organization.created", status: "pending" },
    ]);
    await expect(
      h.db
        .update(schema.workflowV2Versions)
        .set({ name: "Rewrite" })
        .where(eq(schema.workflowV2Versions.id, version.id)),
    ).rejects.toThrow();
    expect(await applyMigrations(h.db, signal, target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(admitted);
  } finally {
    await target.dispose();
    await h.close();
  }
});
