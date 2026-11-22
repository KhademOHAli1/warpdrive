import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { assetActor, lockAssetRegister } from "../../service";
import { assetBookings } from "../schema";
import { readBookingRoles } from "../scope";
import {
  type BookingAutomationNotice,
  type BookingAutomationProfile,
  type BookingAutomationProfileInput,
  type BookingAutomationResult,
  type BookingAutomationRetryInput,
  type BookingAutomationRun,
  type BookingAutomationRuns,
  bookingAutomationTriggers,
} from "./contracts";
import { appendBookingAutomationAttempt } from "./dispatch";
import {
  bookingAutomationId,
  bookingAutomationProfileInput,
  bookingAutomationRetryInput,
  bookingAutomationRunInput,
} from "./inputs";
import {
  bookingAutomationProfile,
  decodeRunCursor,
  pageBookingAutomationRuns,
  projectBookingAutomationRun,
  readDeliveredBookingNotices,
  readSiteAutomationProfile,
} from "./nativeProjection";
import {
  assetBookingAutomationAttempts as attempts,
  assetBookingAutomationProfiles as profiles,
  assetBookingAutomationReceipts as receipts,
  assetBookingAutomationRuns as runs,
} from "./schema";

const invalid = { ok: false, error: "invalid" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;
class BookingAutomationSessionExpired extends Error {}

async function withAutomationAuthority<T>(
  db: Db,
  who: NativeSessionRef,
  mode: "read" | "write",
  signal: AbortSignal,
  work: (tx: Db, actor: HydratedActor) => Promise<BookingAutomationResult<T>>,
): Promise<BookingAutomationResult<T>> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockDirectory(tx, "read", signal);
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockAssetRegister(tx, mode, signal);
      const result = await work(tx, actor);
      if ((await assetActor(tx, who, signal)) === null) throw new BookingAutomationSessionExpired();
      return result;
    });
  } catch (error) {
    if (error instanceof BookingAutomationSessionExpired) return unavailable;
    throw error;
  }
}

async function roleAt(tx: Db, actor: HydratedActor, siteId: string) {
  return actor.type === "admin" ? "manager" : (await readBookingRoles(tx, actor.id)).get(siteId);
}

async function permittedManagerSite(tx: Db, actor: HydratedActor, siteId: string, active: boolean) {
  if ((await roleAt(tx, actor, siteId)) !== "manager") return false;
  const [site] = await tx
    .select({ archived: directorySites.archived })
    .from(directorySites)
    .where(eq(directorySites.id, siteId));
  return site !== undefined && (!active || !site.archived);
}

export async function readBookingAutomationRuns(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingAutomationResult<BookingAutomationRuns>> {
  const input = bookingAutomationRunInput.safeParse(raw);
  if (!input.success) return invalid;
  return withAutomationAuthority(db, who, "read", signal, async (tx, actor) => {
    if (!(await permittedManagerSite(tx, actor, input.data.siteId, false))) return unavailable;
    const cursor = decodeRunCursor(input.data);
    if (cursor === null) return invalid;
    const profile = bookingAutomationProfile(
      await readSiteAutomationProfile(tx, input.data.siteId),
    );
    const page = await pageBookingAutomationRuns(tx, input.data, cursor);
    return { ok: true, value: { profile, ...page } };
  });
}

export async function readBookingAutomationNotices(
  db: Db,
  who: NativeSessionRef,
  rawBookingId: unknown,
  signal: AbortSignal,
): Promise<BookingAutomationResult<BookingAutomationNotice[]>> {
  const id = bookingAutomationId.safeParse(rawBookingId);
  if (!id.success) return invalid;
  return withAutomationAuthority(db, who, "read", signal, async (tx, actor) => {
    const [booking] = await tx
      .select({ siteId: assetBookings.siteId, requester: assetBookings.requesterId })
      .from(assetBookings)
      .innerJoin(directorySites, eq(directorySites.id, assetBookings.siteId))
      .where(and(eq(assetBookings.id, id.data), eq(directorySites.archived, false)));
    if (booking === undefined) return unavailable;
    const role = await roleAt(tx, actor, booking.siteId);
    const own = booking.requester === actor.id;
    if (role !== "manager" && (!own || (role !== "base" && role !== "self_service")))
      return unavailable;
    const value = own
      ? await readDeliveredBookingNotices(tx, booking.siteId, id.data, actor.id)
      : [];
    return { ok: true, value };
  });
}

type Mutation = BookingAutomationProfileInput | BookingAutomationRetryInput;
type ReceiptKind = (typeof receipts.$inferSelect)["kind"];

function mutationDigest(kind: ReceiptKind, input: Mutation) {
  return createHash("sha256")
    .update("booking-automation-v1\u0000")
    .update(kind)
    .update("\u0000")
    .update(JSON.stringify(input))
    .digest("hex");
}

async function priorReceipt(tx: Db, actorId: string, requestId: string) {
  const [row] = await tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.actorId, actorId), eq(receipts.requestId, requestId)));
  return row;
}

function profileEpoch(enabled: boolean, prior: typeof profiles.sentBackEnabledAt | undefined) {
  if (!enabled) return null;
  return prior === undefined
    ? sql`statement_timestamp()`
    : sql`coalesce(${prior}, statement_timestamp())`;
}

function profileChanges(input: BookingAutomationProfileInput, retainEpochs: boolean) {
  const { triggers, version } = input;
  return {
    version: version + 1,
    sentBackEnabledAt: profileEpoch(
      triggers.includes("request_sent_back"),
      retainEpochs ? profiles.sentBackEnabledAt : undefined,
    ),
    overdueEnabledAt: profileEpoch(
      triggers.includes("return_overdue"),
      retainEpochs ? profiles.overdueEnabledAt : undefined,
    ),
    pickupExpiredEnabledAt: profileEpoch(
      triggers.includes("pickup_expired"),
      retainEpochs ? profiles.pickupExpiredEnabledAt : undefined,
    ),
    updatedAt: sql`statement_timestamp()`,
  };
}

export async function saveBookingAutomationProfile(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingAutomationResult<BookingAutomationProfile>> {
  const parsed = bookingAutomationProfileInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const input = {
    ...parsed.data,
    triggers: bookingAutomationTriggers.filter((trigger) => parsed.data.triggers.includes(trigger)),
  };
  const { siteId, requestId, version } = input;
  return withAutomationAuthority(db, who, "write", signal, async (tx, actor) => {
    if (!(await permittedManagerSite(tx, actor, siteId, true))) return unavailable;
    const hash = mutationDigest("save_profile", input);
    const prior = await priorReceipt(tx, actor.id, requestId);
    const current = await readSiteAutomationProfile(tx, siteId);
    if (prior !== undefined) {
      return prior.siteId === siteId && prior.kind === "save_profile" && prior.fingerprint === hash
        ? { ok: true, value: bookingAutomationProfile(current) }
        : conflict;
    }
    if ((current?.version ?? 0) !== version) return conflict;
    const [saved] = await (current === undefined
      ? tx
          .insert(profiles)
          .values({
            siteId,
            principalId: crypto.randomUUID(),
            createdAt: sql`statement_timestamp()`,
            ...profileChanges(input, false),
          })
          .onConflictDoNothing()
          .returning()
      : tx
          .update(profiles)
          .set(profileChanges(input, true))
          .where(and(eq(profiles.siteId, siteId), eq(profiles.version, version)))
          .returning());
    if (saved === undefined) return conflict;
    await tx.insert(receipts).values({
      actorId: actor.id,
      siteId,
      requestId,
      kind: "save_profile",
      runId: null,
      fingerprint: hash,
    });
    return { ok: true, value: bookingAutomationProfile(saved) };
  });
}

export async function retryBookingAutomationRun(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<BookingAutomationResult<BookingAutomationRun>> {
  const parsed = bookingAutomationRetryInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const { siteId, requestId, runId, failureId } = parsed.data;
  return withAutomationAuthority(db, who, "write", signal, async (tx, actor) => {
    if (!(await permittedManagerSite(tx, actor, siteId, true))) return unavailable;
    const [run] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.siteId, siteId), eq(runs.id, runId)));
    if (run === undefined) return unavailable;
    const hash = mutationDigest("retry", parsed.data);
    const prior = await priorReceipt(tx, actor.id, requestId);
    if (prior === undefined) {
      if (run.state !== "failed") return conflict;
      const [latest] = await tx
        .select({ id: attempts.id, outcome: attempts.outcome, reason: attempts.reason })
        .from(attempts)
        .where(and(eq(attempts.siteId, siteId), eq(attempts.runId, runId)))
        .orderBy(desc(attempts.ordinal))
        .limit(1);
      if (latest?.id !== failureId || latest.outcome !== "failed" || latest.reason !== "temporary")
        return conflict;
      await appendBookingAutomationAttempt(tx, run, actor.id, signal);
      await tx
        .insert(receipts)
        .values({ actorId: actor.id, requestId, siteId, kind: "retry", runId, fingerprint: hash });
    } else if (
      prior.siteId !== siteId ||
      prior.kind !== "retry" ||
      prior.runId !== runId ||
      prior.fingerprint !== hash
    ) {
      return conflict;
    }
    const value = await projectBookingAutomationRun(tx, siteId, runId);
    if (value === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking automation lost its scoped run");
    return { ok: true, value };
  });
}
