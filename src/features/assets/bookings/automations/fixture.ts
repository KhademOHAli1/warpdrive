import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Booking, BookingSite } from "../contracts";
import { createBookingFixture, type FixtureRole, fixtureBookingScope } from "../fixtures";
import { type BookingState, projectBookings } from "../transitions";
import {
  type BookingAutomationAccess,
  type BookingAutomationAttempt,
  type BookingAutomationProfile,
  type BookingAutomationReason,
  type BookingAutomationResult,
  type BookingAutomationRun,
  type BookingAutomationState,
  type BookingAutomationTrigger,
  bookingAutomationTriggers,
} from "./contracts";
import {
  bookingAutomationId as id,
  bookingAutomationProfileInput as profileInput,
  bookingAutomationRetryInput as retryInput,
  bookingAutomationRunInput as runsInput,
} from "./inputs";

export const bookingAutomationDemoIds = {
  sentBack: "361eba2b-7365-4e4c-a306-000000000001",
  overdue: "361eba2b-7365-4e4c-a306-000000000002",
  expired: "361eba2b-7365-4e4c-a306-000000000003",
} as const;

export type BookingAutomationDemoRole = FixtureRole | "viewer";
type Principal = BookingState["viewer"];
type FixtureRun = BookingAutomationRun & {
  siteId: string;
  recipientId: string | null;
  revision: number;
};
type AutomationDemo = { state: BookingState; runs: FixtureRun[]; clock: string };

const invalid = { ok: false, error: "invalid" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;

function clockOffset(now: string, minutes: number) {
  return new Date(Date.parse(now) + minutes * 60_000).toISOString();
}

function seedId(namespace: string, index: number) {
  return `${namespace}-7365-4e4c-a306-${String(index).padStart(12, "0")}`;
}

function runSeed(
  booking: Booking,
  trigger: BookingAutomationTrigger,
  state: BookingAutomationState,
  at: string,
  attemptId: string,
  runId: string,
): FixtureRun {
  const reason = state === "failed" ? "temporary" : state === "skipped" ? "rule_disabled" : null;
  return {
    id: runId,
    bookingId: booking.id,
    siteId: booking.siteId,
    title: booking.title,
    recipientId: booking.requesterId,
    recipientName: booking.requesterName || null,
    revision: booking.version,
    trigger,
    state,
    dueAt: trigger === "request_sent_back" ? null : booking.window.endAt,
    scheduledAt: at,
    attempts: state === "pending" ? [] : [{ id: attemptId, at, outcome: state, reason }],
    failureId: state === "failed" ? attemptId : null,
  };
}

export function createBookingAutomationDemo(
  actor: Principal,
  admin: boolean,
  now: string,
): AutomationDemo {
  const state = createBookingFixture(actor, admin, now);
  const sample = state.bookings[0];
  const site = state.sites.find(({ id }) => id === sample?.siteId);
  const self = site?.participants.find(({ role }) => role === "self_service");
  if (sample === undefined || self === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking automation demo equipment is unavailable");

  const seeds = [
    {
      id: bookingAutomationDemoIds.sentBack,
      title: "Bench calibration request",
      trigger: "request_sent_back",
      state: "delivered",
      recipient: "base",
    },
    {
      id: bookingAutomationDemoIds.overdue,
      title: "Overdue controller bench",
      trigger: "return_overdue",
      state: "failed",
      recipient: "base",
    },
    {
      id: bookingAutomationDemoIds.expired,
      title: "Missed meter pickup",
      trigger: "pickup_expired",
      state: "delivered",
      recipient: "self_service",
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: seedId("361eba2b", index + 4),
      title: `Equipment return notice ${index + 1}`,
      trigger: "return_overdue" as const,
      state: index === 0 ? ("pending" as const) : ("delivered" as const),
      recipient: "base" as const,
    })),
  ] satisfies {
    id: string;
    title: string;
    trigger: BookingAutomationTrigger;
    state: BookingAutomationState;
    recipient: "base" | "self_service";
  }[];
  const bookings = seeds.map(({ recipient, id, title, trigger }, index): Booking => {
    const sentBack = trigger === "request_sent_back";
    const endAt = sentBack ? sample.window.endAt : clockOffset(now, -30 - 60 * index);
    const at = clockOffset(now, -10 - 60 * index);
    const event = {
      version: sample.version + 1,
      at,
      actor: "Demo manager",
      kind: sentBack ? "sent_back" : "approved",
      reason: sentBack ? "Verify the pickup time" : null,
    } as const;
    return {
      ...sample,
      id,
      title,
      status: sentBack ? "draft" : "confirmed",
      version: event.version,
      requesterId: recipient === "base" ? sample.requesterId : self.id,
      requesterName: recipient === "base" ? sample.requesterName : self.name,
      requesterRole: recipient,
      window: sentBack ? sample.window : { startAt: clockOffset(endAt, -60), endAt },
      updatedAt: at,
      history: [event],
    };
  });
  const runs = bookings.map((booking, index) => {
    const seed = seeds[index];
    if (seed === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Booking automation demo run is unavailable");
    return runSeed(
      booking,
      seed.trigger,
      seed.state,
      booking.updatedAt,
      seedId("4c5050f1", index + 1),
      seedId("88c58595", index + 1),
    );
  });
  return { state: { ...state, bookings }, runs, clock: now };
}

export function automationBookingScope(
  state: BookingState,
  actor: Principal,
  role: BookingAutomationDemoRole,
): BookingState {
  return role === "viewer"
    ? {
        ...state,
        viewer: actor,
        sites: state.sites.map((site) => ({ ...site, role, canConfigure: false })),
      }
    : fixtureBookingScope(state, actor, role);
}

function managerSite(state: BookingState, siteId: string) {
  return state.sites.find(({ id, role }) => id === siteId && role === "manager");
}

function activeManagerSite(state: BookingState, siteId: string) {
  const site = managerSite(state, siteId);
  return site?.archived === true ? undefined : site;
}

function publicRun(run: FixtureRun): BookingAutomationRun {
  const {
    id,
    bookingId,
    title,
    recipientName,
    trigger,
    state,
    scheduledAt,
    dueAt,
    attempts,
    failureId,
  } = run;
  return {
    id,
    bookingId,
    title,
    recipientName,
    trigger,
    state,
    scheduledAt,
    dueAt,
    attempts: attempts.map((attempt) => ({ ...attempt })),
    failureId,
  };
}

function acceptsRecipient(site: BookingSite, requesterId: string | null, viewerId: string) {
  return (
    requesterId !== null &&
    (requesterId === viewerId || site.participants.some(({ id }) => id === requesterId))
  );
}

function retryReason(
  run: FixtureRun,
  booking: Booking | undefined,
  site: BookingSite,
  viewerId: string,
  profile: BookingAutomationProfile,
): BookingAutomationReason | null {
  if (!profile.triggers.includes(run.trigger)) return "rule_disabled";
  if (booking === undefined || booking.archived || booking.requesterId !== run.recipientId)
    return "superseded";
  if (
    run.trigger === "request_sent_back"
      ? booking.status !== "draft" ||
        booking.history[0]?.kind !== "sent_back" ||
        booking.history[0].version !== run.revision
      : booking.status !== "confirmed" || booking.window.endAt !== run.dueAt
  )
    return "superseded";
  return acceptsRecipient(site, run.recipientId, viewerId) ? null : "recipient_unavailable";
}

const pageSize = 5;

function runCursor(run: FixtureRun, status: BookingAutomationState | undefined) {
  return [run.siteId, status ?? "all", run.scheduledAt, run.id].join("|");
}

function cursorAnchor(
  cursor: string | undefined,
  siteId: string,
  status: BookingAutomationState | undefined,
) {
  if (cursor === undefined) return undefined;
  const [site, filter, scheduledAt, runId, ...extra] = cursor.split("|");
  if (
    site !== siteId ||
    filter !== (status ?? "all") ||
    extra.length > 0 ||
    !z.iso.datetime().safeParse(scheduledAt).success ||
    !id.safeParse(runId).success
  )
    return null;
  return { scheduledAt: scheduledAt ?? "", runId: runId ?? "" };
}

type Receipt =
  | { type: "profile"; signature: string; value: BookingAutomationProfile }
  | { type: "retry"; signature: string; value: BookingAutomationRun };

export function createBookingAutomationFixture(
  demo: AutomationDemo,
  now = () => new Date().toISOString(),
) {
  const runs = new Map(demo.runs.map((run) => [run.id, run]));
  const profiles = new Map<string, BookingAutomationProfile>();
  const receipts = new Map<string, Receipt>();
  const sentBack = new Set(
    demo.runs
      .filter(({ trigger }) => trigger === "request_sent_back")
      .map(({ bookingId, revision }) => `${bookingId}:${revision}`),
  );

  function profileAt(siteId: string): BookingAutomationProfile {
    const current = profiles.get(siteId);
    return current === undefined
      ? { version: 0, triggers: [...bookingAutomationTriggers] }
      : { ...current, triggers: [...current.triggers] };
  }

  function access(scoped: () => BookingState): BookingAutomationAccess {
    function readNotices(
      bookingId: string,
    ): Awaited<ReturnType<BookingAutomationAccess["readNotices"]>> {
      const parsed = id.safeParse(bookingId);
      if (!parsed.success) return invalid;
      const current = scoped();
      const booking = projectBookings(current).bookings.find(({ id }) => id === parsed.data);
      if (
        booking === undefined ||
        current.sites.find(({ id }) => id === booking.siteId)?.archived === true
      )
        return unavailable;
      if (booking.requesterId !== current.viewer.id) return { ok: true, value: [] };
      return {
        ok: true,
        value: [...runs.values()]
          .flatMap((run) => {
            const attempt = run.attempts.at(-1);
            return run.bookingId === booking.id &&
              run.siteId === booking.siteId &&
              run.recipientId === current.viewer.id &&
              attempt?.outcome === "delivered"
              ? [
                  {
                    id: run.id,
                    bookingId: booking.id,
                    trigger: run.trigger,
                    deliveredAt: attempt.at,
                    dueAt: run.dueAt,
                  },
                ]
              : [];
          })
          .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || b.id.localeCompare(a.id)),
      };
    }

    function readRuns(
      raw: Parameters<BookingAutomationAccess["readRuns"]>[0],
    ): Awaited<ReturnType<BookingAutomationAccess["readRuns"]>> {
      const parsed = runsInput.safeParse(raw);
      if (!parsed.success) return invalid;
      const { siteId, status, cursor } = parsed.data;
      if (managerSite(scoped(), siteId) === undefined) return unavailable;
      const anchor = cursorAnchor(cursor, siteId, status);
      if (anchor === null) return invalid;
      const available = [...runs.values()].filter(
        (run) =>
          run.siteId === siteId &&
          (status === undefined || run.state === status) &&
          (anchor === undefined ||
            run.scheduledAt < anchor.scheduledAt ||
            (run.scheduledAt === anchor.scheduledAt && run.id < anchor.runId)),
      );
      available.sort(
        (a, b) => b.scheduledAt.localeCompare(a.scheduledAt) || b.id.localeCompare(a.id),
      );
      const page = available.slice(0, pageSize);
      const last = page.at(-1);
      return {
        ok: true,
        value: {
          profile: profileAt(siteId),
          runs: page.map(publicRun),
          nextCursor:
            last !== undefined && available.length > pageSize ? runCursor(last, status) : null,
        },
      };
    }

    function saveProfile(
      raw: Parameters<BookingAutomationAccess["saveProfile"]>[0],
    ): BookingAutomationResult<BookingAutomationProfile> {
      const parsed = profileInput.safeParse(raw);
      if (!parsed.success) return invalid;
      const current = scoped();
      const { siteId, requestId, triggers, version } = parsed.data;
      if (activeManagerSite(current, siteId) === undefined) return unavailable;
      const key = `${current.viewer.id}:${requestId}`;
      const signature = JSON.stringify(parsed.data);
      const prior = receipts.get(key);
      if (prior !== undefined)
        return prior.type === "profile" && prior.signature === signature
          ? { ok: true, value: structuredClone(prior.value) }
          : conflict;
      if (profileAt(siteId).version !== version) return conflict;
      const value = {
        version: version + 1,
        triggers: bookingAutomationTriggers.filter((trigger) => triggers.includes(trigger)),
      };
      profiles.set(siteId, value);
      receipts.set(key, { type: "profile", signature, value });
      return { ok: true, value: structuredClone(value) };
    }

    function retry(
      raw: Parameters<BookingAutomationAccess["retry"]>[0],
    ): BookingAutomationResult<BookingAutomationRun> {
      const parsed = retryInput.safeParse(raw);
      if (!parsed.success) return invalid;
      const current = scoped();
      const { siteId, requestId, runId, failureId } = parsed.data;
      const site = activeManagerSite(current, siteId);
      const run = runs.get(runId);
      if (site === undefined || run?.siteId !== siteId) return unavailable;
      const key = `${current.viewer.id}:${requestId}`;
      const signature = JSON.stringify(parsed.data);
      const prior = receipts.get(key);
      if (prior !== undefined)
        return prior.type === "retry" && prior.signature === signature
          ? { ok: true, value: structuredClone(prior.value) }
          : conflict;
      if (run.state !== "failed" || run.failureId !== failureId) return conflict;
      const booking = current.bookings.find(
        ({ id, siteId }) => id === run.bookingId && siteId === run.siteId,
      );
      const reason = retryReason(run, booking, site, current.viewer.id, profileAt(siteId));
      const attempt: BookingAutomationAttempt = {
        id: crypto.randomUUID(),
        at: now(),
        outcome: reason === null ? "delivered" : "skipped",
        reason,
      };
      const next = {
        ...run,
        state: attempt.outcome,
        failureId: null,
        attempts: [...run.attempts, attempt],
      };
      runs.set(runId, next);
      const value = publicRun(next);
      receipts.set(key, { type: "retry", signature, value });
      return { ok: true, value: structuredClone(value) };
    }

    return {
      readNotices: (bookingId, signal) =>
        Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return readNotices(bookingId);
        }),
      readRuns: (input, signal) =>
        Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return readRuns(input);
        }),
      saveProfile: (input) => Promise.resolve(saveProfile(input)),
      retry: (input) => Promise.resolve(retry(input)),
    };
  }

  function recordBookingChange(booking: Booking | undefined) {
    const recent = booking?.history[0];
    if (booking?.status !== "draft" || recent?.kind !== "sent_back") return;
    const key = `${booking.id}:${recent.version}`;
    if (sentBack.has(key)) return;
    const enabled = profileAt(booking.siteId).triggers.includes("request_sent_back");
    const run = runSeed(
      booking,
      "request_sent_back",
      enabled ? "delivered" : "skipped",
      recent.at,
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
    runs.set(run.id, run);
    sentBack.add(key);
  }

  return { access, recordBookingChange };
}
