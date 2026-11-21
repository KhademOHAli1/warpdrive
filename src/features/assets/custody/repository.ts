import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { AssetSite, AssetsWorkspace } from "../contracts";
import { persistAssetChanges } from "../repository";
import { assetEvents } from "../schema";
import { type CustodyWorkspace, emptyCustodyWorkspace } from "./contracts";
import {
  assetCustodianNotes,
  assetCustodians,
  assetCustodyHistory,
  assetCustodyHoldings,
} from "./schema";

export async function hasAssetCustody(tx: Db, assetId: string): Promise<boolean> {
  const [holding] = await tx
    .select({ id: assetCustodyHoldings.id })
    .from(assetCustodyHoldings)
    .where(eq(assetCustodyHoldings.assetId, assetId))
    .limit(1);
  return holding !== undefined;
}

export async function custodyWorkspace(
  tx: Db,
  sites: AssetSite[],
  history: boolean,
): Promise<CustodyWorkspace> {
  const siteIds = sites.map(({ id }) => id);
  if (siteIds.length === 0) return emptyCustodyWorkspace();
  const manageable = sites.filter(({ canManage }) => canManage).map(({ id }) => id);

  const hold = assetCustodyHoldings;
  const holdings = await tx
    .select({
      id: hold.id,
      siteId: hold.siteId,
      assetId: hold.assetId,
      custodianId: hold.custodianId,
      custodianName: hold.custodianName,
      quantity: hold.quantity,
      sourceLocationId: hold.sourceLocationId,
      locationId: hold.locationId,
      condition: hold.condition,
      assignedAt: hold.assignedAt,
    })
    .from(assetCustodyHoldings)
    .where(inArray(assetCustodyHoldings.siteId, siteIds))
    .orderBy(asc(assetCustodyHoldings.assignedAt), asc(assetCustodyHoldings.id));
  const events = history
    ? await tx
        .select({ ...getTableColumns(assetCustodyHistory), actor: users.name, at: assetEvents.at })
        .from(assetCustodyHistory)
        .innerJoin(assetEvents, eq(assetCustodyHistory.id, assetEvents.id))
        .leftJoin(users, eq(assetEvents.actorId, users.id))
        .where(inArray(assetCustodyHistory.siteId, siteIds))
        .orderBy(
          desc(assetEvents.at),
          desc(assetCustodyHistory.version),
          desc(assetCustodyHistory.id),
        )
    : [];
  const { custodians, staff, notes } = await managerRoster(tx, manageable, history);
  return {
    custodians,
    staff,
    holdings: holdings.map(({ assignedAt, ...entry }) => ({
      ...entry,
      assignedAt: assignedAt.toISOString(),
    })),
    events: events.map(({ at, actor, ...event }) => ({
      ...event,
      at: at.toISOString(),
      actor: actor ?? "",
    })),
    notes,
  };
}

async function managerRoster(tx: Db, siteIds: string[], history: boolean) {
  if (siteIds.length === 0) return { custodians: [], staff: [], notes: [] };
  const custodians = await tx
    .select()
    .from(assetCustodians)
    .where(inArray(assetCustodians.siteId, siteIds))
    .orderBy(asc(assetCustodians.name), asc(assetCustodians.id));
  const staff = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        eq(users.projectsGuestOnly, false),
        isNull(users.invitedAt),
        sql`length(btrim(${users.name})) > 0`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  const eligible = new Map(staff.map((person) => [person.id, person]));
  const note = assetCustodianNotes;
  const notes = history
    ? await tx
        .select({
          id: note.id,
          siteId: note.siteId,
          custodianId: note.custodianId,
          note: note.note,
          at: note.at,
          actor: users.name,
        })
        .from(assetCustodianNotes)
        .leftJoin(users, eq(assetCustodianNotes.actorId, users.id))
        .where(inArray(assetCustodianNotes.siteId, siteIds))
        .orderBy(desc(assetCustodianNotes.at), desc(assetCustodianNotes.id))
    : [];
  return {
    custodians: custodians.map((row) => {
      if (row.kind !== "staff") return row;
      const account = row.staffId === null ? undefined : eligible.get(row.staffId);
      return {
        ...row,
        name: account?.name ?? row.name,
        active: row.active && account !== undefined,
      };
    }),
    staff,
    notes: notes.map(({ at, actor, ...entry }) => ({
      ...entry,
      at: at.toISOString(),
      actor: actor ?? "",
    })),
  };
}

type Snapshot = AssetsWorkspace & { custody: CustodyWorkspace };

async function persistRoster(tx: Db, before: CustodyWorkspace, after: CustodyWorkspace) {
  const old = new Map(before.custodians.map((row) => [row.id, row]));
  for (const row of after.custodians) {
    const current = old.get(row.id);
    if (current === row) continue;
    if (current === undefined) {
      await tx.insert(assetCustodians).values(row);
    } else {
      const { name, active, version } = row;
      const updated = await tx
        .update(assetCustodians)
        .set({ name, active, version })
        .where(and(eq(assetCustodians.id, row.id), eq(assetCustodians.version, current.version)))
        .returning({ id: assetCustodians.id });
      if (updated.length !== 1)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Custodian changed while site was locked");
    }
  }
}

async function persistHoldings(tx: Db, before: Snapshot, after: Snapshot) {
  const old = new Map(before.custody.holdings.map((row) => [row.id, row]));
  const retained = new Set(after.custody.holdings.map(({ id }) => id));
  const deleted = [...old.keys()].filter((id) => !retained.has(id));
  if (deleted.length > 0) {
    await tx.delete(assetCustodyHoldings).where(inArray(assetCustodyHoldings.id, deleted));
  }
  for (const row of after.custody.holdings) {
    const existing = old.get(row.id);
    if (existing === row) continue;
    if (existing !== undefined) {
      await tx
        .update(assetCustodyHoldings)
        .set({ quantity: row.quantity })
        .where(eq(assetCustodyHoldings.id, row.id));
      continue;
    }
    const tracking = after.records.find(({ id }) => id === row.assetId)?.tracking;
    if (tracking === undefined || tracking === "consumable_pool") {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Custody omitted its eligible asset");
    }
    await tx.insert(assetCustodyHoldings).values({
      ...row,
      tracking,
      assignedAt: new Date(row.assignedAt),
    });
  }
}

export async function persistCustodyChanges(
  tx: Db,
  before: Snapshot,
  after: Snapshot,
  actorId: string,
) {
  await persistRoster(tx, before.custody, after.custody);
  await persistHoldings(tx, before, after);
  await persistAssetChanges(tx, before, after, actorId);
  const events = after.custody.events.map((event) => ({
    id: event.id,
    siteId: event.siteId,
    assetId: event.assetId,
    version: event.version,
    action: event.action,
    holdingId: event.holdingId,
    destinationHoldingId: event.destinationHoldingId,
    fromCustodianId: event.fromCustodianId,
    fromCustodianName: event.fromCustodianName,
    toCustodianId: event.toCustodianId,
    toCustodianName: event.toCustodianName,
    quantity: event.quantity,
    sourceLocationId: event.sourceLocationId,
    locationId: event.locationId,
    condition: event.condition,
    note: event.note,
  }));
  if (events.length > 0) await tx.insert(assetCustodyHistory).values(events);
  const notes = after.custody.notes.map(({ id, siteId, custodianId, note, at }) => ({
    id,
    siteId,
    custodianId,
    note,
    actorId,
    at: new Date(at),
  }));
  if (notes.length > 0) await tx.insert(assetCustodianNotes).values(notes);
}
