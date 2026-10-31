import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { deals, importExternalIds, leads, organizations } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { convertLead } from "@/features/leads/leadConvert";
import { commitBatch } from "./batch";
import { toEntityCreateSession } from "./commitHelpers";
import { adminActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";
import { undoBatch } from "./undoJob";

const signal = new AbortController().signal;

const leadRow = (pipedriveId: string, title: string, org: Record<string, unknown>) => ({
  primary: { title, pipedriveId, value: null, expectedCloseDate: null, customFields: {} },
  organization: org,
});

it("clears the organization link of a lead from a later batch when the batch that created the organization is undone", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const orgBatch = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows: [leadRow("L0", "First lead", { name: "Acme", pipedriveId: "O1" })],
    });
    await commitBatch(db, actor, orgBatch.batchId, signal);
    const leadBatch = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows: [leadRow("L1", "Linked lead", { pipedriveId: "O1" })],
    });
    await commitBatch(db, actor, leadBatch.batchId, signal);
    const [before] = await db.select().from(leads).where(eq(leads.title, "Linked lead"));
    expect(before?.orgId).not.toBeNull();

    await undoBatch(db, actor, orgBatch.batchId, signal);

    const [after] = await db.select().from(leads).where(eq(leads.title, "Linked lead"));
    expect(after?.deletedAt).toBeNull();
    expect(after?.orgId).toBeNull();
  });
});

it("undoes converted and unconverted leads with their mappings and keeps the converted deal", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor = adminActorFor(user.id);
    await seedPipelineWithStages(db, ["New"]);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "lead",
      rows: [
        leadRow("L1", "Converted lead", { name: "Acme", pipedriveId: "O1" }),
        leadRow("L2", "Plain lead", { name: "Acme", pipedriveId: "O1" }),
      ],
    });
    await commitBatch(db, actor, batchId, signal);
    const [target] = await db.select().from(leads).where(eq(leads.title, "Converted lead"));
    if (target === undefined) throw new Error("lead missing");
    const converted = await convertLead(
      db,
      { ...toEntityCreateSession(actor), isAdmin: true },
      { leadId: target.id, expectedUpdatedAt: target.updatedAt.toISOString() },
      signal,
    );
    expect(converted.ok).toBe(true);

    await undoBatch(db, actor, batchId, signal);

    const all = await db.select().from(leads);
    expect(all.every((l) => l.deletedAt !== null)).toBe(true);
    expect(
      await db.select().from(importExternalIds).where(eq(importExternalIds.entity, "lead")),
    ).toHaveLength(0);
    const [org] = await db.select().from(organizations);
    expect(org?.deletedAt).not.toBeNull();
    const [deal] = await db.select().from(deals);
    expect(deal?.deletedAt).toBeNull();
    expect(deal?.orgId).toBeNull();
  });
});
