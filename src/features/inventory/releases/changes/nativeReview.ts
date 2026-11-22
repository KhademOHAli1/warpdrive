import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { lockBomReleaseGrants, readBomWhereUsed } from "../../bom/reads";
import { InventoryDomainError } from "../../errors";
import { prepareApprovedBom } from "../approvedBom";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "../schema";
import type { ChangeReview } from "./contracts";
import { failEngineering } from "./errors";
import {
  compareDesign,
  compareMaterials,
  lexical,
  type ReviewedMaterial,
  sortReviewedFiles,
} from "./reviewComparison";

export type EngineeringReviewTarget = {
  itemId: string;
  baseReleaseId: string;
  candidateReleaseId: string;
};

async function readComparisonPackages(tx: Db, target: EngineeringReviewTarget) {
  const release = inventoryProductReleases;
  const artifact = inventoryReleaseArtifacts;
  const ids = [target.baseReleaseId, target.candidateReleaseId];
  const rows = await tx
    .select()
    .from(release)
    .where(and(eq(release.itemId, target.itemId), inArray(release.id, ids)));
  const base = rows.find(({ id, status }) => id === target.baseReleaseId && status === "released");
  const candidate = rows.find(
    ({ id, status }) => id === target.candidateReleaseId && status === "draft",
  );
  if (base === undefined || candidate === undefined) failEngineering("staleReview");
  const files = await tx
    .select({
      id: artifact.id,
      releaseId: artifact.releaseId,
      name: artifact.name,
      kind: artifact.kind,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      bomEntries: artifact.bomEntries,
    })
    .from(artifact)
    .where(and(eq(artifact.state, "ready"), inArray(artifact.releaseId, ids)));
  const filesFor = (id: string) =>
    sortReviewedFiles(
      files.flatMap(({ releaseId, sha256, id: fileId, name, kind, sizeBytes }) =>
        releaseId === id && sha256 !== null ? [{ id: fileId, name, kind, sizeBytes, sha256 }] : [],
      ),
    );
  const before = filesFor(base.id);
  const after = filesFor(candidate.id);
  const rawBom = after.some(({ kind }) => kind === "pcbFabrication")
    ? (files.find(
        ({ releaseId, kind }) => releaseId === candidate.id && kind === "manufacturingBom",
      )?.bomEntries ?? null)
    : null;
  return { base, candidate, before, after, rawBom };
}

function canonicalLines(lines: ApprovedBomLine[]) {
  return [...lines]
    .sort((left, right) => lexical(left.itemId, right.itemId))
    .map(({ itemId, sku, quantity, spec }) => [
      itemId,
      sku,
      quantity,
      spec === undefined
        ? null
        : [
            spec.enteredQuantity,
            spec.enteredUnit,
            spec.stockUnit,
            spec.childReleaseId,
            [...spec.alternatives]
              .sort((left, right) => lexical(left.itemId, right.itemId))
              .map((item) => [item.itemId, item.sku, item.quantity, item.stockUnit]),
            spec.optional,
            spec.consumable,
            spec.inherited,
            spec.pieces,
          ],
    ]);
}

function packageFingerprint(
  packages: Awaited<ReturnType<typeof readComparisonPackages>>,
  resolvedBom: ApprovedBomLine[] | null,
) {
  const { base, candidate, before, after } = packages;
  return createHash("sha256")
    .update(
      JSON.stringify([
        base.itemId,
        [base.id, base.revision, base.qualityPlanVersionId, before, canonicalLines(base.bom)],
        [
          candidate.id,
          candidate.revision,
          candidate.qualityPlanVersionId,
          after,
          resolvedBom === null ? null : canonicalLines(resolvedBom),
        ],
      ]),
    )
    .digest("hex");
}

export async function confirmEngineeringReviewFingerprint(
  tx: Db,
  target: EngineeringReviewTarget,
  bom: ApprovedBomLine[],
) {
  return packageFingerprint(await readComparisonPackages(tx, target), bom);
}

async function childRevisions(tx: Db, lines: ApprovedBomLine[]) {
  const ids = [
    ...new Set(
      lines.flatMap(({ spec }) => (spec?.childReleaseId == null ? [] : [spec.childReleaseId])),
    ),
  ];
  if (ids.length === 0) return new Map<string, string>();
  const release = inventoryProductReleases;
  const rows = await tx
    .select({ id: release.id, revision: release.revision })
    .from(release)
    .where(inArray(release.id, ids));
  return new Map(rows.map(({ id, revision }) => [id, revision]));
}

function reviewedMaterials(
  lines: ApprovedBomLine[],
  children: ReadonlyMap<string, string>,
): ReviewedMaterial[] {
  return lines.map(({ itemId: key, sku, quantity, spec }) => ({
    key,
    sku,
    material: {
      quantity: spec?.enteredQuantity ?? String(quantity),
      unit: spec?.enteredUnit ?? null,
      childRelease:
        spec?.childReleaseId == null ? null : (children.get(spec.childReleaseId) ?? null),
      alternatives: (spec?.alternatives ?? []).map(({ sku }) => sku).sort(lexical),
      optional: spec?.optional ?? false,
      consumable: spec?.consumable ?? false,
      inherited: spec?.inherited ?? false,
      pieces: spec?.pieces ?? null,
    },
  }));
}

async function relevantUse(
  tx: Db,
  actor: HydratedActor,
  materials: ChangeReview["materials"],
  signal: AbortSignal,
) {
  if (materials.length === 0) return [];
  const scope = await lockBomReleaseGrants(tx, actor);
  const usage: ChangeReview["whereUsed"] = [];
  for (const { key, sku } of materials) {
    signal.throwIfAborted();
    const linked = await readBomWhereUsed(tx, scope, key);
    for (const { release } of linked) {
      usage.push({
        key: `${release.id}:${key}`,
        parentSku: release.part.sku,
        revision: release.revision,
        componentSku: sku,
      });
      if (usage.length === 120) return usage;
    }
  }
  return usage;
}

async function resolveCandidate(
  tx: Db,
  actor: HydratedActor,
  packages: Awaited<ReturnType<typeof readComparisonPackages>>,
  signal: AbortSignal,
) {
  const { candidate, rawBom } = packages;
  if (rawBom === null) return null;
  try {
    return (await prepareApprovedBom(tx, actor, candidate, rawBom, signal)).bom;
  } catch (error) {
    if (error instanceof InventoryDomainError) return null;
    throw error;
  }
}

export async function readEngineeringReview(
  tx: Db,
  actor: HydratedActor,
  target: EngineeringReviewTarget,
  signal: AbortSignal,
): Promise<ChangeReview> {
  const packages = await readComparisonPackages(tx, target);
  const { base, candidate, before, after } = packages;
  const resolved = await resolveCandidate(tx, actor, packages, signal);
  const children = await childRevisions(tx, resolved === null ? [] : [...base.bom, ...resolved]);
  const materials =
    resolved === null
      ? []
      : compareMaterials(
          reviewedMaterials(base.bom, children),
          reviewedMaterials(resolved, children),
        );
  return {
    base: { id: base.id, revision: base.revision, status: "released" },
    candidate: { id: candidate.id, revision: candidate.revision, status: "draft" },
    fingerprint: packageFingerprint(packages, resolved),
    ready: resolved !== null,
    design: compareDesign(before, after),
    materials,
    whereUsed: await relevantUse(tx, actor, materials, signal),
  };
}
