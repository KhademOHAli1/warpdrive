import { assert, expect, it } from "vitest";
import { bookingAutomationTriggers } from "./contracts";
import {
  automationBookingScope,
  type BookingAutomationDemoRole,
  bookingAutomationDemoIds,
  createBookingAutomationDemo,
  createBookingAutomationFixture,
} from "./fixture";

const operator = { id: "208b5f42-d05a-4bab-b745-795477796ef8", name: "Demo operator" };
const now = "2026-11-26T11:00:00.000Z";
const unavailable = { ok: false, error: "unavailable" };
const conflict = { ok: false, error: "conflict" };

function seed() {
  const demo = createBookingAutomationDemo(operator, true, now);
  const { state } = demo;
  const sent = state.bookings.find(({ id }) => id === bookingAutomationDemoIds.sentBack);
  const overdue = demo.runs.find(({ bookingId }) => bookingId === bookingAutomationDemoIds.overdue);
  assert(sent !== undefined && overdue !== undefined && overdue.failureId !== null);
  const { siteId } = sent;
  const fixture = createBookingAutomationFixture(demo, () => now);
  const access = (role: BookingAutomationDemoRole) =>
    fixture.access(() => automationBookingScope(state, operator, role));
  return { state, siteId, overdue, sent, fixture, access, manager: access("manager") };
}

it("only delivers a notice to its current requester and reserves run details for current-site managers", async () => {
  const { siteId, manager, access } = seed();
  const { sentBack, expired, overdue } = bookingAutomationDemoIds;
  const base = access("base");
  const self = access("self_service");
  const viewer = access("viewer");
  expect(await manager.readNotices(sentBack)).toEqual({ ok: true, value: [] });
  expect(await base.readNotices(sentBack)).toMatchObject({
    ok: true,
    value: [{ trigger: "request_sent_back", bookingId: sentBack }],
  });
  expect(await base.readNotices(overdue)).toEqual({ ok: true, value: [] });
  expect(await self.readNotices(expired)).toMatchObject({
    ok: true,
    value: [{ trigger: "pickup_expired", bookingId: expired }],
  });
  expect(await base.readNotices(expired)).toEqual(unavailable);
  expect(await self.readNotices(sentBack)).toEqual(unavailable);
  expect(await viewer.readNotices(sentBack)).toEqual(unavailable);
  for (const reader of [base, self, viewer])
    expect(await reader.readRuns({ siteId })).toEqual(unavailable);
  const notAdmin = createBookingAutomationDemo(operator, false, now);
  const personal = createBookingAutomationFixture(notAdmin).access(() => notAdmin.state);
  expect(await personal.readNotices(sentBack)).toMatchObject({
    ok: true,
    value: [{ bookingId: sentBack }],
  });
  expect(await personal.readNotices(expired)).toEqual(unavailable);
});

it("keeps an immutable failure and one delivery after concurrent retry or exact replay", async () => {
  const { manager, overdue, siteId, access } = seed();
  assert(overdue.failureId !== null);
  const retry = {
    requestId: crypto.randomUUID(),
    siteId,
    runId: overdue.id,
    failureId: overdue.failureId,
  };
  expect(await manager.retry({ ...retry, failureId: crypto.randomUUID() })).toEqual(conflict);
  expect(await access("base").retry(retry)).toEqual(unavailable);
  const [applied, raced] = await Promise.all([
    manager.retry(retry),
    manager.retry({ ...retry, requestId: crypto.randomUUID() }),
  ]);
  assert(applied.ok);
  expect(raced).toEqual(conflict);
  expect(applied.value).toMatchObject({
    state: "delivered",
    failureId: null,
    attempts: [overdue.attempts[0], { outcome: "delivered", reason: null, at: now }],
  });
  expect(await manager.retry(retry)).toEqual(applied);
  expect(await manager.retry({ ...retry, failureId: crypto.randomUUID() })).toEqual(conflict);
  expect(await access("base").readNotices(overdue.bookingId)).toMatchObject({
    ok: true,
    value: [
      {
        bookingId: overdue.bookingId,
        trigger: "return_overdue",
        deliveredAt: now,
        dueAt: overdue.dueAt,
      },
    ],
  });
  expect(await access("self_service").readNotices(overdue.bookingId)).toEqual(unavailable);
});

it("versions a profile, deduplicates its request and records a disabled retry as skipped", async () => {
  const { manager, overdue, siteId, access } = seed();
  assert(overdue.failureId !== null);
  const input = {
    siteId,
    version: 0,
    triggers: ["request_sent_back", "pickup_expired"] as const,
    requestId: crypto.randomUUID(),
  };
  const request = { ...input, triggers: [...input.triggers] };
  expect(await access("self_service").saveProfile(request)).toEqual(unavailable);
  const [saved, raced] = await Promise.all([
    manager.saveProfile(request),
    manager.saveProfile({ ...request, requestId: crypto.randomUUID() }),
  ]);
  expect(saved).toEqual({ ok: true, value: { version: 1, triggers: request.triggers } });
  expect(raced).toEqual(conflict);
  expect(await manager.saveProfile(request)).toEqual(saved);
  expect(
    await manager.saveProfile({ ...request, triggers: [...bookingAutomationTriggers] }),
  ).toEqual(conflict);
  const attempt = await manager.retry({
    siteId,
    runId: overdue.id,
    failureId: overdue.failureId,
    requestId: crypto.randomUUID(),
  });
  expect(attempt).toMatchObject({
    ok: true,
    value: {
      state: "skipped",
      attempts: [overdue.attempts[0], { outcome: "skipped", reason: "rule_disabled" }],
    },
  });
  expect(await access("base").readNotices(overdue.bookingId)).toEqual({ ok: true, value: [] });
});

it("pages by stable run keys and deduplicates a new sent-back occurrence", async () => {
  const { state, siteId, sent, fixture, manager } = seed();
  const first = await manager.readRuns({ siteId });
  assert(first.ok && first.value.nextCursor !== null);
  expect(first.value.runs).toHaveLength(5);
  const cursor = first.value.nextCursor;
  const next = await manager.readRuns({ siteId, cursor });
  assert(next.ok);
  expect(next.value.runs).toHaveLength(4);
  expect(next.value.nextCursor).toBeNull();
  expect(new Set([...first.value.runs, ...next.value.runs].map(({ id }) => id)).size).toBe(9);
  expect(await manager.readRuns({ siteId, status: "failed", cursor })).toEqual({
    ok: false,
    error: "invalid",
  });

  const later = {
    ...sent,
    version: sent.version + 1,
    history: [
      {
        version: sent.version + 1,
        kind: "sent_back" as const,
        at: now,
        actor: operator.name,
        reason: "Check the pickup time",
      },
      ...sent.history,
    ],
  };
  fixture.recordBookingChange(later);
  fixture.recordBookingChange(later);
  const update = fixture.access(() =>
    automationBookingScope({ ...state, bookings: [later] }, operator, "base"),
  );
  const delivered = await update.readNotices(later.id);
  assert(delivered.ok);
  expect(delivered.value).toHaveLength(2);
  expect(delivered.value[0]).toMatchObject({ deliveredAt: now, trigger: "request_sent_back" });
});
