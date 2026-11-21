import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { AssetsWorkspace } from "../contracts";
import { persistAssetChanges } from "../repository";
import { emptyKitWorkspace, type Kit, type KitCheckout, type KitWorkspace } from "./contracts";
import {
  assetKitActivity,
  assetKitCheckoutLines,
  assetKitCheckouts,
  assetKitDefinitions,
  assetKitMembers,
  assetKitReturns,
  assetKits,
} from "./schema";

type Snapshot = AssetsWorkspace & { kits: KitWorkspace };

function group<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const existing = groups.get(id);
    if (existing === undefined) groups.set(id, [row]);
    else existing.push(row);
  }
  return groups;
}

function publicKit(row: typeof assetKits.$inferSelect, lines: Kit["lines"]): Kit {
  const { id, siteId, code, name, locationId, version, definitionVersion } = row;
  return { id, siteId, code, name, locationId, version, definitionVersion, lines };
}

export async function kitWorkspace(
  tx: Db,
  siteIds: string[],
  history: boolean,
): Promise<KitWorkspace> {
  if (siteIds.length === 0) return emptyKitWorkspace();
  const kits = await tx
    .select()
    .from(assetKits)
    .where(inArray(assetKits.siteId, siteIds))
    .orderBy(asc(assetKits.code), asc(assetKits.id));
  const member = assetKitMembers;
  const members = await tx
    .select({
      id: member.id,
      kitId: member.kitId,
      mode: member.mode,
      assetId: member.assetId,
      modelId: member.modelId,
      quantity: member.quantity,
      packedQuantity: member.packedQuantity,
      sourceLocationId: member.sourceLocationId,
    })
    .from(member)
    .where(inArray(member.siteId, siteIds))
    .orderBy(asc(member.id));
  const memberMap = group(members, ({ kitId }) => kitId);
  const checkout = assetKitCheckouts;
  const checkouts = await tx
    .select({
      id: checkout.id,
      siteId: checkout.siteId,
      kitId: checkout.kitId,
      kitCode: checkout.kitCode,
      kitName: checkout.kitName,
      definitionVersion: checkout.definitionVersion,
      locationId: checkout.locationId,
      custodianId: checkout.custodianId,
      custodianName: checkout.custodianName,
      actor: users.name,
      at: checkout.at,
      closedAt: checkout.closedAt,
      note: checkout.note,
    })
    .from(checkout)
    .leftJoin(users, eq(users.id, checkout.actorId))
    .where(and(inArray(checkout.siteId, siteIds), history ? undefined : isNull(checkout.closedAt)))
    .orderBy(desc(checkout.at), desc(checkout.id));
  const line = assetKitCheckoutLines;
  const issued =
    checkouts.length === 0
      ? []
      : await tx
          .select({
            checkoutId: line.checkoutId,
            id: line.id,
            mode: line.mode,
            requestedAssetId: line.requestedAssetId,
            assetId: line.assetId,
            assetCode: line.assetCode,
            assetName: line.assetName,
            serial: line.serial,
            modelId: line.modelId,
            sourceLocationId: line.sourceLocationId,
            quantity: line.quantity,
            returned: line.returned,
            consumed: line.consumed,
          })
          .from(line)
          .where(
            inArray(
              line.checkoutId,
              checkouts.map(({ id }) => id),
            ),
          )
          .orderBy(asc(line.id));
  const issues = group(issued, ({ checkoutId }) => checkoutId);
  const audit = await kitAudit(tx, siteIds, history);
  return {
    records: kits.map((row) =>
      publicKit(
        row,
        (memberMap.get(row.id) ?? []).map((member) => ({
          id: member.id,
          mode: member.mode,
          assetId: member.assetId,
          modelId: member.modelId,
          quantity: member.quantity,
          packedQuantity: member.packedQuantity,
          sourceLocationId: member.sourceLocationId,
        })),
      ),
    ),
    checkouts: checkouts.map(({ actor, at, closedAt, ...row }) => ({
      ...row,
      actor: actor ?? "",
      at: at.toISOString(),
      closedAt: closedAt?.toISOString() ?? null,
      lines: (issues.get(row.id) ?? []).map((entry) => ({
        id: entry.id,
        mode: entry.mode,
        requestedAssetId: entry.requestedAssetId,
        assetId: entry.assetId,
        assetCode: entry.assetCode,
        assetName: entry.assetName,
        serial: entry.serial,
        modelId: entry.modelId,
        sourceLocationId: entry.sourceLocationId,
        quantity: entry.quantity,
        returned: entry.returned,
        consumed: entry.consumed,
      })),
    })),
    ...audit,
  };
}

async function kitAudit(tx: Db, siteIds: string[], include: boolean) {
  if (!include) return { returns: [], history: [] };
  const receipt = assetKitReturns;
  const returns = await tx
    .select({
      id: receipt.id,
      siteId: receipt.siteId,
      kitId: receipt.kitId,
      checkoutId: receipt.checkoutId,
      at: receipt.at,
      actor: users.name,
      condition: receipt.condition,
      note: receipt.note,
      lines: receipt.lines,
    })
    .from(receipt)
    .leftJoin(users, eq(users.id, receipt.actorId))
    .where(inArray(receipt.siteId, siteIds))
    .orderBy(desc(receipt.at), desc(receipt.id));
  const event = assetKitActivity;
  const history = await tx
    .select({
      id: event.id,
      siteId: event.siteId,
      kitId: event.kitId,
      kind: event.kind,
      version: event.version,
      at: event.at,
      actor: users.name,
      note: event.note,
      fromLocationId: event.fromLocationId,
      locationId: event.locationId,
    })
    .from(event)
    .leftJoin(users, eq(users.id, event.actorId))
    .where(inArray(event.siteId, siteIds))
    .orderBy(desc(event.version), desc(event.id));
  return {
    returns: returns.map(({ at, actor, ...row }) => ({
      ...row,
      at: at.toISOString(),
      actor: actor ?? "",
    })),
    history: history.map(({ at, actor, ...row }) => ({
      ...row,
      at: at.toISOString(),
      actor: actor ?? "",
    })),
  };
}

export async function isKitAsset(tx: Db, assetId: string): Promise<boolean> {
  const [packed] = await tx
    .select({ id: assetKitMembers.id })
    .from(assetKitMembers)
    .where(and(eq(assetKitMembers.assetId, assetId), gt(assetKitMembers.packedQuantity, 0)))
    .limit(1);
  if (packed !== undefined) return true;
  const line = assetKitCheckoutLines;
  const [held] = await tx
    .select({ id: line.id })
    .from(line)
    .innerJoin(assetKitCheckouts, eq(assetKitCheckouts.id, line.checkoutId))
    .where(
      and(
        eq(line.assetId, assetId),
        isNull(assetKitCheckouts.closedAt),
        sql`${line.returned} + ${line.consumed} < ${line.quantity}`,
      ),
    )
    .limit(1);
  return held !== undefined;
}

function kitColumns(kit: Kit) {
  const { code, name, locationId, version, definitionVersion } = kit;
  return { code, codeKey: code.trim().toLowerCase(), name, locationId, version, definitionVersion };
}

async function persistKit(tx: Db, current: Kit | undefined, kit: Kit) {
  if (current === undefined) {
    await tx.insert(assetKits).values({ id: kit.id, siteId: kit.siteId, ...kitColumns(kit) });
  } else {
    const updated = await tx
      .update(assetKits)
      .set(kitColumns(kit))
      .where(and(eq(assetKits.id, kit.id), eq(assetKits.version, current.version)))
      .returning({ id: assetKits.id });
    if (updated.length !== 1)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Kit changed while the register was locked");
  }
  if (current?.definitionVersion !== kit.definitionVersion) {
    const { code, name, locationId, lines } = kit;
    await tx.insert(assetKitDefinitions).values({
      kitId: kit.id,
      siteId: kit.siteId,
      definitionVersion: kit.definitionVersion,
      snapshot: { code, name, locationId, lines },
    });
  }
  if (kit.lines.length > 0) {
    await tx
      .insert(assetKitMembers)
      .values(kit.lines.map((line) => ({ ...line, siteId: kit.siteId, kitId: kit.id })));
  }
}

async function persistCheckout(
  tx: Db,
  existing: KitCheckout | undefined,
  checkout: KitCheckout,
  actorId: string,
) {
  const closedAt = checkout.closedAt === null ? null : new Date(checkout.closedAt);
  if (existing === undefined) {
    const {
      id,
      siteId,
      kitId,
      kitCode,
      kitName,
      definitionVersion,
      locationId,
      custodianId,
      custodianName,
      at,
      note,
      lines,
    } = checkout;
    await tx.insert(assetKitCheckouts).values({
      id,
      siteId,
      kitId,
      kitCode,
      kitName,
      definitionVersion,
      locationId,
      custodianId,
      custodianName,
      actorId,
      at: new Date(at),
      closedAt,
      note,
    });
    await tx.insert(assetKitCheckoutLines).values(
      lines.map((line) => ({
        ...line,
        siteId,
        checkoutId: id,
      })),
    );
    return;
  }
  const before = new Map(existing.lines.map((line) => [line.id, line]));
  for (const line of checkout.lines) {
    const old = before.get(line.id);
    if (old?.returned === line.returned && old.consumed === line.consumed) continue;
    await tx
      .update(assetKitCheckoutLines)
      .set({ returned: line.returned, consumed: line.consumed })
      .where(
        and(
          eq(assetKitCheckoutLines.checkoutId, checkout.id),
          eq(assetKitCheckoutLines.id, line.id),
        ),
      );
  }
  if (existing.closedAt !== checkout.closedAt) {
    await tx
      .update(assetKitCheckouts)
      .set({ closedAt })
      .where(eq(assetKitCheckouts.id, checkout.id));
  }
}

export async function persistKitChanges(
  tx: Db,
  before: Snapshot,
  after: Snapshot,
  kitId: string,
  actorId: string,
) {
  const kit = after.kits.records.find(({ id }) => id === kitId);
  const previous = before.kits.records.find(({ id }) => id === kitId);
  if (kit === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Kit command did not produce its kit");
  if (previous !== undefined)
    await tx.delete(assetKitMembers).where(eq(assetKitMembers.kitId, kitId));
  await persistAssetChanges(tx, before, after, actorId);
  await persistKit(tx, previous, kit);

  const priorCheckouts = new Map(before.kits.checkouts.map((entry) => [entry.id, entry]));
  for (const checkout of after.kits.checkouts) {
    const existing = priorCheckouts.get(checkout.id);
    if (existing !== checkout) await persistCheckout(tx, existing, checkout, actorId);
  }
  for (const { id, siteId, kitId, checkoutId, at, condition, note, lines } of after.kits.returns) {
    await tx
      .insert(assetKitReturns)
      .values({ id, siteId, kitId, checkoutId, at: new Date(at), actorId, condition, note, lines });
  }
  for (const { id, siteId, kitId, kind, version, at, note, fromLocationId, locationId } of after
    .kits.history) {
    await tx.insert(assetKitActivity).values({
      id,
      siteId,
      kitId,
      kind,
      version,
      at: new Date(at),
      actorId,
      note,
      fromLocationId,
      locationId,
    });
  }
}
