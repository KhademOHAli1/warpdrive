import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { requireCurrentAuthority } from "@/features/auth/currentAuthority";
import { recordAudit } from "@/features/identity/audit";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { sanitizeCompanyAsset } from "./assetSanitizer";
import type { CompanyAssetStorage } from "./assetStorage";
import type { AssetUploadResult, CompanyCrop, CompanyFailure } from "./contracts";
import { privateFingerprint } from "./crypto";
import { companyCapabilities, companyFailure } from "./policy";
import { assetUrl } from "./readiness";
import { companyAssets, companyOperations, companyProfiles } from "./schema";

const uploadDto = (row: typeof companyAssets.$inferSelect): AssetUploadResult => ({
  assetId: row.id,
  url: assetUrl(row.id) ?? "",
  width: row.width,
  height: row.height,
  contentType: "image/png",
});
export class CompanyAssetService {
  constructor(
    readonly db: Db,
    readonly storage: CompanyAssetStorage,
    readonly signal: AbortSignal,
  ) {}
  async upload(
    actor: PermSetUser,
    requestId: string,
    slot: "icon" | "logo",
    bytes: Buffer,
    crop?: CompanyCrop,
  ): Promise<Result<AssetUploadResult, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    if (!companyCapabilities(actor).manageProfile) return err(companyFailure("forbidden"));
    if (!z.uuid().safeParse(requestId).success) return err(companyFailure("invalid_input"));
    const sanitized = await sanitizeCompanyAsset(bytes, slot, crop, this.signal);
    if (!sanitized.ok) return err(companyFailure("asset_invalid"));
    const digest = createHash("sha256").update(sanitized.value.bytes).digest("hex");
    const fingerprint = privateFingerprint({
      actor: actor.id,
      slot,
      crop: crop ?? null,
      original: createHash("sha256").update(bytes).digest("hex"),
    });
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('company-profile-writes'), 0)`);
      const [operation] = await tx
        .select({ id: companyOperations.requestId })
        .from(companyOperations)
        .where(eq(companyOperations.requestId, requestId));
      if (operation) return err(companyFailure("replay_conflict"));
      const [previous] = await tx
        .select()
        .from(companyAssets)
        .where(eq(companyAssets.requestId, requestId));
      if (
        previous &&
        (previous.createdBy !== actor.id ||
          previous.fingerprint !== fingerprint ||
          previous.digest !== digest)
      )
        return err(companyFailure("replay_conflict"));
      if (previous?.ready === true) return ok(uploadDto(previous));
      const id = previous?.id ?? randomUUID();
      const objectKey = `company-assets/v1/${id}/${digest}.png`;
      if (!previous)
        await tx.insert(companyAssets).values({
          id,
          requestId,
          createdBy: actor.id,
          slot,
          fingerprint,
          objectKey,
          digest,
          width: sanitized.value.width,
          height: sanitized.value.height,
          size: sanitized.value.bytes.length,
        });
      const saved = await this.storage.put(objectKey, sanitized.value.bytes, this.signal);
      if (!saved.ok) return err(companyFailure("storage_unavailable"));
      const [row] = await tx
        .update(companyAssets)
        .set({ ready: true })
        .where(eq(companyAssets.id, id))
        .returning();
      if (!row) return err(companyFailure("write_failed"));
      await recordAudit(
        tx,
        {
          actorId: actor.id,
          targetType: "settings",
          targetId: null,
          action: "company.asset_uploaded",
          after: { slot, assetId: id },
          correlationId: requestId,
        },
        this.signal,
      );
      this.signal.throwIfAborted();
      return ok(uploadDto(row));
    });
  }
  async operation(
    actor: PermSetUser,
    requestId: string,
  ): Promise<Result<AssetUploadResult, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    if (!companyCapabilities(actor).manageProfile) return err(companyFailure("forbidden"));
    const [row] = await this.db
      .select()
      .from(companyAssets)
      .where(eq(companyAssets.requestId, requestId));
    return row?.ready !== true || row.createdBy !== actor.id
      ? err(companyFailure("not_found"))
      : ok(uploadDto(row));
  }
  async read(actor: PermSetUser, id: string): Promise<Result<Buffer, CompanyFailure>> {
    await requireCurrentAuthority(this.db, this.signal);
    const [row] = await this.db.select().from(companyAssets).where(eq(companyAssets.id, id));
    if (row?.ready !== true || !actor.isActive) return err(companyFailure("not_found"));
    if (!companyCapabilities(actor).manageProfile) {
      const [profile] = await this.db
        .select({ branding: companyProfiles.branding })
        .from(companyProfiles)
        .where(eq(companyProfiles.id, true));
      if (profile?.branding.iconAssetId !== id && profile?.branding.logoAssetId !== id)
        return err(companyFailure("not_found"));
    }
    const result = await this.storage.read(row.objectKey, row.size, row.digest, this.signal);
    return result.ok ? result : err(companyFailure("storage_unavailable"));
  }
}
