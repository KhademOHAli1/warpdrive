import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Installation, WorkItem, WorkPreferences, WorkType } from "./contracts";
import { type workInstallations, workStages, workspaceWorkProfiles, workTypes } from "./schema";
export const emptyPreferences: WorkPreferences = {
  workTypes: [],
  primaryWorkType: null,
  modules: [],
  primaryGoal: "",
  deliveryModels: [],
  customerTypes: [],
};
export async function readProfile(db: Db, signal: AbortSignal) {
  const [profile] = await db
    .select()
    .from(workspaceWorkProfiles)
    .where(eq(workspaceWorkProfiles.id, true));
  signal.throwIfAborted();
  return {
    revision: profile?.revision ?? 0,
    preferences: profile?.preferences ?? emptyPreferences,
  };
}
export async function readTypes(db: Db, signal: AbortSignal): Promise<WorkType[]> {
  const rows = await db
    .select()
    .from(workTypes)
    .orderBy(asc(workTypes.createdAt), asc(workTypes.id));
  signal.throwIfAborted();
  const stages = await db
    .select()
    .from(workStages)
    .orderBy(asc(workStages.order), asc(workStages.id));
  signal.throwIfAborted();
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    kind: row.kind,
    revision: row.revision,
    fields: row.fields,
    isArchived: row.isArchived,
    stages: stages
      .filter((s) => s.typeId === row.id)
      .map(({ id, key, name, order, bucket, isArchived }) => ({
        id,
        key,
        name,
        order,
        bucket,
        isArchived,
      })),
  }));
}
export function installationDto(row: typeof workInstallations.$inferSelect): Installation {
  return {
    id: row.id,
    requestId: row.requestId,
    presetId: row.presetId,
    presetVersion: row.presetVersion,
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
    resources: row.resources.map(({ kind, id, key, created }) => ({ kind, id, key, created })),
  };
}
export const itemDto = (
  row: Omit<WorkItem, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date },
): WorkItem => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
