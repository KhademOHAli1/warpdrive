import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  importBatches,
  savedFilters,
  userPreferences,
  workflows,
  workflowVersions,
} from "@/db/schema";
import type { ResourceSnapshot } from "./schema";
export function referenceNeedles(resource: ResourceSnapshot): string[] {
  const ids = [resource.id, resource.key];
  const snapshot = resource.snapshot;
  if (
    snapshot !== null &&
    typeof snapshot === "object" &&
    "stages" in snapshot &&
    Array.isArray(snapshot.stages)
  ) {
    const stages: readonly unknown[] = snapshot.stages;
    for (const stage of stages)
      if (
        stage !== null &&
        typeof stage === "object" &&
        "id" in stage &&
        typeof stage.id === "string"
      )
        ids.push(stage.id);
  }
  return ids.map((id) => JSON.stringify(id));
}
/** JSON configuration has no FK. Preserve even archived definitions and import history. */
export async function hasConfigurationReference(
  db: Db,
  resource: ResourceSnapshot,
  signal: AbortSignal,
) {
  const needles = referenceNeedles(resource);
  const references = (column: SQL) =>
    sql`EXISTS(SELECT 1 FROM unnest(${sql.param(needles)}::text[]) AS tokens(needle) WHERE strpos(${column}::text,needle)>0)`;
  const result = await db.execute(sql`
 SELECT 1 FROM ${workflows} WHERE ${references(sql`${workflows.draft}`)}
 UNION ALL SELECT 1 FROM ${workflowVersions} WHERE ${references(sql`${workflowVersions.definition}`)}
 UNION ALL SELECT 1 FROM ${savedFilters} WHERE ${references(sql`${savedFilters.definition}`)}
 UNION ALL SELECT 1 FROM ${importBatches} WHERE ${references(sql`${importBatches.columnMapping}`)}
 UNION ALL SELECT 1 FROM ${userPreferences} WHERE ${references(sql`${userPreferences.ui}`)}`);
  signal.throwIfAborted();
  return result.rows.length > 0;
}
