import { createHash } from "node:crypto";
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
import { InventoryDomainError } from "../errors";
import { inventoryItems } from "../schema";
import { authorizeBuildRelease, releaseUnavailable, requireItemReleaseAccess } from "./access";
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
  type ReleaseBomEntry,
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
  for (const { releaseId: key, sha256, ...artifact } of artifacts) {
    if (sha256 === null) continue;
    const group = files.get(key) ?? [];
    group.push({ ...artifact, sha256 });
    files.set(key, group);
  }

  return revisions.map(({ createdAt, approvedAt, ...release }) => ({
    ...release,
    createdAt: createdAt.toISOString(),
    approvedAt: approvedAt?.toISOString() ?? null,
    artifacts: files.get(release.id) ?? [],
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

async function resolveApprovedBom(tx: Db, entries: ReleaseBomEntry[]): Promise<ApprovedBomLine[]> {
  const codes = new Set(entries.map(({ sku }) => sku));
  if (
    entries.length === 0 ||
    entries.length > 30 ||
    codes.size !== entries.length ||
    entries.some(
      ({ quantity }) => !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000,
    )
  ) {
    fail("Use distinct stock component SKUs and valid quantities in the manufacturing BOM.");
  }
  const components = await tx
    .select({ itemId: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.kind, "component"), inArray(inventoryItems.sku, [...codes])));
  const bySku = new Map(components.map((component) => [component.sku, component]));
  return entries.map(({ sku, quantity }) => {
    const component = bySku.get(sku);
    if (component === undefined)
      fail("Every manufacturing BOM entry must use an existing component SKU.");
    return { ...component, quantity };
  });
}

async function lockApprovalTarget(
  tx: Db,
  actor: HydratedActor,
  releaseId: string,
  mode: "share" | "update",
) {
  const [candidate] = await tx
    .select({ itemId: inventoryProductReleases.itemId })
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, releaseId));
  if (candidate === undefined) fail();
  // Match order placement and artifact confirmation lock order.
  await lockReleaseProduct(tx, candidate.itemId, mode);
  await requireItemReleaseAccess(tx, actor, candidate.itemId, "approve");
  const [release] = await tx
    .select({ status: inventoryProductReleases.status })
    .from(inventoryProductReleases)
    .where(eq(inventoryProductReleases.id, releaseId))
    .for(mode);
  if (release === undefined) fail();
  return release;
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
  }
  return true;
}

async function approveRelease(
  db: Db,
  who: NativeSessionRef,
  releaseId: string,
  signal: AbortSignal,
  storage?: StorageClient,
) {
  const preflight = await withReleaseActor(db, who, signal, async (tx, actor) => {
    const release = await lockApprovalTarget(tx, actor, releaseId, "share");
    return release.status === "released" ? null : approvalManifest(tx, releaseId);
  });
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
    const release = await lockApprovalTarget(tx, actor, releaseId, "update");
    if (release.status === "released") return { releaseId };

    const manifest = await approvalManifest(tx, releaseId);
    if (JSON.stringify(manifest.files) !== JSON.stringify(verifiedManifest.files)) {
      fail("The package changed during verification. Review its files and approve again.");
    }
    const bom = await resolveApprovedBom(tx, manifest.bomEntries);
    await tx
      .update(inventoryProductReleases)
      .set({ status: "released", approvedBy: actor.id, approvedAt: sql`clock_timestamp()`, bom })
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

export async function executeReleaseMetadata(
  db: Db,
  who: NativeSessionRef,
  input: ReleaseMetadataCommand,
  signal: AbortSignal,
  storage?: StorageClient,
): Promise<ReleaseResult<{ releaseId?: string }>> {
  const parsed = releaseMetadataCommand.safeParse(input);
  if (!parsed.success) return err("Check the manufacturing release details.");
  const command = parsed.data;
  if (command.type === "approve")
    return approveRelease(db, who, command.releaseId, signal, storage);
  return withReleaseActor(db, who, signal, async (tx, actor) => {
    await lockReleaseProduct(tx, command.itemId, "update");
    if (command.type === "createDraft")
      return createDraft(tx, actor, command.itemId, command.revision);
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
