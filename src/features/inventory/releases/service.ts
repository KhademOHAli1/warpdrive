import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { currentInventoryActor } from "../access";
import { catalogItemPolicy, lockInventoryCatalog } from "../catalog/policy";
import { InventoryDomainError } from "../errors";
import {
  createQualityPlanVersion,
  readQualityPlanVersions,
  requireQualityPlanVersion,
} from "../quality/plans";
import { inventoryItems } from "../schema";
import { authorizeBuildRelease, releaseUnavailable, requireItemReleaseAccess } from "./access";
import {
  lockBomApprovalParts,
  prepareApprovedBom,
  requireApprovalGraphAccess,
} from "./approvedBom";
import { parseReleaseBom } from "./bomCsv";
import {
  type BuildRelease,
  type ReleaseMetadataCommand,
  type ReleaseView,
  type ReleaseWorkspace,
  releaseMetadataCommand,
} from "./liveContracts";
import {
  type ApprovedBomLine,
  inventoryProductReleases,
  inventoryReleaseArtifacts,
  inventoryReleaseGrants,
} from "./schema";

type ReleaseResult<T> = Result<T, string>;

function fail(message = releaseUnavailable): never {
  throw new InventoryDomainError(message);
}

async function withReleaseActor<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor) => Promise<T>,
): Promise<ReleaseResult<T>> {
  try {
    const result = await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) fail();
      const value = await run(tx, actor);
      if ((await currentInventoryActor(tx, who, signal)) === null) fail();
      return value;
    });
    return ok(result);
  } catch (error) {
    if (error instanceof InventoryDomainError) return err(error.message);
    throw error;
  }
}

export async function findActiveRelease(tx: Db, itemId: string) {
  const [release] = await tx
    .select()
    .from(inventoryProductReleases)
    .where(
      and(
        eq(inventoryProductReleases.itemId, itemId),
        eq(inventoryProductReleases.status, "released"),
      ),
    )
    .orderBy(desc(inventoryProductReleases.approvedAt), desc(inventoryProductReleases.id))
    .limit(1);
  return release ?? null;
}

const releaseCreator = alias(users, "inventory_release_creator");
const releaseApprover = alias(users, "inventory_release_approver");

function hasPlanningSpec({ spec }: ApprovedBomLine) {
  if (spec === undefined) return false;
  return (
    spec.childReleaseId !== null ||
    spec.optional ||
    spec.consumable ||
    spec.inherited ||
    spec.alternatives.length > 0 ||
    spec.pieces !== null ||
    spec.enteredUnit !== spec.stockUnit
  );
}

async function releaseViews(tx: Db, itemId: string, releaseId?: string): Promise<ReleaseView[]> {
  const revisions = await tx
    .select({
      id: inventoryProductReleases.id,
      revision: inventoryProductReleases.revision,
      status: inventoryProductReleases.status,
      createdAt: inventoryProductReleases.createdAt,
      createdBy: { id: releaseCreator.id, name: releaseCreator.name },
      approvedAt: inventoryProductReleases.approvedAt,
      approvedBy: { id: releaseApprover.id, name: releaseApprover.name },
      // The classic CRM build view can only pin ungated releases.
      qualityPlanVersionId:
        releaseId === undefined ? inventoryProductReleases.qualityPlanVersionId : sql<null>`NULL`,
      bom: inventoryProductReleases.bom,
    })
    .from(inventoryProductReleases)
    .innerJoin(releaseCreator, eq(inventoryProductReleases.createdBy, releaseCreator.id))
    .leftJoin(releaseApprover, eq(inventoryProductReleases.approvedBy, releaseApprover.id))
    .where(
      and(
        eq(inventoryProductReleases.itemId, itemId),
        releaseId === undefined ? undefined : eq(inventoryProductReleases.id, releaseId),
      ),
    )
    .orderBy(desc(inventoryProductReleases.createdAt), desc(inventoryProductReleases.id));
  if (revisions.length === 0) return [];

  const artifacts = await tx
    .select({
      releaseId: inventoryReleaseArtifacts.releaseId,
      id: inventoryReleaseArtifacts.id,
      kind: inventoryReleaseArtifacts.kind,
      name: inventoryReleaseArtifacts.name,
      sizeBytes: inventoryReleaseArtifacts.sizeBytes,
      sha256: inventoryReleaseArtifacts.sha256,
    })
    .from(inventoryReleaseArtifacts)
    .where(
      and(
        inArray(
          inventoryReleaseArtifacts.releaseId,
          revisions.map(({ id }) => id),
        ),
        eq(inventoryReleaseArtifacts.state, "ready"),
      ),
    )
    .orderBy(asc(inventoryReleaseArtifacts.createdAt), asc(inventoryReleaseArtifacts.id));
  const files = new Map<string, ReleaseView["artifacts"]>();
  const sources = new Map<string, NonNullable<ReleaseView["pcbSourceArtifacts"]>>();
  for (const { releaseId: key, kind, sha256, ...artifact } of artifacts) {
    if (sha256 === null) continue;
    if (kind === "pcbSource") {
      const group = sources.get(key) ?? [];
      group.push({ ...artifact, kind, sha256 });
      sources.set(key, group);
    } else {
      const group = files.get(key) ?? [];
      group.push({ ...artifact, kind, sha256 });
      files.set(key, group);
    }
  }

  return revisions.map(({ createdAt, approvedAt, bom, ...release }) => ({
    ...release,
    // The existing package and pinned build views carry the direct BOM only.
    bom: bom.map(({ itemId, sku, name, quantity }) => ({ itemId, sku, name, quantity })),
    ...(releaseId === undefined && bom.some(hasPlanningSpec)
      ? { hasPlanningBom: true as const }
      : {}),
    createdAt: createdAt.toISOString(),
    approvedAt: approvedAt?.toISOString() ?? null,
    artifacts: files.get(release.id) ?? [],
    ...(sources.has(release.id) ? { pcbSourceArtifacts: sources.get(release.id) } : {}),
  }));
}

function activeStaff() {
  return and(eq(users.isActive, true), isNull(users.invitedAt), eq(users.projectsGuestOnly, false));
}

async function readReleaseAdministration(tx: Db, itemId: string) {
  const grants = await tx
    .select({ userId: users.id, name: users.name, role: inventoryReleaseGrants.role })
    .from(inventoryReleaseGrants)
    .innerJoin(users, eq(inventoryReleaseGrants.userId, users.id))
    .where(eq(inventoryReleaseGrants.itemId, itemId))
    .orderBy(asc(users.name), asc(users.id));
  const staff = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(activeStaff(), eq(users.isAdmin, false)))
    .orderBy(asc(users.name), asc(users.id));
  return { grants, staff };
}

export async function readReleaseWorkspace(
  db: Db,
  who: NativeSessionRef,
  itemId: string,
  signal: AbortSignal,
): Promise<ReleaseResult<ReleaseWorkspace>> {
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    // Hold the product lock through projection so revocation and approval order consistently.
    await lockReleaseProduct(tx, itemId, "share");
    const { item, permissions } = await requireItemReleaseAccess(tx, actor, itemId, "view");
    const activeRelease = await findActiveRelease(tx, itemId);
    const releases = await releaseViews(tx, itemId);
    const administration = permissions.manage
      ? await readReleaseAdministration(tx, itemId)
      : { grants: [], staff: [] };
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      releaseRequired: item.releaseRequired,
      activeReleaseId: activeRelease?.id ?? null,
      canEdit: permissions.edit,
      canApprove: permissions.approve,
      canManage: permissions.manage,
      releases,
      qualityPlanVersions: await readQualityPlanVersions(tx, itemId),
      intakeAvailable: true,
      ...administration,
    };
  });
}

export async function readBuildRelease(
  db: Db,
  who: NativeSessionRef,
  orderId: string,
  signal: AbortSignal,
): Promise<ReleaseResult<BuildRelease>> {
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    const { release: pinned, ...build } = await authorizeBuildRelease(tx, actor, orderId, signal);
    const [release] = await releaseViews(tx, build.itemId, pinned.id);
    if (release?.status !== "released") fail();
    return { ...build, release };
  });
}

async function lockReleaseProduct(tx: Db, itemId: string, mode: "share" | "update") {
  const [row] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.kind, "product")))
    .for(mode);
  if (row === undefined) fail();
}

async function requireApprovalTarget(
  tx: Db,
  actor: HydratedActor,
  itemId: string,
  releaseId: string,
  mode: "share" | "update",
) {
  await requireItemReleaseAccess(tx, actor, itemId, "approve");
  const [release] = await tx
    .select({
      status: inventoryProductReleases.status,
      qualityPlanVersionId: inventoryProductReleases.qualityPlanVersionId,
    })
    .from(inventoryProductReleases)
    .where(
      and(eq(inventoryProductReleases.id, releaseId), eq(inventoryProductReleases.itemId, itemId)),
    )
    .for(mode);
  if (release === undefined) fail();
  return release;
}

async function readApprovalCandidate(
  tx: Db,
  actor: HydratedActor,
  releaseId: string,
  expectedQualityPlanVersionId: string | null,
) {
  const [candidate] = await tx
    .select({ itemId: inventoryProductReleases.itemId })
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, releaseId));
  if (candidate === undefined) fail();
  const { itemId } = candidate;
  await lockReleaseProduct(tx, itemId, "share");
  const release = await requireApprovalTarget(tx, actor, itemId, releaseId, "share");
  if (release.status === "released") return null;
  if (release.qualityPlanVersionId !== expectedQualityPlanVersionId)
    fail("The test plan changed. Review the pinned version before approving.");
  return {
    itemId,
    qualityPlanVersionId: release.qualityPlanVersionId,
    ...(await approvalManifest(tx, releaseId)),
  };
}

async function approvalManifest(tx: Db, releaseId: string) {
  const files = await tx
    .select({
      id: inventoryReleaseArtifacts.id,
      kind: inventoryReleaseArtifacts.kind,
      name: inventoryReleaseArtifacts.name,
      contentType: inventoryReleaseArtifacts.contentType,
      objectKey: inventoryReleaseArtifacts.objectKey,
      sizeBytes: inventoryReleaseArtifacts.sizeBytes,
      sha256: inventoryReleaseArtifacts.sha256,
      etag: inventoryReleaseArtifacts.etag,
      bomEntries: inventoryReleaseArtifacts.bomEntries,
    })
    .from(inventoryReleaseArtifacts)
    .where(
      and(
        eq(inventoryReleaseArtifacts.releaseId, releaseId),
        eq(inventoryReleaseArtifacts.state, "ready"),
      ),
    )
    .orderBy(asc(inventoryReleaseArtifacts.id));
  const bomEntries = files.find(({ kind }) => kind === "manufacturingBom")?.bomEntries;
  if (bomEntries == null || !files.some(({ kind }) => kind === "pcbFabrication")) {
    fail("Confirm a PCB fabrication ZIP and manufacturing BOM CSV before approval.");
  }
  return { files, bomEntries };
}

async function checkApprovalBytes(
  storage: StorageClient,
  { files }: Awaited<ReturnType<typeof approvalManifest>>,
  signal: AbortSignal,
) {
  for (const file of files) {
    const bytes = await storage.getObjectBytes(file.objectKey, signal, file.sizeBytes);
    if (
      !bytes.ok ||
      bytes.value.length !== file.sizeBytes ||
      createHash("sha256").update(bytes.value).digest("hex") !== file.sha256
    ) {
      return false;
    }
    if (
      file.kind === "manufacturingBom" &&
      !isDeepStrictEqual(parseReleaseBom(bytes.value), file.bomEntries)
    ) {
      return false;
    }
  }
  return true;
}

async function approveRelease(
  db: Db,
  who: NativeSessionRef,
  releaseId: string,
  expectedQualityPlanVersionId: string | null,
  signal: AbortSignal,
  storage?: StorageClient,
) {
  const preflight = await withReleaseActor(db, who, signal, (tx, actor) =>
    readApprovalCandidate(tx, actor, releaseId, expectedQualityPlanVersionId),
  );
  if (!preflight.ok) return preflight;
  if (preflight.value === null) return ok({ releaseId });

  // Read bounded files one at a time, outside the authorization and product locks.
  const verifiedManifest = preflight.value;
  const verified = await checkApprovalBytes(
    storage ?? makeStorageClient(),
    verifiedManifest,
    signal,
  );
  if (!verified)
    return err(
      "An attachment failed its integrity check. Restore the confirmed file or upload it again.",
    );

  return withReleaseActor(db, who, signal, async (tx, actor) => {
    await lockInventoryCatalog(tx, signal);
    const { itemId, bomEntries } = verifiedManifest;
    await requireItemReleaseAccess(tx, actor, itemId, "approve");
    const graph = await prepareApprovedBom(
      tx,
      actor,
      { id: releaseId, itemId },
      bomEntries,
      signal,
    );
    await lockBomApprovalParts(tx, itemId, graph.parts);
    const release = await requireApprovalTarget(tx, actor, itemId, releaseId, "update");
    if (release.status === "released") return { releaseId };
    await requireApprovalGraphAccess(tx, actor, graph);

    const manifest = await approvalManifest(tx, releaseId);
    if (
      release.qualityPlanVersionId !== verifiedManifest.qualityPlanVersionId ||
      !isDeepStrictEqual(manifest.files, verifiedManifest.files)
    ) {
      fail("The package changed during verification. Review its files and approve again.");
    }
    if (
      release.qualityPlanVersionId !== null &&
      (await catalogItemPolicy(tx, itemId))?.flags.trackable !== true
    ) {
      fail("Enable serial tracking for this product before approving a test plan.");
    }
    await tx
      .update(inventoryProductReleases)
      .set({
        status: "released",
        approvedBy: actor.id,
        approvedAt: sql`clock_timestamp()`,
        bom: graph.bom,
      })
      .where(eq(inventoryProductReleases.id, releaseId));
    return { releaseId };
  });
}

async function createDraft(tx: Db, actor: HydratedActor, itemId: string, revision: string) {
  await requireItemReleaseAccess(tx, actor, itemId, "edit");
  const [inserted] = await tx
    .insert(inventoryProductReleases)
    .values({ itemId, revision, createdBy: actor.id })
    .onConflictDoNothing({
      target: [inventoryProductReleases.itemId, inventoryProductReleases.revision],
    })
    .returning({ releaseId: inventoryProductReleases.id });
  if (inserted !== undefined) return inserted;

  const [existing] = await tx
    .select({
      releaseId: inventoryProductReleases.id,
      createdBy: inventoryProductReleases.createdBy,
    })
    .from(inventoryProductReleases)
    .where(
      and(
        eq(inventoryProductReleases.itemId, itemId),
        eq(inventoryProductReleases.revision, revision),
      ),
    );
  if (existing?.createdBy !== actor.id) fail("That product revision already exists.");
  return { releaseId: existing.releaseId };
}

async function setReleaseGrant(
  tx: Db,
  { itemId, userId, role }: Extract<ReleaseMetadataCommand, { type: "setGrant" }>,
) {
  if (role === null) {
    await tx
      .delete(inventoryReleaseGrants)
      .where(
        and(eq(inventoryReleaseGrants.itemId, itemId), eq(inventoryReleaseGrants.userId, userId)),
      );
    return;
  }
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), activeStaff(), eq(users.isAdmin, false)));
  if (staff === undefined)
    fail("Choose an active staff account for the manufacturing release role.");
  await tx
    .insert(inventoryReleaseGrants)
    .values({ itemId, userId, role })
    .onConflictDoUpdate({
      target: [inventoryReleaseGrants.itemId, inventoryReleaseGrants.userId],
      set: { role },
    });
}

async function setReleaseQualityPlan(
  tx: Db,
  actor: HydratedActor,
  { releaseId, planVersionId }: Extract<ReleaseMetadataCommand, { type: "setQualityPlan" }>,
) {
  const [candidate] = await tx
    .select({ itemId: inventoryProductReleases.itemId })
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, releaseId));
  if (candidate === undefined) fail();
  const { itemId } = candidate;
  await lockReleaseProduct(tx, itemId, "update");
  await requireItemReleaseAccess(tx, actor, itemId, "edit");
  const [draft] = await tx
    .select({ id: inventoryProductReleases.id })
    .from(inventoryProductReleases)
    .where(
      and(eq(inventoryProductReleases.id, releaseId), eq(inventoryProductReleases.status, "draft")),
    )
    .for("update");
  if (draft === undefined) fail("The approved release is sealed.");
  if (planVersionId !== null) await requireQualityPlanVersion(tx, itemId, planVersionId);
  await tx
    .update(inventoryProductReleases)
    .set({ qualityPlanVersionId: planVersionId })
    .where(eq(inventoryProductReleases.id, releaseId));
  return { releaseId };
}

export async function executeReleaseMetadata(
  db: Db,
  who: NativeSessionRef,
  input: ReleaseMetadataCommand,
  signal: AbortSignal,
  storage?: StorageClient,
): Promise<ReleaseResult<{ releaseId?: string; planVersionId?: string }>> {
  const parsed = releaseMetadataCommand.safeParse(input);
  if (!parsed.success) return err("Check the manufacturing release details.");
  const command = parsed.data;
  if (command.type === "approve") {
    return approveRelease(
      db,
      who,
      command.releaseId,
      command.expectedQualityPlanVersionId ?? null,
      signal,
      storage,
    );
  }
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    if (command.type === "setQualityPlan") return setReleaseQualityPlan(tx, actor, command);
    await lockReleaseProduct(tx, command.itemId, "update");
    if (command.type === "createDraft")
      return createDraft(tx, actor, command.itemId, command.revision);
    if (command.type === "createQualityPlanVersion") {
      await requireItemReleaseAccess(tx, actor, command.itemId, "edit");
      return createQualityPlanVersion(tx, actor.id, command);
    }
    await requireItemReleaseAccess(tx, actor, command.itemId, "manage");
    if (command.type === "setRequirement") {
      await tx
        .update(inventoryItems)
        .set({ releaseRequired: command.required })
        .where(eq(inventoryItems.id, command.itemId));
    } else {
      await setReleaseGrant(tx, command);
    }
    return {};
  });
}
