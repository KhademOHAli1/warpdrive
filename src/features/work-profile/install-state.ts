import { asc, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityTypes, customFieldDefs, pipelines, stages } from "@/db/schema";
import { readTypes } from "./read";
export async function lockNativeConfiguration(db: Db, signal: AbortSignal) {
  // Covers inserts as well as edits by existing native settings writers.
  await db.execute(
    sql`LOCK TABLE pipelines, stages, custom_field_defs, activity_types IN SHARE ROW EXCLUSIVE MODE`,
  );
  signal.throwIfAborted();
}
export async function nativeState(db: Db, signal: AbortSignal) {
  const pipelineRows = await db.select().from(pipelines).orderBy(asc(pipelines.id));
  signal.throwIfAborted();
  const stageRows = await db.select().from(stages).orderBy(asc(stages.id));
  signal.throwIfAborted();
  const fields = await db.select().from(customFieldDefs).orderBy(asc(customFieldDefs.id));
  signal.throwIfAborted();
  const activities = await db.select().from(activityTypes).orderBy(asc(activityTypes.id));
  signal.throwIfAborted();
  const types = await readTypes(db, signal);
  return {
    pipelines: pipelineRows.map((p) => ({
      ...p,
      stages: stageRows
        .filter((s) => s.pipelineId === p.id)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    })),
    fields,
    activities,
    types,
  };
}
export type NativeState = Awaited<ReturnType<typeof nativeState>>;
