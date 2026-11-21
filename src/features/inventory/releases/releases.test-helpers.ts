import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { inventoryProductReleases } from "./schema";

type HistoricalDraft = Pick<
  typeof inventoryProductReleases.$inferSelect,
  "id" | "itemId" | "revision" | "createdBy"
>;

/** Preserve the original release columns when preparing a populated migration prefix. */
export function seedHistoricalDraftRelease(db: Db, draft: HistoricalDraft) {
  return db.execute(sql`
    INSERT INTO inventory_product_releases (id, item_id, revision, created_by)
    VALUES (${draft.id}, ${draft.itemId}, ${draft.revision}, ${draft.createdBy})
  `);
}

/** Compare the entire original release record across the historical upgrade. */
export function readHistoricalProductReleases(db: Db) {
  const release = inventoryProductReleases;
  return db
    .select({
      id: release.id,
      itemId: release.itemId,
      revision: release.revision,
      status: release.status,
      createdBy: release.createdBy,
      createdAt: release.createdAt,
      approvedBy: release.approvedBy,
      approvedAt: release.approvedAt,
      bom: release.bom,
    })
    .from(release)
    .orderBy(release.id);
}
