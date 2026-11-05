import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import type { CompanyCommand, CompanyProvenance, LegalEntityData } from "./contracts";
import { openCompany, sealCompany } from "./crypto";
import { payerPreferencesSchema } from "./legalContracts";
import { companyFailure } from "./policy";
import { decodeEntity, ensureCompany } from "./repository";
import { companyLegalEntities } from "./schema";

export async function validParent(
  db: Db,
  id: string,
  parentId: string | null,
  signal: AbortSignal,
) {
  const visited = new Set([id]);
  let current = parentId;
  while (current !== null) {
    signal.throwIfAborted();
    if (visited.has(current) || visited.size > 50) return false;
    visited.add(current);
    const [row] = await db
      .select({
        id: companyLegalEntities.id,
        parent: companyLegalEntities.parentEntityId,
        archived: companyLegalEntities.archived,
      })
      .from(companyLegalEntities)
      .where(eq(companyLegalEntities.id, current));
    if (row === undefined || row.archived) return false;
    current = row.parent;
  }
  return true;
}
export async function saveLegal(
  db: Db,
  command: Extract<CompanyCommand, { action: "save_legal_entity" }>,
  provenance: CompanyProvenance,
  signal: AbortSignal,
) {
  const id = command.id ?? randomUUID();
  const [existing] =
    command.id === null
      ? []
      : await db.select().from(companyLegalEntities).where(eq(companyLegalEntities.id, id));
  if (command.id !== null && existing === undefined) return err(companyFailure("not_found"));
  if ((existing?.revision ?? 0) !== command.expectedRevision || existing?.archived === true)
    return err(companyFailure("conflict"));
  if (!(await validParent(db, id, command.data.parentEntityId, signal)))
    return err(companyFailure("invalid_input"));
  const values = {
    dataCiphertext: sealCompany(command.data, `legal:${id}`),
    parentEntityId: command.data.parentEntityId,
    provenance,
    confirmedAt: new Date(),
    updatedAt: new Date(),
    revision: command.expectedRevision + 1,
  };
  const [saved] =
    existing === undefined
      ? await db
          .insert(companyLegalEntities)
          .values({ id, ...values })
          .returning()
      : await db
          .update(companyLegalEntities)
          .set(values)
          .where(eq(companyLegalEntities.id, id))
          .returning();
  if (saved === undefined) return err(companyFailure("write_failed"));
  return ok(decodeEntity(saved));
}
export async function archiveLegal(
  db: Db,
  command: Extract<CompanyCommand, { action: "archive_legal_entity" }>,
  signal: AbortSignal,
) {
  const [existing] = await db
    .select()
    .from(companyLegalEntities)
    .where(eq(companyLegalEntities.id, command.id));
  if (existing === undefined) return err(companyFailure("not_found"));
  if (existing.revision !== command.expectedRevision || existing.archived)
    return err(companyFailure("conflict"));
  const profile = await ensureCompany(db, signal);
  const payer =
    profile.payerCiphertext === null
      ? null
      : openCompany(profile.payerCiphertext, "payer", payerPreferencesSchema);
  const children = await db
    .select({ id: companyLegalEntities.id, archived: companyLegalEntities.archived })
    .from(companyLegalEntities)
    .where(eq(companyLegalEntities.parentEntityId, command.id));
  if (payer?.payerLegalEntityId === command.id || children.some((row) => !row.archived))
    return err(companyFailure("conflict"));
  await db
    .update(companyLegalEntities)
    .set({ archived: true, revision: command.expectedRevision + 1, updatedAt: new Date() })
    .where(eq(companyLegalEntities.id, command.id));
  return ok({ id: command.id, revision: command.expectedRevision + 1, archived: true as const });
}
export async function activeEntity(
  db: Db,
  id: string | null,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (id === null) return true;
  const [row] = await db
    .select({ archived: companyLegalEntities.archived })
    .from(companyLegalEntities)
    .where(eq(companyLegalEntities.id, id));
  signal.throwIfAborted();
  return row !== undefined && !row.archived;
}
export function selfReportedProvenance(data?: LegalEntityData): CompanyProvenance {
  return {
    kind: data?.source.kind ?? "manual",
    confirmedAt: new Date().toISOString(),
    provider: null,
    checkedAt: null,
    checkedFields: [],
    verification: "self_reported",
  };
}
