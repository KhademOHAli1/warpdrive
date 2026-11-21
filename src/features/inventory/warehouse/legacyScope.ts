import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySiteGrants } from "@/features/locations/schema";
import { readOperationsSiteGrants } from "@/features/operations-access/scope";
import type { HydratedActor } from "@/server/hydrateActor";

/** Null is the administrator's unfiltered warehouse scope. */
export async function readOrderWarehouseSites(tx: Db, actor: Pick<HydratedActor, "id" | "type">) {
  if (actor.type === "admin") return null;
  const siteGrants = await tx
    .select({ siteId: directorySiteGrants.siteId })
    .from(directorySiteGrants)
    .where(eq(directorySiteGrants.userId, actor.id));
  const warehouseGrants = (await readOperationsSiteGrants(tx, actor.id)).filter(
    ({ role }) => role === "warehouse_viewer" || role === "warehouse_manager",
  );
  return [...new Set([...siteGrants, ...warehouseGrants].map(({ siteId }) => siteId))];
}
