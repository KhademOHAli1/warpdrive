import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySiteGrants } from "@/features/locations/schema";
import type { HydratedActor } from "@/server/hydrateActor";

/** Null is the administrator's unfiltered warehouse scope. */
export async function readOrderWarehouseSites(tx: Db, actor: Pick<HydratedActor, "id" | "type">) {
  if (actor.type === "admin") return null;
  const grants = await tx
    .select({ siteId: directorySiteGrants.siteId })
    .from(directorySiteGrants)
    .where(eq(directorySiteGrants.userId, actor.id));
  return grants.map(({ siteId }) => siteId);
}
