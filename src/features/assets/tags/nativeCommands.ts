import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { physicalLabels } from "@/features/physical-labels/schema";
import type { AssetSite } from "../contracts";
import {
  type AssetTagCommand,
  type AssetTagResult,
  type AssetTagTargetRef,
  assetTagCommand,
} from "./contracts";
import { type LegacyTagIdentifier, parseLegacyTagIdentifier } from "./legacyImport";
import {
  activeTarget,
  fail,
  invalid,
  readTagWorkspace,
  type TagAssignment,
  type TagCode,
  TagFailure,
  targetRef,
  withTagActor,
} from "./nativeScope";
import {
  assetTagAssignments,
  assetTagBatches,
  assetTagBindingEvents,
  assetTagCodes,
  assetTagOwnerMessages,
  assetTagReceipts,
} from "./schema";
import { assetTagText, tagOrigin } from "./tagCodes";

type BatchCommand = Extract<AssetTagCommand, { type: "createBatch" | "importLegacy" }>;
type TagCommand = Exclude<AssetTagCommand, BatchCommand | { type: "markMessageRead" }>;

async function tagById(tx: Db, tagId: string) {
  const [tag] = await tx.select().from(assetTagCodes).where(eq(assetTagCodes.id, tagId)).limit(1);
  return tag;
}

async function messageSite(tx: Db, messageId: string) {
  const [row] = await tx
    .select({ siteId: assetTagOwnerMessages.siteId, tagId: assetTagOwnerMessages.tagId })
    .from(assetTagOwnerMessages)
    .where(eq(assetTagOwnerMessages.id, messageId))
    .limit(1);
  return row;
}

async function commandSite(tx: Db, command: AssetTagCommand) {
  if ("siteId" in command) return command.siteId;
  if (command.type === "markMessageRead") return (await messageSite(tx, command.messageId))?.siteId;
  return (await tagById(tx, command.tagId))?.siteId;
}

async function currentAssignment(tx: Db, tagId: string) {
  const [assignment] = await tx
    .select()
    .from(assetTagAssignments)
    .where(and(eq(assetTagAssignments.tagId, tagId), isNull(assetTagAssignments.endedAt)))
    .limit(1);
  return assignment;
}

async function requireTarget(tx: Db, site: AssetSite, target: AssetTagTargetRef) {
  const scoped = await activeTarget(tx, [site], target);
  if (scoped?.canManage !== true) fail("unavailable");
  return scoped;
}

function recordBinding(
  tx: Db,
  assignment: TagAssignment,
  actorId: string,
  kind: typeof assetTagBindingEvents.$inferInsert.kind,
  ownerContactEnabled: boolean | null = null,
) {
  return tx.insert(assetTagBindingEvents).values({
    siteId: assignment.siteId,
    tagId: assignment.tagId,
    assignmentId: assignment.id,
    actorId,
    kind,
    ownerContactEnabled,
  });
}

async function bind(
  tx: Db,
  tag: Pick<TagCode, "id" | "siteId">,
  target: AssetTagTargetRef,
  actorId: string,
  kind: "claim" | "swap" | "import",
) {
  const [created] = await tx
    .insert(assetTagAssignments)
    .values({
      siteId: tag.siteId,
      tagId: tag.id,
      targetKind: target.kind,
      targetId: target.id,
      assetId: target.kind === "asset" ? target.id : null,
      kitId: target.kind === "kit" ? target.id : null,
      assignedBy: actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (created === undefined) fail("conflict");
  await recordBinding(tx, created, actorId, kind);
}

async function end(tx: Db, assignment: TagAssignment, actorId: string) {
  await tx
    .update(assetTagAssignments)
    .set({
      endedBy: actorId,
      endedAt: sql`greatest(clock_timestamp(), ${assetTagAssignments.assignedAt})`,
    })
    .where(eq(assetTagAssignments.id, assignment.id));
  await recordBinding(tx, assignment, actorId, "unlink");
}

async function swap(
  tx: Db,
  site: AssetSite,
  actorId: string,
  tag: TagCode,
  command: Extract<TagCommand, { type: "swap" }>,
) {
  const prior = await tagById(tx, command.previousTagId);
  if (prior?.siteId !== site.id) fail("unavailable");
  if (prior.id === tag.id || (await currentAssignment(tx, tag.id)) !== undefined) fail("state");
  const assignment = await currentAssignment(tx, prior.id);
  if (assignment?.id !== command.assignmentId) fail("state");
  const target = await requireTarget(tx, site, targetRef(assignment));
  await end(tx, assignment, actorId);
  await bind(tx, tag, target, actorId, "swap");
}

async function changeTag(tx: Db, site: AssetSite, actorId: string, command: TagCommand) {
  const tag = await tagById(tx, command.tagId);
  if (tag?.siteId !== site.id) fail("unavailable");
  if (command.type === "swap") return swap(tx, site, actorId, tag, command);

  const assignment = await currentAssignment(tx, tag.id);
  if (command.type === "claim") {
    if (assignment !== undefined) fail("state");
    const target = await requireTarget(tx, site, command.target);
    return bind(tx, tag, target, actorId, "claim");
  }
  if (assignment?.id !== command.assignmentId) fail("state");
  if (command.type === "unlink") return end(tx, assignment, actorId);
  if (command.enabled) await requireTarget(tx, site, targetRef(assignment));
  if (assignment.ownerContact === command.enabled) return;
  await tx
    .update(assetTagAssignments)
    .set({ ownerContact: command.enabled })
    .where(eq(assetTagAssignments.id, assignment.id));
  await recordBinding(tx, assignment, actorId, "owner_contact", command.enabled);
}

type BatchEntry = { legacy: LegacyTagIdentifier | null; target: AssetTagTargetRef | null };

async function batchEntries(tx: Db, site: AssetSite, command: BatchCommand): Promise<BatchEntry[]> {
  if (command.type === "createBatch") {
    return Array.from({ length: command.count }, () => ({ legacy: null, target: null }));
  }
  if (command.approvedLegacyOrigin !== null && tagOrigin(command.approvedLegacyOrigin) === null) {
    fail("invalid");
  }
  const aliases = new Set<string>();
  const targets = new Set<string>();
  const entries: BatchEntry[] = [];
  for (const entry of command.entries) {
    const legacy = parseLegacyTagIdentifier(entry.identifier, command.approvedLegacyOrigin);
    if (legacy === null) fail("invalid");
    const target = await requireTarget(tx, site, entry.target);
    const key = `${target.kind}:${target.id}`;
    if (aliases.has(legacy.id) || targets.has(key)) fail("conflict");
    aliases.add(legacy.id);
    targets.add(key);
    entries.push({ legacy, target });
  }
  return entries;
}

async function requireFreePhysicalKeys(tx: Db, keys: string[]) {
  const [existing] = await tx
    .select({ id: physicalLabels.id })
    .from(physicalLabels)
    .where(inArray(sql`${physicalLabels.key} COLLATE "C"`, keys))
    .limit(1);
  if (existing !== undefined) fail("conflict");
}

async function createBatch(tx: Db, site: AssetSite, actorId: string, command: BatchCommand) {
  const entries = await batchEntries(tx, site, command);
  const batchId = crypto.randomUUID();
  const values = entries.map(({ legacy }, index) => ({
    id: crypto.randomUUID(),
    siteId: site.id,
    batchId,
    ordinal: index + 1,
    token: randomBytes(16).toString("base64url"),
    legacyId: legacy?.id ?? null,
    legacyOrigin: legacy?.origin ?? null,
  }));
  await requireFreePhysicalKeys(
    tx,
    values.flatMap(({ token, legacyId }) => [
      `text:${assetTagText(token)}`,
      ...(legacyId === null ? [] : [`text:${legacyId}`]),
    ]),
  );

  await tx.insert(assetTagBatches).values({
    id: batchId,
    siteId: site.id,
    title: command.title,
    createdBy: actorId,
    source: command.type === "createBatch" ? "printed" : "imported",
  });
  const created = await tx
    .insert(assetTagCodes)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: assetTagCodes.id });
  if (created.length !== values.length) fail("conflict");
  for (const [index, entry] of entries.entries()) {
    const tag = values[index];
    if (entry.target !== null && tag !== undefined)
      await bind(tx, tag, entry.target, actorId, "import");
  }
  return batchId;
}

type Focus = { batchId: string | null; tagId: string | null };

async function applyCommand(
  tx: Db,
  site: AssetSite,
  actorId: string,
  command: AssetTagCommand,
): Promise<Focus> {
  if (command.type === "createBatch" || command.type === "importLegacy") {
    return { batchId: await createBatch(tx, site, actorId, command), tagId: null };
  }
  if (command.type === "markMessageRead") {
    const row = await messageSite(tx, command.messageId);
    if (row?.siteId !== site.id) fail("unavailable");
    await tx
      .update(assetTagOwnerMessages)
      .set({
        readAt: sql`greatest(clock_timestamp(), ${assetTagOwnerMessages.at})`,
        readBy: actorId,
      })
      .where(
        and(eq(assetTagOwnerMessages.id, command.messageId), isNull(assetTagOwnerMessages.readAt)),
      );
    return { batchId: null, tagId: row.tagId };
  }
  await changeTag(tx, site, actorId, command);
  return { batchId: null, tagId: command.tagId };
}

async function applyOrReplay(
  tx: Db,
  sites: AssetSite[],
  actorId: string,
  command: AssetTagCommand,
) {
  const siteId = await commandSite(tx, command);
  const site = sites.find(({ id, canManage }) => id === siteId && canManage);
  if (site === undefined) fail("unavailable");
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const [receipt] = await tx
    .select()
    .from(assetTagReceipts)
    .where(
      and(eq(assetTagReceipts.actorId, actorId), eq(assetTagReceipts.requestId, command.requestId)),
    );
  if (receipt !== undefined) {
    if (receipt.siteId !== site.id || receipt.fingerprint !== fingerprint) fail("conflict");
    return { batchId: receipt.batchId, tagId: receipt.tagId };
  }

  const focus = await applyCommand(tx, site, actorId, command);
  await tx.insert(assetTagReceipts).values({
    ...focus,
    actorId,
    siteId: site.id,
    requestId: command.requestId,
    commandType: command.type,
    fingerprint,
  });
  return focus;
}

export async function runAssetTagCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<AssetTagResult> {
  const parsed = assetTagCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  try {
    return await withTagActor(db, who, "write", signal, async (tx, actor, sites) => {
      const focus = await applyOrReplay(tx, sites, actor.id, parsed.data);
      return { ok: true, value: await readTagWorkspace(tx, sites), ...focus } as const;
    });
  } catch (error) {
    if (error instanceof TagFailure) return { ok: false, error: error.code };
    throw error;
  }
}
