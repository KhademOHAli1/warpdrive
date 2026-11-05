import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activityTypes, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { listVisiblePipelines } from "@/features/pipelines/pipelineRouter";
import type { NativeFieldMetadata } from "./nativeFields";

export async function withNativeChoices(
  db: Db,
  actor: PermSetUser,
  fields: NativeFieldMetadata[],
  signal: AbortSignal,
): Promise<NativeFieldMetadata[]> {
  const writable = fields.filter((field) => field.createable || field.updateable);
  const needs = (reference: NativeFieldMetadata["referenceObject"]) =>
    writable.some((field) => field.referenceObject === reference);
  const [pipelines, types, members] = await Promise.all([
    needs("pipeline") || needs("stage")
      ? listVisiblePipelines(
          db,
          { isAdmin: actor.type === "admin", visibilityGroupIds: [...actor.groupIds] },
          signal,
        )
      : [],
    needs("activityType")
      ? db
          .select({ id: activityTypes.id, label: activityTypes.name })
          .from(activityTypes)
          .where(isNull(activityTypes.archivedAt))
          .orderBy(asc(activityTypes.order), asc(activityTypes.id))
          .limit(1000)
      : [],
    needs("user")
      ? db
          .select({ id: users.id, label: users.name })
          .from(users)
          .where(and(eq(users.isActive, true), isNull(users.invitedAt)))
          .orderBy(asc(users.name), asc(users.id))
          .limit(1000)
      : [],
  ]);
  signal.throwIfAborted();
  const choices = {
    pipeline: pipelines.map(({ id, name }) => ({ id, label: name })),
    stage: pipelines.flatMap((pipeline) =>
      pipeline.stages.map((stage) => ({ id: stage.id, label: `${pipeline.name} · ${stage.name}` })),
    ),
    activityType: types,
    user: members,
  };
  return fields.map((field) => {
    const reference = field.referenceObject;
    return reference === "pipeline" ||
      reference === "stage" ||
      reference === "activityType" ||
      reference === "user"
      ? { ...field, options: choices[reference] }
      : field;
  });
}
