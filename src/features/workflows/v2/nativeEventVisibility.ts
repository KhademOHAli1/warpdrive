import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { pipelines } from "@/db/schema";
import type { BlockOutput } from "@/features/blocks/contracts";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import type { NativeObjectName } from "./nativeFields";

const visibility = z.object({
  owner_id: z.uuid(),
  visibility_level: z.enum(["owner", "group", "all"]),
  visibility_group_id: z.uuid().nullable(),
  visible_to_user_ids: z.array(z.uuid()),
});
const activityParents = z.object({
  id: z.uuid(),
  assignee_id: z.uuid(),
  deal_id: z.uuid().nullable(),
  person_id: z.uuid().nullable(),
  org_id: z.uuid().nullable(),
});

export async function nativeSnapshotVisible(
  db: Db,
  actor: PermSetUser,
  objectName: NativeObjectName,
  raw: BlockOutput,
  signal: AbortSignal,
): Promise<boolean> {
  if (objectName === "activity") {
    const parsed = activityParents.safeParse(raw);
    if (!parsed.success) return false;
    const parent = parsed.data;
    const result = await db.execute<{
      visible: boolean;
    }>(sql`SELECT ${activityVisibilityPredicate(actor, "r")} AS visible FROM (
      SELECT ${parent.id}::uuid AS id,${parent.assignee_id}::uuid AS assignee_id,${parent.deal_id}::uuid AS deal_id,
        ${parent.person_id}::uuid AS person_id,${parent.org_id}::uuid AS org_id
    ) r`);
    signal.throwIfAborted();
    return result.rows[0]?.visible === true;
  }
  const parsed = visibility.safeParse(raw);
  if (!parsed.success) return false;
  const row = parsed.data;
  const base = {
    ownerId: row.owner_id,
    visibilityLevel: row.visibility_level,
    visibilityGroupId: row.visibility_group_id,
    visibleToUserIds: row.visible_to_user_ids,
  };
  if (objectName === "person" || objectName === "organization")
    return canSee(actor, { ...base, kind: objectName });
  if (objectName === "lead")
    return canSee(actor, { ...base, kind: "deal", pipelineVisibilityGroupId: null });
  const pipelineId = z.uuid().safeParse(raw.pipeline_id);
  if (!pipelineId.success) return false;
  const [pipeline] = await db
    .select({ group: pipelines.visibilityGroupId, archived: pipelines.isArchived })
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId.data));
  signal.throwIfAborted();
  return (
    pipeline !== undefined &&
    !pipeline.archived &&
    canSee(actor, { ...base, kind: "deal", pipelineVisibilityGroupId: pipeline.group })
  );
}
