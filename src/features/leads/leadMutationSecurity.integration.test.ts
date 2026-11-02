import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { deals } from "@/db/schema/deals";
import { leads } from "@/db/schema/leads";
import { settings } from "@/db/schema/system";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { LeadSession } from "./leadActions";
import { archiveLead } from "./leadActions";
import { bulkUpdateLeads } from "./leadBulk";
import { convertLead } from "./leadConvert";
import { updateLead } from "./leadUpdate";

const signal = () => new AbortController().signal;

function session(userId: string, flags: Record<string, boolean>): LeadSession {
  return {
    userId,
    isAdmin: false,
    isActive: true,
    sessionLive: true,
    visibilityGroupIds: [],
    managedUserIds: [],
    primaryVisibilityGroupId: null,
    flags,
  };
}

describe("lead mutation security", () => {
  it("does not let a read-only viewer convert and archive a visible lead", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const viewer = await seedUser(db);
      const pipeline = await seedPipelineWithStages(db, ["Open"]);
      await db.insert(settings).values({
        id: true,
        defaultPipelineId: pipeline.pipeline.id,
        defaultVisibilityLevels: { deal: "all", person: "all", organization: "all" },
      });
      const [lead] = await db
        .insert(leads)
        .values({ title: "Original", ownerId: owner.id, visibilityLevel: "all" })
        .returning();
      if (lead === undefined) throw new Error("lead seed failed");

      const result = await convertLead(
        db,
        session(viewer.id, { "deal.create": true }),
        { leadId: lead.id, expectedUpdatedAt: lead.updatedAt.toISOString() },
        signal(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe(ERROR_IDS.PERM_DENIED);
      expect(await db.select().from(deals)).toHaveLength(0);
      const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
      expect(after).toMatchObject({ convertedDealId: null, archivedAt: null });
    });
  });

  it("denies updates and archive to a read-only viewer of an all-visible lead", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const viewer = await seedUser(db);
      const [lead] = await db
        .insert(leads)
        .values({ title: "Original", ownerId: owner.id, visibilityLevel: "all" })
        .returning();
      if (lead === undefined) throw new Error("lead seed failed");
      const readOnly = session(viewer.id, { "deal.create": true });

      const updated = await updateLead(
        db,
        readOnly,
        { leadId: lead.id, expectedUpdatedAt: lead.updatedAt.toISOString(), title: "Changed" },
        signal(),
      );
      const archived = await archiveLead(
        db,
        readOnly,
        { leadId: lead.id, archived: true },
        signal(),
      );
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.error.id).toBe(ERROR_IDS.PERM_DENIED);
      expect(archived.ok).toBe(false);
      if (!archived.ok) expect(archived.error.id).toBe(ERROR_IDS.PERM_DENIED);

      const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
      expect(after).toMatchObject({ title: "Original", archivedAt: null });
    });
  });

  it("requires bulk.edit and the record edit flag independently", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const viewer = await seedUser(db);
      const [lead] = await db
        .insert(leads)
        .values({ title: "Original", ownerId: owner.id, visibilityLevel: "all" })
        .returning();
      if (lead === undefined) throw new Error("lead seed failed");

      const noBulk = await bulkUpdateLeads(
        db,
        session(viewer.id, { "deal.edit_any": true }),
        { ids: [lead.id], change: { archived: true } },
        signal(),
      );
      expect(noBulk.ok).toBe(false);
      if (!noBulk.ok) expect(noBulk.error.id).toBe(ERROR_IDS.PERM_DENIED);

      const noEdit = await bulkUpdateLeads(
        db,
        session(viewer.id, { "bulk.edit": true }),
        { ids: [lead.id], change: { archived: true } },
        signal(),
      );
      expect(noEdit).toMatchObject({ ok: true, value: { updated: 0, skipped: 1 } });
      const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
      expect(after?.archivedAt).toBeNull();
    });
  });

  it("requires deal.delete in addition to bulk and edit before soft deleting", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const [lead] = await db
        .insert(leads)
        .values({ title: "Original", ownerId: owner.id, visibilityLevel: "all" })
        .returning();
      if (lead === undefined) throw new Error("lead seed failed");
      const editOnly = session(owner.id, { "bulk.edit": true, "deal.edit_own": true });
      const denied = await bulkUpdateLeads(
        db,
        editOnly,
        { ids: [lead.id], change: { deleted: true } },
        signal(),
      );
      expect(denied).toMatchObject({ ok: true, value: { updated: 0, skipped: 1 } });

      const granted = await bulkUpdateLeads(
        db,
        session(owner.id, {
          "bulk.edit": true,
          "deal.edit_own": true,
          "deal.delete_own": true,
        }),
        { ids: [lead.id], change: { deleted: true } },
        signal(),
      );
      expect(granted).toMatchObject({ ok: true, value: { updated: 1, skipped: 0 } });
      const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
      expect(after?.deletedAt).not.toBeNull();
    });
  });
});
