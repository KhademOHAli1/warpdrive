import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryReleaseGrants } from "../releases/schema";
import { readOrderWarehouseSites } from "../warehouse/legacyScope";
import { inventoryProductionBuilds } from "./buildSchema";
import { inventoryProductionTasks } from "./materialSchema";

/** This projection adds a link only. Opening it always rechecks the build's full scope. */
export async function readProductionTaskLinks(tx: Db, projectId: string, actor: HydratedActor) {
  if (actor.projectsGuestOnly) return [];
  // Projects remains readable while the additive Production schema is being rolled out.
  const schema = await tx.execute<{ installed: boolean }>(sql`
    SELECT to_regclass('public.inventory_production_tasks') IS NOT NULL AS installed
  `);
  if (schema.rows[0]?.installed !== true) return [];
  const sites = await readOrderWarehouseSites(tx, actor);
  if (sites?.length === 0) return [];
  const builds = inventoryProductionBuilds;
  const tasks = inventoryProductionTasks;
  const engineering =
    actor.type === "admin"
      ? undefined
      : and(
          or(eq(inventoryPartProfiles.visibility, "staff"), isNull(inventoryPartProfiles.itemId)),
          exists(
            tx
              .select({ granted: sql`1` })
              .from(inventoryReleaseGrants)
              .where(
                and(
                  eq(inventoryReleaseGrants.userId, actor.id),
                  eq(inventoryReleaseGrants.itemId, builds.itemId),
                ),
              ),
          ),
        );
  return tx
    .select({ itemId: tasks.itemId, buildId: tasks.buildId })
    .from(tasks)
    .innerJoin(builds, eq(builds.id, tasks.buildId))
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, builds.itemId))
    .where(
      and(
        eq(tasks.projectId, projectId),
        sites === null ? undefined : inArray(builds.siteId, sites),
        engineering,
      ),
    );
}
