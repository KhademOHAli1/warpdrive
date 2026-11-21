import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { AuthUser } from "@/features/permissions/types";
import { inventoryItems } from "../schema";
import { inventoryPartProfiles, inventoryPartStates } from "./schema";

export async function canAccessCatalogFiles(
  db: Db,
  actor: AuthUser,
  itemId: string,
  access: "read" | "write",
  signal: AbortSignal,
): Promise<boolean> {
  const [result] = await db
    .select({
      admin: users.isAdmin,
      visibility: inventoryPartProfiles.visibility,
      locked: inventoryPartStates.locked,
    })
    .from(inventoryItems)
    .innerJoin(users, eq(users.id, actor.id))
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, inventoryItems.id))
    .leftJoin(inventoryPartStates, eq(inventoryPartStates.id, inventoryPartProfiles.stateId))
    .where(
      and(
        eq(inventoryItems.id, itemId),
        eq(users.isActive, true),
        eq(users.projectsGuestOnly, false),
        isNull(users.invitedAt),
      ),
    );
  signal.throwIfAborted();
  if (!result) return false;
  return access === "write"
    ? result.admin && result.locked !== true
    : result.admin || result.visibility !== "admin";
}
