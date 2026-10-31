import { eq } from "drizzle-orm";
import { organizations, persons } from "@/db/schema";
import { canTransferContactOwner } from "@/features/contacts/resolveOwnerUpdate";
import { mayTransferOwner } from "@/features/permissions/mayTransferOwner";
import type { VisiblePersonOrOrg } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { MappedRow } from "@/types/import";
import { assignImportedOwner, type OwnedImportEntity } from "./assignImportedOwner";
import type { ImportActor, RowError, SideEffects } from "./commitHelpers";
import type { ImportContext } from "./externalIds";
import { type ImportOwnerMatch, resolveImportOwner } from "./resolveImportOwner";
import type { ImportTarget } from "./wizardState";

const UNRESOLVED_REASONS = {
  none: "no matching user",
  many: "several users match",
  denied: "not permitted",
} as const;

export function ownerCell(group: Record<string, unknown> | undefined, key: string): string | null {
  const value = group?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function unassignedWarning(
  field: string,
  label: string,
  value: string,
  reason: keyof typeof UNRESOLVED_REASONS,
): RowError {
  return { field, message: `${label} "${value}" not assigned: ${UNRESOLVED_REASONS[reason]}` };
}

export async function resolveMatchedUser(
  tx: DbOrTx,
  field: string,
  label: string,
  value: string,
  signal: AbortSignal,
): Promise<{ userId: string } | { warning: RowError }> {
  const match: ImportOwnerMatch = await resolveImportOwner(tx, value, signal);
  if (match.kind === "one") return { userId: match.userId };
  return { warning: unassignedWarning(field, label, value, match.kind) };
}

async function contactRecord(
  tx: DbOrTx,
  entity: "person" | "organization",
  id: string,
): Promise<VisiblePersonOrOrg | null> {
  const [row] =
    entity === "person"
      ? await tx.select().from(persons).where(eq(persons.id, id))
      : await tx.select().from(organizations).where(eq(organizations.id, id));
  if (row === undefined) return null;
  return {
    kind: entity,
    ownerId: row.ownerId,
    visibilityLevel: row.visibilityLevel,
    visibilityGroupId: row.visibilityGroupId,
    visibleToUserIds: row.visibleToUserIds,
  };
}

async function mayAssign(
  tx: DbOrTx,
  actor: ImportActor,
  entity: OwnedImportEntity,
  id: string,
): Promise<boolean> {
  if (entity === "deal" || entity === "lead") return mayTransferOwner(actor, actor.id);
  const record = await contactRecord(tx, entity, id);
  return record !== null && canTransferContactOwner(actor, record);
}

async function reassign(
  tx: DbOrTx,
  actor: ImportActor,
  field: string,
  entity: OwnedImportEntity,
  id: string,
  group: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<RowError[]> {
  const value = ownerCell(group, "owner");
  if (value === null) return [];
  const resolved = await resolveMatchedUser(tx, field, "owner", value, signal);
  if ("warning" in resolved) return [resolved.warning];
  if ((await mayAssign(tx, actor, entity, id)) === false) {
    return [unassignedWarning(field, "owner", value, "denied")];
  }
  await assignImportedOwner(tx, entity, id, resolved.userId, signal);
  return [];
}

export async function reassignRowOwners(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  created: { target: ImportTarget; primaryId: string | null; side: SideEffects },
  mapped: MappedRow,
  signal: AbortSignal,
): Promise<RowError[]> {
  if (ctx.source !== "pipedrive") return [];
  const warnings: RowError[] = [];
  const { target, primaryId, side } = created;
  if (
    primaryId !== null &&
    (target === "deal" || target === "lead" || target === "person" || target === "organization")
  ) {
    warnings.push(
      ...(await reassign(tx, actor, "owner", target, primaryId, mapped.primary, signal)),
    );
  }
  if (side.createdOrgId !== null) {
    warnings.push(
      ...(await reassign(
        tx,
        actor,
        "organization.owner",
        "organization",
        side.createdOrgId,
        mapped.organization,
        signal,
      )),
    );
  }
  if (side.createdPersonId !== null) {
    warnings.push(
      ...(await reassign(
        tx,
        actor,
        "person.owner",
        "person",
        side.createdPersonId,
        mapped.person,
        signal,
      )),
    );
  }
  return warnings;
}
