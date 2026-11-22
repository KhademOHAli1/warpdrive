import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { LabelRecord, LabelTarget, LabelTargetKind, LabelTargetRef } from "./contracts";
import { type NormalizedLabel, normalizeLabel } from "./formats";
import { type PhysicalLabelInsert, type PhysicalLabelRow, physicalLabels } from "./schema";

export function targetOf(row: PhysicalLabelRow): LabelTargetRef {
  return { kind: row.targetKind, id: row.targetId };
}

function targetKey({ kind, id }: LabelTargetRef) {
  return `${kind}:${id}`;
}

export function labelRecord(row: PhysicalLabelRow, target: LabelTarget): LabelRecord {
  return {
    id: row.id,
    format: row.format,
    value: row.value,
    source: row.source,
    target,
    createdAt: row.createdAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString() ?? null,
  };
}

export async function readScopedLabels(tx: Db, targets: LabelTarget[]) {
  if (targets.length === 0) return [];
  const visible = new Map(targets.map((target) => [targetKey(target), target]));
  // Bind the full set as one parameter for workspaces with many stock or asset IDs.
  const rows = await tx
    .select()
    .from(physicalLabels)
    .where(sql`(${physicalLabels.targetKind}, ${physicalLabels.targetId}) IN (
      SELECT ref.kind, ref.id FROM jsonb_to_recordset(
        ${JSON.stringify(targets.map(({ kind, id }) => ({ kind, id })))}::jsonb
      ) AS ref(kind text, id uuid)
    )`)
    .orderBy(desc(physicalLabels.createdAt), desc(physicalLabels.id));
  return rows.flatMap((row) => {
    const target = visible.get(targetKey(targetOf(row)));
    return target === undefined ? [] : [labelRecord(row, target)];
  });
}

export async function findLabel(tx: Db, id: string) {
  const [row] = await tx.select().from(physicalLabels).where(eq(physicalLabels.id, id));
  return row;
}

export async function findActiveCode(tx: Db, key: string) {
  const [row] = await tx
    .select()
    .from(physicalLabels)
    .where(and(isNull(physicalLabels.retiredAt), sql`${physicalLabels.key} COLLATE "C" = ${key}`));
  return row;
}

export async function lockActiveLabel(tx: Db, id: string) {
  const [row] = await tx
    .select()
    .from(physicalLabels)
    .where(and(eq(physicalLabels.id, id), isNull(physicalLabels.retiredAt)))
    .for("share");
  return row;
}

export async function lockLabelRequest(tx: Db, actorId: string, requestId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-physical-labels'), hashtext(${`${actorId}:${requestId}`}))`,
  );
}

export async function lockLabelTarget(tx: Db, target: LabelTargetRef) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-physical-label-subject'), hashtext(${targetKey(target)}))`,
  );
}

const subjectColumn = {
  asset: "assetId",
  kit: "kitId",
  stock_position: "positionId",
  location: "locationId",
  part: "itemId",
  release: "releaseId",
  supplier_offer: "supplierOfferId",
} satisfies Record<LabelTargetKind, keyof PhysicalLabelInsert>;

async function createLabel(
  tx: Db,
  actorId: string,
  target: LabelTargetRef,
  source: LabelRecord["source"],
  { format, value, key }: NormalizedLabel,
) {
  const [label] = await tx
    .insert(physicalLabels)
    .values({
      targetKind: target.kind,
      targetId: target.id,
      [subjectColumn[target.kind]]: target.id,
      source,
      format,
      value,
      key,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ id: physicalLabels.id });
  return label?.id;
}

export async function issueLabel(tx: Db, actorId: string, target: LabelTargetRef) {
  const [active] = await tx
    .select({ id: physicalLabels.id })
    .from(physicalLabels)
    .where(
      and(
        eq(physicalLabels.targetKind, target.kind),
        eq(physicalLabels.targetId, target.id),
        eq(physicalLabels.source, "internal"),
        isNull(physicalLabels.retiredAt),
      ),
    );
  if (active !== undefined) return active.id;
  const label = normalizeLabel("qr", `wd-label:v1:${randomBytes(16).toString("base64url")}`);
  return label === null ? undefined : createLabel(tx, actorId, target, "internal", label);
}

export function registerLabel(
  tx: Db,
  actorId: string,
  target: LabelTargetRef,
  label: NormalizedLabel,
) {
  return createLabel(tx, actorId, target, "external", label);
}

export async function retireLabel(tx: Db, actorId: string, labelId: string) {
  const [row] = await tx
    .update(physicalLabels)
    .set({
      retiredAt: sql`greatest(clock_timestamp(), ${physicalLabels.createdAt})`,
      retiredBy: actorId,
    })
    .where(and(eq(physicalLabels.id, labelId), isNull(physicalLabels.retiredAt)))
    .returning({ id: physicalLabels.id });
  return row?.id;
}
