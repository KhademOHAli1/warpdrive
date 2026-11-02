import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { organizations, persons, stages, users } from "@/db/schema";
import { resolveOwnerId } from "@/features/permissions/entityCreate";
import { admitPipelineWrite } from "@/features/pipelines/admitPipelineWrite";
import type { CreateDealSession } from "./dealActions";
import type { NativeDealIntentV1 } from "./nativeCreateIntentV1";

// Selected local domain order: pipeline -> stage -> definitions/settings -> owner -> references.
// SHARE relation locks also cover an absent singleton/new required definition, not only old rows.
// They are scoped to this transaction, allow concurrent creates and block dictionary mutation.
export async function protectNativeCreationInputs(
  tx: Db,
  session: CreateDealSession,
  intent: NativeDealIntentV1,
  signal: AbortSignal,
) {
  const pipeline = await admitPipelineWrite(tx, session, intent.pipelineId, signal, true);
  if (!pipeline.ok) return pipeline;
  await tx.select({ id: stages.id }).from(stages).where(eq(stages.id, intent.stageId)).for("share");
  await tx.execute(sql`LOCK TABLE public.custom_field_defs, public.settings IN SHARE MODE`);
  const owner = await resolveOwnerId(tx, session, intent.ownerId, signal);
  if (!owner.ok) return owner;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, owner.value)).for("share");
  if (intent.orgId !== null)
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, intent.orgId))
      .for("share");
  if (intent.personId !== null)
    await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, intent.personId))
      .for("share");
  signal.throwIfAborted();
  return pipeline;
}
