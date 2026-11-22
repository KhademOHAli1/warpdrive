import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { parseScannedLabel } from "@/features/physical-labels/formats";
import { findActiveCode, targetOf } from "@/features/physical-labels/repository";
import type { HydratedActor } from "@/server/hydrateActor";
import { assetActor, assetSites, lockAssetRegister } from "../../service";
import { lookupEquipmentTag } from "../../tags/nativeScans";
import { lockTagNamespace } from "../../tags/nativeScope";
import { nativeBookingAssets } from "../nativeResources";
import { bookingMaintenance, bookingRecords, persistBookingDeadline } from "../repository";
import { assetBookingSources } from "../resources";
import { assetBookings } from "../schema";
import { bookingSites } from "../scope";
import type { BookingState } from "../transitions";
import {
  type BookingHandoverCommand,
  type BookingHandoverLookup,
  type BookingHandoverRead,
  type BookingHandoverWrite,
  bookingHandoverCommand,
} from "./contracts";
import { activeEquipment, equipmentByPrintedCode } from "./equipmentIdentity";
import { persistPhysicalHandoverEffects } from "./nativeEffects";
import { readBookingHandoverNotices } from "./notices";
import { handoverBookingScope, projectHandover } from "./projection";
import { handoverReplay, loadHandoverState, persistHandover } from "./repository";
import { applyHandover } from "./transitions";

const id = z.uuid().toLowerCase();
const scanCode = z.string().trim().min(1).max(4096);
const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;
class HandoverSessionExpired extends Error {}

async function withHandoverActor<T>(
  db: Db,
  who: NativeSessionRef,
  mode: "read" | "write",
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor) => Promise<T>,
): Promise<T | typeof unavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, mode, signal);
      const result = await run(tx, actor);
      if ((await assetActor(tx, who, signal)) === null) throw new HandoverSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof HandoverSessionExpired) return unavailable;
    throw error;
  }
}

async function loadScope(tx: Db, actor: HydratedActor, bookingId: string) {
  const [row] = await tx
    .select({ siteId: assetBookings.siteId })
    .from(assetBookings)
    .where(eq(assetBookings.id, bookingId));
  if (row === undefined) return null;
  const site = (await bookingSites(tx, actor)).find(({ id }) => id === row.siteId);
  if (site === undefined) return null;

  const bookings = await bookingRecords(tx, [site.id], true);
  const scope = handoverBookingScope(
    { viewer: { id: actor.id, name: actor.name }, bookings, sites: [site] },
    bookingId,
  );
  if (scope === null) return null;
  const granted = (await assetSites(tx, actor)).find(({ id }) => id === site.id);
  const assetSite = {
    id: site.id,
    code: site.code,
    name: site.name,
    canManage: granted?.canManage === true,
  };
  const assets = await nativeBookingAssets(tx, [assetSite]);
  const availability = assetBookingSources(assets);
  const state: BookingState = {
    ...availability,
    sites: [site],
    bookings,
    maintenance: await bookingMaintenance(tx, [site.id]),
    viewer: { id: actor.id, name: actor.name },
  };
  return { ...scope, state, assets, canOperate: scope.canOperate && assetSite.canManage };
}

type Scope = NonNullable<Awaited<ReturnType<typeof loadScope>>>;

async function projectRead(
  tx: Db,
  scope: Scope,
  handovers: Awaited<ReturnType<typeof loadHandoverState>>,
  now: string,
): Promise<BookingHandoverRead> {
  const result = projectHandover(scope.state, handovers, scope.booking.id, now);
  if (!result.ok || result.value.notices.length === 0) return result;
  const notices = await readBookingHandoverNotices(
    tx,
    scope.booking.id,
    scope.site.id,
    result.value.dueAt,
  );
  const active = notices.filter(({ kind }) => kind === result.value.status);
  return { ok: true, value: { ...result.value, notices: active } };
}

export async function readBookingHandover(
  db: Db,
  who: NativeSessionRef,
  rawId: unknown,
  signal: AbortSignal,
): Promise<BookingHandoverRead> {
  const bookingId = id.safeParse(rawId);
  if (!bookingId.success) return invalid;
  return withHandoverActor(db, who, "read", signal, async (tx, actor) => {
    const scope = await loadScope(tx, actor, bookingId.data);
    if (scope === null) return unavailable;
    const handovers = await loadHandoverState(tx, scope.assets, [scope.site.id], scope.booking.id);
    return projectRead(tx, scope, handovers, new Date().toISOString());
  });
}

async function applyNativeHandover(
  tx: Db,
  actor: HydratedActor,
  command: BookingHandoverCommand,
): Promise<BookingHandoverWrite> {
  const scope = await loadScope(tx, actor, command.bookingId);
  if (scope === null || !scope.canOperate) return unavailable;
  const now = new Date().toISOString();
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const previous = await handoverReplay(tx, actor.id, command.requestId);
  if (
    previous !== undefined &&
    (previous.fingerprint !== fingerprint || previous.bookingId !== scope.booking.id)
  )
    return { ok: false, error: "conflict" };

  const { booking, site, state } = scope;
  const before = await loadHandoverState(tx, scope.assets, [site.id], booking.id);
  if (previous !== undefined) {
    const fresh = await projectRead(tx, scope, before, now);
    return fresh.ok ? { ...fresh, booking } : fresh;
  }

  const changed = applyHandover(state, before, command, { now, makeId: randomUUID });
  if (!changed.ok) return changed;
  if (changed.applied) {
    await persistPhysicalHandoverEffects(tx, changed.physicalEffects, actor.id);
    await persistHandover(
      tx,
      booking,
      before,
      changed.handovers,
      { id: command.requestId, actorId: actor.id, fingerprint },
      changed.physicalEffects,
    );
    if (booking.version !== changed.booking.version) {
      await persistBookingDeadline(tx, booking, changed.booking, actor.id);
    }
  }
  if (changed.value.notices.length === 0) {
    return { ok: true, value: changed.value, booking: changed.booking };
  }
  const current = await projectRead(
    tx,
    { ...scope, state: changed.state, booking: changed.booking },
    changed.handovers,
    now,
  );
  return current.ok ? { ...current, booking: changed.booking } : current;
}

export async function runBookingHandover(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingHandoverWrite> {
  const command = bookingHandoverCommand.safeParse(raw);
  if (!command.success) return invalid;
  return withHandoverActor(db, who, "write", signal, (tx, actor) =>
    applyNativeHandover(tx, actor, command.data),
  );
}

async function lookupInScope(
  tx: Db,
  scope: Scope,
  origin: string,
  code: string,
): Promise<BookingHandoverLookup> {
  const { assets, site } = scope;
  const direct = equipmentByPrintedCode(assets, site.id, code);
  if (direct !== undefined) return direct ?? unavailable;
  await lockTagNamespace(tx, "read");
  const tag = await lookupEquipmentTag(tx, code, origin, site.id);
  if (tag === null) return unavailable;

  const scanned = tag === undefined ? parseScannedLabel(code, origin) : null;
  const label = scanned === null ? undefined : await findActiveCode(tx, scanned.key);
  const target = tag ?? (label === undefined ? undefined : targetOf(label));
  if (target === undefined || (target.kind !== "asset" && target.kind !== "kit"))
    return unavailable;
  const identity = { ok: true, id: target.id, kind: target.kind } as const;
  return activeEquipment(assets, site.id, identity) ? identity : unavailable;
}

export async function lookupBookingHandoverEquipment(
  db: Db,
  who: NativeSessionRef,
  rawId: unknown,
  rawCode: unknown,
  origin: string,
  signal: AbortSignal,
): Promise<BookingHandoverLookup> {
  const bookingId = id.safeParse(rawId);
  const code = scanCode.safeParse(rawCode);
  if (!bookingId.success || !code.success) return invalid;
  return withHandoverActor(db, who, "read", signal, async (tx, actor) => {
    const scope = await loadScope(tx, actor, bookingId.data);
    return scope?.canOperate === true ? lookupInScope(tx, scope, origin, code.data) : unavailable;
  });
}
