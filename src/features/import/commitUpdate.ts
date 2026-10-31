import { sql } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import { organizations, persons } from "@/db/schema";
import { can } from "@/features/permissions/can";
import type { VisiblePersonOrOrg } from "@/features/permissions/types";
import type { MappedRow } from "@/types/import";
import type { Result } from "@/types/result";
import { type Commit, finalize, type ImportActor, type Tx } from "./commitHelpers";
import { updateWithRelations } from "./commitRelations";
import type { ImportContext } from "./externalIds";

export async function applyOneUpdate(
  tx: Tx,
  actor: ImportActor,
  target: "person" | "organization",
  candidateId: string,
  mapped: MappedRow,
  ctx: ImportContext,
  rowId: string,
  signal: AbortSignal,
): Promise<Result<Commit, AppError>> {
  const [existing] =
    target === "person"
      ? await tx.select().from(persons).where(sql`${persons.id} = ${candidateId}`)
      : await tx.select().from(organizations).where(sql`${organizations.id} = ${candidateId}`);
  if (existing === undefined) {
    return finalize(tx, rowId, "invalid", null, [{ field: "_", message: "candidate vanished" }]);
  }

  const record: VisiblePersonOrOrg = {
    kind: target === "person" ? "person" : "organization",
    ownerId: existing.ownerId,
    visibilityLevel: existing.visibilityLevel,
    visibilityGroupId: existing.visibilityGroupId,
    visibleToUserIds: existing.visibleToUserIds,
  };
  if (can(actor, "contact.edit", record) === false) {
    return finalize(tx, rowId, "invalid", null, [
      { field: "_", message: "not permitted to update" },
    ]);
  }

  const updated = await updateWithRelations(tx, actor, target, candidateId, mapped, ctx, signal);
  if (updated.ok === false) {
    return finalize(tx, rowId, "invalid", null, updated.error);
  }
  return finalize(tx, rowId, "imported", null, [], updated.value.side, updated.value.warnings);
}
