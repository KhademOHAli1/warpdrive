import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema/system";
import { requireCurrentAuthority } from "@/features/auth/currentAuthority";
import { recordAudit } from "@/features/identity/audit";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { cancelCompanyOperation } from "./cancelService";
import {
  type CompanyCommand,
  type CompanyFailure,
  type CompanyOverview,
  type CompanyProvenance,
  companyCommandSchema,
} from "./contracts";
import { privateFingerprint, sealCompany } from "./crypto";
import { activeEntity, archiveLegal, saveLegal, selfReportedProvenance } from "./legalService";
import { companyCapabilities, companyFailure } from "./policy";
import { companyReceiptValue, isLegalCompanyAction } from "./receipts";
import { ensureCompany, readCompany } from "./repository";
import { companyAssets, companyOperations, companyProfiles } from "./schema";

export type TrustedCompanySource = {
  kind: CompanyProvenance["kind"];
  provider: string;
  checkedAt: string;
  checkedFields?: string[];
  verification: "provider_checked";
};
class RollbackCompany extends AppError {
  constructor(readonly failure: CompanyFailure) {
    super(ERROR_IDS.COMPANY_WRITE_FAILED, "Company operation rolled back");
  }
}
export class CompanyService {
  constructor(
    readonly db: Db,
    readonly signal: AbortSignal,
  ) {}
  async overview(actor: PermSetUser): Promise<Result<CompanyOverview, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    const caps = companyCapabilities(actor);
    return !caps.manageProfile && !caps.manageLegal
      ? err(companyFailure("forbidden"))
      : ok(await readCompany(this.db, actor, this.signal));
  }
  async operation(actor: PermSetUser, requestId: string): Promise<Result<unknown, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    const [row] = await this.db
      .select()
      .from(companyOperations)
      .where(eq(companyOperations.requestId, requestId));
    if (row === undefined || row.actorId !== actor.id) return err(companyFailure("not_found"));
    const caps = companyCapabilities(actor);
    if (!(isLegalCompanyAction(row.kind) ? caps.manageLegal : caps.manageProfile))
      return err(companyFailure("forbidden"));
    return ok(await companyReceiptValue(this.db, actor, row, this.signal));
  }
  async execute(
    actor: PermSetUser,
    input: unknown,
    trusted?: TrustedCompanySource,
  ): Promise<Result<unknown, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    const parsed = companyCommandSchema.safeParse(input);
    if (!parsed.success) return err(companyFailure("invalid_input"));
    const command = parsed.data;
    const caps = companyCapabilities(actor);
    if (
      !(isLegalCompanyAction(
        command.action === "cancel_operation" ? command.operationAction : command.action,
      )
        ? caps.manageLegal
        : caps.manageProfile)
    )
      return err(companyFailure("forbidden"));
    const fingerprint = privateFingerprint({ actor: actor.id, command, trusted: trusted ?? null });
    try {
      return await this.db.transaction(async (tx) => {
        this.signal.throwIfAborted();
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('company-profile-writes'), 0)`);
        const [previous] = await tx
          .select()
          .from(companyOperations)
          .where(eq(companyOperations.requestId, command.requestId));
        if (previous !== undefined)
          return previous.actorId === actor.id && previous.fingerprint === fingerprint
            ? ok(await companyReceiptValue(tx, actor, previous, this.signal))
            : err(companyFailure("replay_conflict"));
        const [assetRequest] = await tx
          .select({ id: companyAssets.id })
          .from(companyAssets)
          .where(eq(companyAssets.requestId, command.requestId));
        if (assetRequest) return err(companyFailure("replay_conflict"));
        const result = await this.mutate(tx, actor, command, trusted);
        if (!result.ok) throw new RollbackCompany(result.error);
        await recordAudit(
          tx,
          {
            actorId: actor.id,
            targetType: "settings",
            targetId: null,
            action: `company.${command.action}`,
            after: {
              changed: true,
              revision: command.action === "cancel_operation" ? null : command.expectedRevision + 1,
            },
            correlationId: command.requestId,
          },
          this.signal,
        );
        await tx.insert(companyOperations).values({
          requestId: command.requestId,
          actorId: actor.id,
          kind:
            command.action === "cancel_operation"
              ? `cancel:${command.operationAction}`
              : command.action,
          fingerprint,
          responseCiphertext: sealCompany(result.value, `operation:${command.requestId}`),
        });
        this.signal.throwIfAborted();
        return result;
      });
    } catch (cause) {
      if (cause instanceof RollbackCompany) return err(cause.failure);
      this.signal.throwIfAborted();
      if (cause instanceof AppError) throw cause;
      return err(companyFailure("write_failed"));
    }
  }
  private async mutate(
    tx: Db,
    actor: PermSetUser,
    command: CompanyCommand,
    trusted?: TrustedCompanySource,
  ): Promise<Result<unknown, CompanyFailure>> {
    if (command.action === "cancel_operation")
      return cancelCompanyOperation(tx, actor, command, this.signal);
    const profile = await ensureCompany(tx, this.signal);
    const now = new Date();
    const provenance: CompanyProvenance = trusted
      ? { ...trusted, checkedFields: trusted.checkedFields ?? [], confirmedAt: now.toISOString() }
      : selfReportedProvenance(command.action === "save_legal_entity" ? command.data : undefined);
    if (command.action === "save_legal_entity")
      return saveLegal(tx, command, provenance, this.signal);
    if (command.action === "archive_legal_entity") return archiveLegal(tx, command, this.signal);
    const changed =
      command.action === "save_details"
        ? await this.writeDetails(tx, command, profile.detailsRevision, provenance, now)
        : command.action === "save_branding"
          ? await this.writeBranding(tx, command, profile.brandingRevision, now)
          : await this.writePayer(tx, command, profile.payerRevision, now);
    return changed.ok ? ok(await readCompany(tx, actor, this.signal)) : changed;
  }
  private async writeDetails(
    tx: Db,
    command: Extract<CompanyCommand, { action: "save_details" }>,
    revision: number,
    provenance: CompanyProvenance,
    now: Date,
  ): Promise<Result<true, CompanyFailure>> {
    if (revision !== command.expectedRevision) return err(companyFailure("conflict"));
    await tx
      .insert(settings)
      .values({ id: true, companyName: command.details.companyName })
      .onConflictDoUpdate({
        target: settings.id,
        set: { companyName: command.details.companyName },
      });
    await tx
      .update(companyProfiles)
      .set({
        detailsCiphertext: sealCompany(command.details, "details"),
        detailsRevision: revision + 1,
        detailsProvenance: provenance,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(companyProfiles.id, true));
    return ok(true);
  }
  private async writeBranding(
    tx: Db,
    command: Extract<CompanyCommand, { action: "save_branding" }>,
    revision: number,
    now: Date,
  ): Promise<Result<true, CompanyFailure>> {
    if (revision !== command.expectedRevision) return err(companyFailure("conflict"));
    const ids = [command.branding.iconAssetId, command.branding.logoAssetId].filter(
      (id): id is string => id !== null,
    );
    const assets = ids.length
      ? await tx
          .select()
          .from(companyAssets)
          .where(and(inArray(companyAssets.id, ids), eq(companyAssets.ready, true)))
      : [];
    if (
      (
        [
          [command.branding.iconAssetId, "icon"],
          [command.branding.logoAssetId, "logo"],
        ] as const
      ).some(([id, slot]) => id !== null && !assets.some((a) => a.id === id && a.slot === slot))
    )
      return err(companyFailure("asset_invalid"));
    await tx
      .update(companyProfiles)
      .set({
        branding: command.branding,
        brandingRevision: revision + 1,
        updatedAt: now,
      })
      .where(eq(companyProfiles.id, true));
    return ok(true);
  }
  private async writePayer(
    tx: Db,
    command: Extract<CompanyCommand, { action: "save_payer_preferences" }>,
    revision: number,
    now: Date,
  ): Promise<Result<true, CompanyFailure>> {
    if (revision !== command.expectedRevision) return err(companyFailure("conflict"));
    if (!(await activeEntity(tx, command.preferences.payerLegalEntityId, this.signal)))
      return err(companyFailure("invalid_input"));
    await tx
      .update(companyProfiles)
      .set({
        payerCiphertext: sealCompany(command.preferences, "payer"),
        payerRevision: revision + 1,
        updatedAt: now,
      })
      .where(eq(companyProfiles.id, true));
    return ok(true);
  }
}
