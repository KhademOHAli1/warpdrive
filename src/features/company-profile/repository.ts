import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema/system";
import type { PermSetUser } from "@/features/permissions/effective";
import {
  type CompanyOverview,
  companyDetailsSchema,
  type LegalEntity,
  payerPreferencesSchema,
} from "./contracts";
import { openCompany } from "./crypto";
import { legalEntityDataSchema } from "./legalContracts";
import { companyCapabilities } from "./policy";
import { brandProjection, identityReadiness } from "./readiness";
import { companyLegalEntities, companyProfiles } from "./schema";

function companyName(...names: (string | null | undefined)[]): string {
  return (
    names.find((name): name is string => typeof name === "string" && name.trim() !== "") ??
    "Warpdrive"
  );
}

export async function ensureCompany(db: Db, signal: AbortSignal) {
  signal.throwIfAborted();
  await db.insert(companyProfiles).values({ id: true }).onConflictDoNothing();
  const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.id, true));
  signal.throwIfAborted();
  if (profile === undefined)
    throw new AppError(ERROR_IDS.COMPANY_WRITE_FAILED, "Company singleton missing after insertion");
  return profile;
}
export const decodeEntity = (row: typeof companyLegalEntities.$inferSelect): LegalEntity => {
  const data = openCompany(row.dataCiphertext, `legal:${row.id}`, legalEntityDataSchema);
  return {
    id: row.id,
    revision: row.revision,
    data,
    archived: row.archived,
    confirmedAt: row.confirmedAt.toISOString(),
    provenance: row.provenance,
    readiness: identityReadiness(data),
  };
};
export async function readCompany(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
): Promise<CompanyOverview> {
  const profile = await ensureCompany(db, signal);
  const [setting] = await db.select().from(settings).where(eq(settings.id, true));
  const capabilities = companyCapabilities(actor);
  const privateDetails =
    profile.detailsCiphertext === null
      ? null
      : openCompany(profile.detailsCiphertext, "details", companyDetailsSchema);
  const details = companyDetailsSchema.parse({
    ...privateDetails,
    companyName: companyName(setting?.companyName, privateDetails?.companyName),
  });
  const entities = capabilities.manageLegal
    ? await db.select().from(companyLegalEntities).orderBy(companyLegalEntities.confirmedAt)
    : [];
  signal.throwIfAborted();
  return {
    workspaceScope: profile.workspaceScope,
    details,
    detailsRevision: profile.detailsRevision,
    branding: brandProjection(profile.branding),
    brandingRevision: profile.brandingRevision,
    baseCurrency: setting?.baseCurrency ?? "USD",
    legalEntities: entities.map(decodeEntity),
    payerPreferences: capabilities.manageLegal
      ? profile.payerCiphertext === null
        ? payerPreferencesSchema.parse({})
        : openCompany(profile.payerCiphertext, "payer", payerPreferencesSchema)
      : null,
    payerRevision: capabilities.manageLegal ? profile.payerRevision : null,
    capabilities,
    confirmedAt: profile.confirmedAt?.toISOString() ?? null,
    provenance: profile.detailsProvenance,
  };
}

/** Member safe. Does not decrypt company/private records or expose document logo. */
export async function getCompanyMemberProjection(db: Db, signal: AbortSignal) {
  signal.throwIfAborted();
  const [profile] = await db
    .select({ branding: companyProfiles.branding, workspaceScope: companyProfiles.workspaceScope })
    .from(companyProfiles)
    .where(eq(companyProfiles.id, true));
  const [setting] = await db
    .select({ companyName: settings.companyName })
    .from(settings)
    .where(eq(settings.id, true));
  signal.throwIfAborted();
  const branding = brandProjection(
    profile?.branding ?? {
      iconAssetId: null,
      logoAssetId: null,
      accentColor: null,
      fit: "contain",
    },
  );
  return {
    workspaceScope: profile?.workspaceScope ?? null,
    displayName: companyName(setting?.companyName),
    iconUrl: branding.iconUrl,
    accentColor: branding.accentColor,
    foregroundColor: branding.foregroundColor,
  };
}
