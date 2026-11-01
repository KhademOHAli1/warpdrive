import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { can } from "@/features/permissions/can";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { activityVisibilityFromParents } from "../activityVisibility";
import { linkedParentVisible } from "../parentLinkVisibility";
import type { QueueRawActivity, QueueRawDeal, QueueVisibleLink } from "./queueRowSchema";
import type { NextActionQueueRow, QueueRecordLink } from "./queueTypes";

function visibleLink(
  actor: PermSetUser,
  kind: "person" | "organization" | "lead",
  row: QueueVisibleLink | null,
): QueueRecordLink | null {
  if (
    row === null ||
    !linkedParentVisible(actor, kind, row.id, {
      ownerId: row.ownerId,
      level: row.visibilityLevel,
      groupId: row.visibilityGroupId,
      visibleTo: row.visibleToUserIds,
    })
  )
    return null;
  return { id: row.id, label: row.label };
}

function activityRow(actor: PermSetUser, row: QueueRawActivity): NextActionQueueRow {
  const visibility = activityVisibilityFromParents({
    dealId: row.dealId,
    personId: row.personId,
    orgId: row.orgId,
    assigneeId: row.assigneeId,
    deal: row.deal,
    person: row.person,
    org: row.organization,
    participantUserIds: row.participants,
  });
  if (visibility === null || !canSee(actor, visibility))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Queue visibility projection disagreed");
  // Construct a minimal DTO. Internal visibility/link columns must never be spread to clients.
  return {
    kind: "activity",
    id: row.id,
    reason: "overdue",
    title: row.title,
    dueAt: new Date(row.dueAt).toISOString(),
    endAt: row.endAt === null ? null : new Date(row.endAt).toISOString(),
    allDay: row.allDay,
    dueDate: row.dueDate,
    endDate: row.endDate,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    deal: row.deal === null ? null : { id: row.deal.id, label: row.deal.label },
    person: visibleLink(actor, "person", row.person),
    organization: visibleLink(actor, "organization", row.organization),
    lead: visibleLink(actor, "lead", row.lead),
    canEdit: can(actor, "activity.edit", visibility),
    canComplete: can(actor, "activity.complete", visibility),
  };
}

export function queueRow(
  actor: PermSetUser,
  row: QueueRawActivity | QueueRawDeal,
): NextActionQueueRow {
  if (row.kind === "activity") return activityRow(actor, row);
  return {
    kind: "deal",
    id: row.id,
    reason: "missing-next-step",
    title: row.title,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    pipeline: { id: row.pipeline.id, label: row.pipeline.label },
    lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    person: visibleLink(actor, "person", row.person),
    organization: visibleLink(actor, "organization", row.organization),
    canSchedule: can(actor, "activity.create"),
  };
}
