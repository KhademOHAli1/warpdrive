import { and, eq, exists, inArray, isNull, notExists, or } from "drizzle-orm";
import { users } from "@/db/schema/identity";
import { organizations } from "@/db/schema/organizations";
import { toVisibleRecord } from "@/features/contacts/orgsRepo";
import { directorySiteGrants, directorySites } from "@/features/locations/schema";
import { operationsSiteGrants } from "@/features/operations-access/schema";
import { canSee } from "@/features/permissions/canSee";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { inventoryPartProfiles } from "../catalog/schema";
import { purchaseOrderLines, purchaseOrders, purchaseReceipts } from "./schema";

export async function canAccessPurchaseReceiptFiles(
  db: DbOrTx,
  actor: AuthUser,
  receiptId: string,
  access: "read" | "write",
  signal: AbortSignal,
): Promise<boolean> {
  const write = access === "write";
  const assignment = db
    .select({ userId: operationsSiteGrants.userId })
    .from(operationsSiteGrants)
    .where(
      and(
        eq(operationsSiteGrants.userId, users.id),
        eq(operationsSiteGrants.siteId, purchaseOrders.siteId),
        inArray(
          operationsSiteGrants.role,
          write
            ? ["warehouse_manager"]
            : ["warehouse_viewer", "warehouse_manager", "buyer", "cost_viewer"],
        ),
      ),
    );
  const legacy = db
    .select({ userId: directorySiteGrants.userId })
    .from(directorySiteGrants)
    .where(
      and(
        eq(directorySiteGrants.userId, users.id),
        eq(directorySiteGrants.siteId, purchaseOrders.siteId),
        write ? eq(directorySiteGrants.role, "manager") : undefined,
      ),
    );
  const restrictedPart = db
    .select({ orderId: purchaseOrderLines.orderId })
    .from(purchaseOrderLines)
    .innerJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, purchaseOrderLines.itemId))
    .where(
      and(
        eq(purchaseOrderLines.orderId, purchaseOrders.id),
        eq(inventoryPartProfiles.visibility, "admin"),
      ),
    );
  const [row] = await db
    .select({ admin: users.isAdmin, supplier: organizations })
    .from(purchaseReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.orderId))
    .innerJoin(directorySites, eq(directorySites.id, purchaseOrders.siteId))
    .innerJoin(organizations, eq(organizations.id, purchaseOrders.supplierOrganizationId))
    .innerJoin(users, eq(users.id, actor.id))
    .where(
      and(
        eq(purchaseReceipts.id, receiptId),
        eq(users.isActive, true),
        eq(users.projectsGuestOnly, false),
        isNull(users.invitedAt),
        isNull(organizations.deletedAt),
        write ? eq(directorySites.archived, false) : undefined,
        or(
          eq(users.isAdmin, true),
          and(or(exists(assignment), exists(legacy)), notExists(restrictedPart)),
        ),
      ),
    );
  signal.throwIfAborted();
  return (
    row !== undefined &&
    canSee({ ...actor, type: row.admin ? "admin" : "regular" }, toVisibleRecord(row.supplier))
  );
}
