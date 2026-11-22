import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { type HydratedActor, hydrateActor } from "@/server/hydrateActor";
import { InventoryDomainError } from "../../errors";
import { requireItemReleaseAccess } from "../access";
import { lockReleaseArtifactItem } from "../artifacts";
import { inventoryProductReleases, inventoryReleaseArtifacts } from "../schema";
import type { ExportIntakeBinding, ExportIntakeResult } from "./contracts";

type LockedRelease = { status: "draft" | "released"; qualityPlanVersionId: string | null };

export const exportIntakeId = z.uuid().transform((id) => id.toLowerCase());

export const exportIntakeTargetInput = z.strictObject({
  itemId: exportIntakeId,
  releaseId: exportIntakeId,
  sku: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/u),
  revision: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/u),
});

/** Caller holds the current-authority fence. All intake writers take the product lock first. */
export async function lockExportIntakeTarget(
  tx: Db,
  actor: HydratedActor,
  target: ExportIntakeBinding,
  mode: "read" | "write",
  signal: AbortSignal,
): Promise<ExportIntakeResult<LockedRelease>> {
  const access = mode === "write" ? "edit" : "view";
  try {
    await requireItemReleaseAccess(tx, actor, target.itemId, access);
    await lockReleaseArtifactItem(tx, target.itemId, mode === "write" ? "update" : "share");
    const { item } = await requireItemReleaseAccess(tx, actor, target.itemId, access);
    signal.throwIfAborted();
    const release = inventoryProductReleases;
    const [row] = await tx
      .select({
        revision: release.revision,
        status: release.status,
        qualityPlanVersionId: release.qualityPlanVersionId,
      })
      .from(release)
      .where(and(eq(release.id, target.releaseId), eq(release.itemId, item.id)));
    if (row === undefined) return { ok: false, issues: [{ code: "unavailable" }] };
    if (item.sku !== target.sku || row.revision !== target.revision)
      return { ok: false, issues: [{ code: "wrongTarget" }] };
    if (mode === "write" && row.status !== "draft")
      return { ok: false, issues: [{ code: "draftChanged" }] };
    return {
      ok: true,
      value: { status: row.status, qualityPlanVersionId: row.qualityPlanVersionId },
    };
  } catch (error) {
    if (error instanceof InventoryDomainError)
      return { ok: false, issues: [{ code: "unavailable" }] };
    throw error;
  }
}

/** Files visible to approval and the quality-plan pin are the draft's content version. */
export async function readExportDraftFingerprint(
  tx: Db,
  target: ExportIntakeBinding,
  qualityPlanVersionId: string | null,
) {
  const file = inventoryReleaseArtifacts;
  const artifacts = await tx
    .select({ id: file.id, kind: file.kind, sha256: file.sha256 })
    .from(file)
    .where(and(eq(file.releaseId, target.releaseId), eq(file.state, "ready")))
    .orderBy(asc(file.id));
  return {
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          target.itemId,
          target.releaseId,
          target.sku,
          target.revision,
          qualityPlanVersionId,
          artifacts,
        ]),
      )
      .digest("hex"),
    hasBom: artifacts.some(({ kind }) => kind === "manufacturingBom"),
  };
}

/** Worker jobs carry an attributed user, without creating or extending a browser session. */
export async function readExportSubmitter(tx: Db, submittedBy: string, signal: AbortSignal) {
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, submittedBy),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        eq(users.projectsGuestOnly, false),
      ),
    );
  signal.throwIfAborted();
  return staff === undefined ? null : hydrateActor(tx, staff.id, signal);
}
