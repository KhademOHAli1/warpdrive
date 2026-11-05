import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  activities,
  activityTypes,
  customFieldDefs,
  deals,
  enrichmentFieldMappings,
  goals,
  pipelines,
  settings,
} from "@/db/schema";
import type { WorkCommand } from "./contracts";
import { fail } from "./errors";
import { resourceSnapshot } from "./install";
import { lockNativeConfiguration, type NativeState, nativeState } from "./install-state";
import type { WorkActor } from "./policy";
import { installationDto } from "./read";
import { type ResourceSnapshot, workInstallations, workItems, workTypes } from "./schema";
import { bumpRevision, fingerprint } from "./storage";
import { hasConfigurationReference } from "./undo-references";

async function used(db: Db, r: ResourceSnapshot, signal: AbortSignal) {
  // Include soft-deleted/archived records: undo must never erase their schema or history.
  const query =
    r.kind === "pipeline"
      ? sql`SELECT 1 FROM ${deals} WHERE ${deals.pipelineId}=${r.id}::uuid UNION ALL SELECT 1 FROM ${goals} WHERE ${goals.pipelineId}=${r.id}::uuid UNION ALL SELECT 1 FROM ${settings} WHERE ${settings.defaultPipelineId}=${r.id}::uuid`
      : r.kind === "activity_type"
        ? sql`SELECT 1 FROM ${activities} WHERE ${activities.typeId}=${r.id}::uuid UNION ALL SELECT 1 FROM ${goals} WHERE ${goals.activityTypeId}=${r.id}::uuid`
        : r.kind === "deal_field"
          ? sql`SELECT 1 FROM ${deals} WHERE ${deals.customFields} ? ${r.key} UNION ALL SELECT 1 FROM ${enrichmentFieldMappings} WHERE ${enrichmentFieldMappings.targetFieldDefId}=${r.id}::uuid`
          : sql`SELECT 1 FROM ${workItems} WHERE ${workItems.typeId}=${r.id}::uuid`;
  const result = await db.execute(query);
  signal.throwIfAborted();
  return result.rows.length > 0;
}
async function ensureRemovable(
  db: Db,
  installationId: string,
  state: NativeState,
  resource: ResourceSnapshot,
  signal: AbortSignal,
) {
  if (
    fingerprint(resourceSnapshot(state, resource.kind, resource.id)) !==
    fingerprint(resource.snapshot)
  )
    fail("conflict");
  if ((await used(db, resource, signal)) || (await hasConfigurationReference(db, resource, signal)))
    fail("in_use");
  // Another installation depends on this formerly created resource, even when it has no records.
  const [dependent] = await db
    .select({ id: workInstallations.id })
    .from(workInstallations)
    .where(
      and(
        sql`${workInstallations.id}<>${installationId}::uuid`,
        sql`${workInstallations.undoneAt} IS NULL`,
        sql`${workInstallations.resources} @> ${JSON.stringify([{ id: resource.id }])}::jsonb`,
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  if (dependent) fail("in_use");
}

async function removeResource(db: Db, resource: ResourceSnapshot, signal: AbortSignal) {
  const table =
    resource.kind === "pipeline"
      ? pipelines
      : resource.kind === "deal_field"
        ? customFieldDefs
        : resource.kind === "activity_type"
          ? activityTypes
          : workTypes;
  await db.delete(table).where(eq(table.id, resource.id));
  signal.throwIfAborted();
}

export async function undo(
  db: Db,
  actor: WorkActor,
  input: Extract<WorkCommand, { action: "undo" }>,
  signal: AbortSignal,
) {
  if (!actor.isActive || actor.type !== "admin") fail("forbidden");
  await lockNativeConfiguration(db, signal);
  // Prevent new referencing native records until the protected delete transaction commits.
  await db.execute(
    sql`LOCK TABLE deals, activities, goals, enrichment_field_mappings, settings, workflows, workflow_versions, saved_filters, import_batches, user_preferences IN SHARE ROW EXCLUSIVE MODE`,
  );
  signal.throwIfAborted();
  const [installation] = await db
    .select()
    .from(workInstallations)
    .where(eq(workInstallations.id, input.installationId))
    .for("update");
  signal.throwIfAborted();
  if (!installation) fail("not_found");
  if (installation.undoneAt !== null) fail("conflict");
  const state = await nativeState(db, signal);
  const created = installation.resources.filter((resource) => resource.created);
  for (const resource of created)
    await ensureRemovable(db, installation.id, state, resource, signal);
  for (const resource of created) await removeResource(db, resource, signal);
  const [updated] = await db
    .update(workInstallations)
    .set({ undoneAt: new Date() })
    .where(eq(workInstallations.id, installation.id))
    .returning();
  signal.throwIfAborted();
  if (!updated) fail("unavailable");
  return { installation: installationDto(updated), revision: await bumpRevision(db, signal) };
}
