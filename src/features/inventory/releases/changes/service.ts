import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { StorageClient } from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor } from "../../access";
import { lockInventoryCatalog } from "../../catalog/policy";
import { InventoryDomainError } from "../../errors";
import { requireItemReleaseAccess } from "../access";
import { lockReleaseArtifactItem } from "../artifacts";
import { inventoryProductReleases as releases } from "../schema";
import { approveReviewedEngineeringRelease, findActiveRelease } from "../service";
import type { ReviewedEngineeringApproval } from "./approvalControl";
import type {
  ChangeReview,
  EngineeringChange,
  EngineeringChangeCommand,
  EngineeringChangeResult,
  EngineeringChangeWorkspace,
} from "./contracts";
import {
  applyEngineeringDisposition,
  authorizeEngineeringDispositionReplay,
  readEngineeringStock,
} from "./disposition";
import { engineeringSchemaAvailable, readEngineeringReleasePolicy } from "./effectivity";
import { engineeringFailure, failEngineering } from "./errors";
import { engineeringCommandInput } from "./nativeContracts";
import { readEngineeringReview } from "./nativeReview";
import {
  advanceEngineeringChange,
  findEngineeringReceipt,
  readEngineeringTime,
  recordEngineeringEvent,
  requireEngineeringChange,
  storeEngineeringReceipt,
} from "./records";
import {
  inventoryEngineeringChanges as changes,
  inventoryEngineeringEvents as events,
} from "./schema";

type AuthorityWork<T> = (tx: Db, actor: HydratedActor) => Promise<T>;
type Submit = Extract<EngineeringChangeCommand, { type: "submit" }>;
type Decision = Extract<EngineeringChangeCommand, { type: "return" | "withdraw" }>;
type OrdinaryChange = Submit | Decision;

async function withEngineeringAuthority<T>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  work: AuthorityWork<T>,
): Promise<EngineeringChangeResult<T>> {
  try {
    const value = await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null || !(await engineeringSchemaAvailable(tx))) failEngineering("unavailable");
      const value = await work(tx, actor);
      if ((await currentInventoryActor(tx, who, signal)) === null) failEngineering("unavailable");
      return value;
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof InventoryDomainError) return engineeringFailure(error.message);
    throw error;
  }
}

async function presentChanges(tx: Db, itemId: string): Promise<EngineeringChange[]> {
  const rows = await tx
    .select()
    .from(changes)
    .where(eq(changes.itemId, itemId))
    .orderBy(desc(changes.updatedAt), desc(changes.id))
    .limit(40);
  if (rows.length === 0) return [];
  const history = await tx
    .select({
      changeId: events.changeId,
      id: events.id,
      type: events.type,
      actor: events.actorName,
      note: events.note,
      at: events.createdAt,
    })
    .from(events)
    .where(
      inArray(
        events.changeId,
        rows.map(({ id }) => id),
      ),
    )
    .orderBy(asc(events.version));
  const byChange = new Map<string, EngineeringChange["history"]>();
  for (const { changeId, at, ...event } of history) {
    const list = byChange.get(changeId) ?? [];
    list.push({ ...event, at: at.toISOString() });
    byChange.set(changeId, list);
  }
  return rows.map(({ id, version, status, review, reason, effectiveAt }) => ({
    id,
    version,
    status,
    review,
    reason,
    effectiveAt: effectiveAt.toISOString(),
    history: byChange.get(id) ?? [],
  }));
}

export function readEngineeringWorkspace(
  db: Db,
  who: NativeSessionRef,
  itemId: string,
  signal: AbortSignal,
): Promise<EngineeringChangeResult<EngineeringChangeWorkspace>> {
  return withEngineeringAuthority(db, who, signal, async (tx, actor) => {
    await requireItemReleaseAccess(tx, actor, itemId, "view");
    // Warehouse takes Catalog and Directory locks before it reads its scoped stock.
    const stock = await readEngineeringStock(tx, actor, itemId, signal);
    await lockReleaseArtifactItem(tx, itemId, "share");
    const { item, permissions } = await requireItemReleaseAccess(tx, actor, itemId, "view");
    const policy = await readEngineeringReleasePolicy(tx, itemId);
    const effective = await findActiveRelease(tx, itemId, policy);
    const candidates = await tx
      .select({ id: releases.id, revision: releases.revision, status: releases.status })
      .from(releases)
      .where(and(eq(releases.itemId, itemId), eq(releases.status, "draft")))
      .orderBy(desc(releases.createdAt), desc(releases.id))
      .limit(40);
    return {
      itemId,
      sku: item.sku,
      observedAt: policy.observedAt,
      effectiveRelease:
        effective === null
          ? null
          : { id: effective.id, revision: effective.revision, status: effective.status },
      candidates,
      canPropose: permissions.edit,
      canDecide: permissions.approve,
      changes: await presentChanges(tx, itemId),
      stock,
    };
  });
}

export function readEngineeringChangeReview(
  db: Db,
  who: NativeSessionRef,
  itemId: string,
  candidateReleaseId: string,
  signal: AbortSignal,
): Promise<EngineeringChangeResult<ChangeReview>> {
  return withEngineeringAuthority(db, who, signal, async (tx, actor) => {
    await lockInventoryCatalog(tx, signal);
    await lockReleaseArtifactItem(tx, itemId, "share");
    await requireItemReleaseAccess(tx, actor, itemId, "edit");
    const current = await findActiveRelease(tx, itemId);
    if (current === null) failEngineering("unavailable");
    return readEngineeringReview(
      tx,
      actor,
      { itemId, baseReleaseId: current.id, candidateReleaseId },
      signal,
    );
  });
}

async function submitProposal(tx: Db, actor: HydratedActor, command: Submit, signal: AbortSignal) {
  const { itemId, baseReleaseId, candidateReleaseId, reason } = command;
  const effectiveAt = new Date(command.effectiveAt);
  const at = await readEngineeringTime(tx);
  if (!Number.isFinite(effectiveAt.valueOf()) || effectiveAt <= at)
    failEngineering("effectiveDate");
  const active = await findActiveRelease(tx, itemId);
  if (active?.id !== baseReleaseId || baseReleaseId === candidateReleaseId)
    failEngineering("staleReview");
  const [scheduled] = await tx
    .select({ id: changes.id })
    .from(changes)
    .where(
      and(eq(changes.itemId, itemId), eq(changes.status, "approved"), gt(changes.effectiveAt, at)),
    )
    .limit(1);
  if (scheduled !== undefined) failEngineering("conflict");
  const review = await readEngineeringReview(
    tx,
    actor,
    { itemId, baseReleaseId, candidateReleaseId },
    signal,
  );
  if (review.fingerprint !== command.fingerprint) failEngineering("staleReview");
  if (!review.ready) failEngineering("packageIncomplete");
  const now = await readEngineeringTime(tx);
  if (effectiveAt <= now) failEngineering("effectiveDate");
  const details = { reason, effectiveAt, review, fingerprint: review.fingerprint };
  if (command.revise !== undefined) {
    const prior = await requireEngineeringChange(tx, itemId, command.revise.changeId);
    if (
      prior.status !== "returned" ||
      prior.version !== command.revise.expectedVersion ||
      prior.baseReleaseId !== baseReleaseId ||
      prior.candidateReleaseId !== candidateReleaseId
    )
      failEngineering("conflict");
    const saved = await advanceEngineeringChange(tx, prior, { ...details, status: "review" }, now);
    await recordEngineeringEvent(tx, actor, saved, { type: "submitted", review });
    return saved.id;
  }
  const [saved] = await tx
    .insert(changes)
    .values({
      ...details,
      itemId,
      baseReleaseId,
      candidateReleaseId,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (saved === undefined) failEngineering("conflict");
  await recordEngineeringEvent(tx, actor, saved, { type: "submitted", review });
  return saved.id;
}

async function recordDecision(tx: Db, actor: HydratedActor, command: Decision) {
  const current = await requireEngineeringChange(tx, command.itemId, command.changeId);
  if (
    current.version !== command.expectedVersion ||
    (current.status !== "review" && !(current.status === "returned" && command.type === "withdraw"))
  )
    failEngineering("conflict");
  const status = command.type === "return" ? "returned" : "withdrawn";
  const updated = await advanceEngineeringChange(
    tx,
    current,
    { status },
    await readEngineeringTime(tx),
  );
  await recordEngineeringEvent(tx, actor, updated, {
    type: status,
    note: command.type === "return" ? command.note : undefined,
  });
  return updated.id;
}

async function runOrdinaryChange(
  tx: Db,
  actor: HydratedActor,
  command: OrdinaryChange,
  signal: AbortSignal,
) {
  await lockInventoryCatalog(tx, signal);
  await lockReleaseArtifactItem(tx, command.itemId, "update");
  await requireItemReleaseAccess(
    tx,
    actor,
    command.itemId,
    command.type === "return" ? "approve" : "edit",
  );
  if ((await findEngineeringReceipt(tx, actor, command)) !== null) return;
  const result =
    command.type === "submit"
      ? await submitProposal(tx, actor, command, signal)
      : await recordDecision(tx, actor, command);
  await storeEngineeringReceipt(tx, actor, command, result);
}

async function approveChange(
  db: Db,
  who: NativeSessionRef,
  command: ReviewedEngineeringApproval,
  signal: AbortSignal,
  storage?: StorageClient,
) {
  const target = await withEngineeringAuthority(db, who, signal, async (tx, actor) => {
    const { itemId, changeId } = command;
    await lockReleaseArtifactItem(tx, itemId, "share");
    await requireItemReleaseAccess(tx, actor, itemId, "approve");
    const row = await requireEngineeringChange(tx, itemId, changeId);
    const [candidate] = await tx
      .select({ id: releases.id, qualityPlanVersionId: releases.qualityPlanVersionId })
      .from(releases)
      .where(and(eq(releases.id, row.candidateReleaseId), eq(releases.itemId, itemId)))
      .limit(1);
    if (candidate === undefined) failEngineering("unavailable");
    return candidate;
  });
  if (!target.ok) return target;
  const approved = await approveReviewedEngineeringRelease(
    db,
    who,
    command,
    target.value.id,
    target.value.qualityPlanVersionId,
    signal,
    storage,
  );
  return approved.ok ? approved : engineeringFailure(approved.error);
}

export async function executeEngineeringChange(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
  storage?: StorageClient,
): Promise<EngineeringChangeResult<EngineeringChangeWorkspace>> {
  const parsed = engineeringCommandInput.safeParse(raw);
  if (!parsed.success) return engineeringFailure("invalid");
  const command = parsed.data;
  const result =
    command.type === "approve"
      ? await approveChange(db, who, command, signal, storage)
      : await withEngineeringAuthority(db, who, signal, async (tx, actor) => {
          if (command.type !== "disposition") return runOrdinaryChange(tx, actor, command, signal);
          await authorizeEngineeringDispositionReplay(tx, actor, command, signal);
          if ((await findEngineeringReceipt(tx, actor, command)) !== null) return;
          const { changeId } = await applyEngineeringDisposition(tx, actor, command, signal);
          await storeEngineeringReceipt(tx, actor, command, changeId);
        });
  return result.ok ? readEngineeringWorkspace(db, who, command.itemId, signal) : result;
}
