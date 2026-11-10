import { and, eq, isNull, sql } from "drizzle-orm";
import { type AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { activities, activityTypes, leads, organizations, persons } from "@/db/schema";
import { deleteActivity } from "@/features/activities/activityDelete";
import { updateActivity } from "@/features/activities/activityUpdate";
import { activityUpdateInput } from "@/features/activities/schemas";
import { toContactActor, toRefActor } from "@/features/contacts/actorAdapters";
import { deleteOrg } from "@/features/contacts/deleteOrg";
import { deletePerson } from "@/features/contacts/deletePerson";
import { updateOrg } from "@/features/contacts/orgsRepo";
import { updatePerson } from "@/features/contacts/personsRepo";
import { orgUpdateInput, personUpdateInput } from "@/features/contacts/schemas";
import { contactVisibilityClause } from "@/features/contacts/visibilitySql";
import { deleteDeal } from "@/features/deal-workspace/deleteDeal";
import { loadEditableDeal } from "@/features/deals/dealAuth";
import { updateDeal } from "@/features/deals/dealUpdate";
import { lockStageDeal } from "@/features/deals/nativeStageAccess";
import { dealUpdateInput } from "@/features/deals/schemas";
import type { LeadSession } from "@/features/leads/leadActions";
import { bulkUpdateLeads } from "@/features/leads/leadBulk";
import { updateLead } from "@/features/leads/leadUpdate";
import { leadUpdateInput } from "@/features/leads/schemas";
import { leadVisibilityClause } from "@/features/leads/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityPredicate } from "@/features/stats/activityVisibilitySql";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import type { StepOutput } from "./runTypes";
import type { RecordMutationEntity } from "./workflowRecordMutationContract";

export type RecordUpdatePatch = Record<string, string | number | null>;
export type RecordMutationResult = Result<StepOutput, string>;

interface Input {
  actor: PermSetUser;
  id: string;
  patch: RecordUpdatePatch | null;
  signal: AbortSignal;
}

function project(
  result: Result<{ id: string }, AppError>,
  patch: Input["patch"],
): RecordMutationResult {
  if (!result.ok) return err(result.error.id);
  return patch === null ? ok({ deleted: true }) : ok({ id: result.value.id });
}

async function mutateDeal(
  db: Db,
  { actor, id, patch, signal }: Input,
): Promise<RecordMutationResult> {
  const visible = await loadEditableDeal(db, actor, id, signal);
  if (!visible.ok) return err(visible.error.id);
  // Reuse the native pipeline-before-deal lock order. Never chase a different pipeline
  // while holding the deal if its pipeline changed between the hint and the lock.
  const { pipeline, deal } = await lockStageDeal(db, id, visible.value.deal.pipelineId, true);
  if (
    pipeline === undefined ||
    pipeline.isArchived ||
    deal === undefined ||
    deal.pipelineId !== pipeline.id ||
    deal.deletedAt !== null
  ) {
    return err(ERROR_IDS.DEAL_NOT_FOUND);
  }
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(ERROR_IDS.PERM_DENIED);
  const expectedUpdatedAt = deal.updatedAt.toISOString();
  if (patch === null)
    return project(await deleteDeal(db, current, { dealId: id, expectedUpdatedAt }, signal), patch);

  const input = dealUpdateInput.safeParse({ ...patch, dealId: id, expectedUpdatedAt });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return project(await updateDeal(db, current, input.data, signal), patch);
}

function leadSession(actor: PermSetUser): LeadSession {
  return {
    ...toRefActor(actor),
    // Only native creation consults the primary-group default.
    primaryVisibilityGroupId: null,
    flags: Object.fromEntries([...actor.flags].map((flag) => [flag, true])),
  };
}

async function mutateLead(
  db: Db,
  { actor, id, patch, signal }: Input,
): Promise<RecordMutationResult> {
  const [lead] = await db
    .select({ updatedAt: leads.updatedAt })
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.deletedAt), leadVisibilityClause(toRefActor(actor))))
    .for("update");
  if (lead === undefined) return err(ERROR_IDS.LEAD_NOT_FOUND);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(ERROR_IDS.PERM_DENIED);
  const session = leadSession(current);
  if (patch === null) {
    // Same native one-record operation as LeadHeader. It independently requires
    // bulk.edit, record edit and record delete. Skipped rows reveal no existence.
    const result = await bulkUpdateLeads(
      db,
      session,
      { ids: [id], change: { deleted: true } },
      signal,
    );
    if (!result.ok) return err(result.error.id);
    return result.value.updated === 1 ? ok({ deleted: true }) : err(ERROR_IDS.LEAD_NOT_FOUND);
  }
  const input = leadUpdateInput.safeParse({
    ...patch,
    leadId: id,
    expectedUpdatedAt: lead.updatedAt.toISOString(),
  });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return project(await updateLead(db, session, input.data, signal), patch);
}

async function mutateContact(
  db: Db,
  entity: "person" | "organization",
  { actor, id, patch, signal }: Input,
): Promise<RecordMutationResult> {
  const table = entity === "person" ? persons : organizations;
  const [locked] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, id),
        isNull(table.deletedAt),
        contactVisibilityClause(toRefActor(actor), {
          ownerId: sql`${table.ownerId}`,
          visibilityLevel: sql`${table.visibilityLevel}`,
          visibilityGroupId: sql`${table.visibilityGroupId}`,
          visibleToUserIds: sql`${table.visibleToUserIds}`,
        }),
      ),
    )
    .for("update");
  if (locked === undefined) return err(ERROR_IDS.CONTACT_NOT_FOUND);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(ERROR_IDS.PERM_DENIED);
  const contact = { ...toContactActor(current), managedUserIds: current.managedUserIds };
  // The native contact repositories recheck current visibility and ownership while
  // the row stays locked, so they cannot overwrite an intervening owner or patch.
  if (patch === null) {
    const remove = entity === "person" ? deletePerson : deleteOrg;
    return project(await remove(db, contact, id, signal), patch);
  }
  if (entity === "person") {
    const input = personUpdateInput.safeParse({ ...patch, id });
    if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
    return project(await updatePerson(db, contact, input.data, signal), patch);
  }
  const input = orgUpdateInput.safeParse({ ...patch, id });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return project(await updateOrg(db, contact, input.data, signal), patch);
}

async function mutateTask(
  db: Db,
  { actor, id, patch, signal }: Input,
): Promise<RecordMutationResult> {
  const [task] = await db
    .select({ id: activities.id })
    .from(activities)
    .innerJoin(activityTypes, eq(activityTypes.id, activities.typeId))
    .where(
      and(
        eq(activities.id, id),
        isNull(activities.deletedAt),
        eq(activityTypes.key, "task"),
        isNull(activityTypes.archivedAt),
        activityVisibilityPredicate(actor, "activities"),
      ),
    )
    .for("update", { of: activities });
  if (task === undefined) return err(ERROR_IDS.ACTIVITY_NOT_FOUND);
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null) return err(ERROR_IDS.PERM_DENIED);
  if (patch === null) return project(await deleteActivity(db, current, id, signal), patch);
  const input = activityUpdateInput.safeParse({ ...patch, id });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  return project(await updateActivity(db, current, input.data, signal), patch);
}

export function mutateNativeRecord(
  db: Db,
  entity: RecordMutationEntity,
  input: Input,
): Promise<RecordMutationResult> {
  switch (entity) {
    case "deal":
      return mutateDeal(db, input);
    case "lead":
      return mutateLead(db, input);
    case "person":
    case "organization":
      return mutateContact(db, entity, input);
    case "activity":
      return mutateTask(db, input);
  }
}
