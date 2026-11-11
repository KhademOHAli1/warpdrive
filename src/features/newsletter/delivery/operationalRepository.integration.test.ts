import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  auditEvents,
  channelVersions,
  emailSendAttempts,
  newsletterOperationalReceipts,
  newsletterOperationalState,
  notificationPreferences,
  notifications,
  users,
} from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { notificationSubmissionPolicy } from "@/features/notifications/email/notificationAdmissionPolicy";
import { getFeed, getUnreadCount, markAllRead, markRead } from "@/features/notifications/feed";
import {
  getPreferences,
  resolveDelivery,
  setPreference,
} from "@/features/notifications/preferences";
import { createNotification } from "@/features/notifications/produce";
import { hydrateActor } from "@/server/hydrateActor";
import { settingsReads } from "../admin/operations";
import type { NewsletterExecution } from "../operation";
import type { OperationalEvent } from "./operationalContracts";
import {
  OPERATIONAL_ENGINE_KEY,
  persistOperationalEvents,
  recordOperationalHealth,
  recordOperationalPoll,
} from "./operationalRepository";

const sig = () => new AbortController().signal;
const event = (over: Partial<OperationalEvent> = {}): OperationalEvent => ({
  id: randomUUID(),
  kind: "delivery.uncertain",
  reason: "submission_unknown",
  count: 1,
  occurred_at: "2026-11-11T12:00:00.123456Z",
  ...over,
});
const outage = {
  fingerprint: "ready/ready/unavailable/ready/disabled",
  reason: "relay_unavailable" as const,
};

it("atomically aggregates concurrent native replays and keeps lost ACKs idempotent", async () => {
  await withTestDb(async (db) => {
    const admin = await seedUser(db, { isAdmin: true });
    await seedUser(db);
    const batch = [
      event(),
      event(),
      event({ kind: "feedback.bounce", reason: "unmatched_bounce" }),
    ];
    expect(
      (
        await Promise.all([
          persistOperationalEvents(db, batch, sig()),
          persistOperationalEvents(db, batch, sig()),
        ])
      ).sort(),
    ).toEqual([0, 3]);
    expect(await persistOperationalEvents(db, batch, sig())).toBe(0);
    expect(await db.select().from(newsletterOperationalReceipts)).toHaveLength(3);
    const notices = await db.select().from(notifications);
    expect(notices).toHaveLength(2);
    expect(
      notices.every(
        (row) =>
          row.userId === admin.id &&
          row.type === "newsletter_operational" &&
          row.actorId === null &&
          row.entityId === null &&
          row.entityType === null,
      ),
    ).toBe(true);
    expect(notices.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        { category: "delivery.uncertain", reason: "submission_unknown", count: 2 },
        { category: "feedback.bounce", reason: "unmatched_bounce", count: 1 },
      ]),
    );
    expect(await db.select().from(auditEvents)).toHaveLength(2);
    expect(await db.select().from(emailSendAttempts)).toHaveLength(0);
    const versions = await db.select().from(channelVersions);
    expect(versions).toHaveLength(1);
    expect(Number(versions[0]?.version)).toBe(2);
    for (const mutation of [
      { reason: "delivery_rejected", kind: "delivery.failed" },
      { occurred_at: "2026-11-11T12:00:00.123457Z" },
    ] as Partial<OperationalEvent>[]) {
      await expect(
        persistOperationalEvents(db, [{ ...batch[0]!, ...mutation }], sig()),
      ).rejects.toThrow("identity changed");
    }
    expect(await db.select().from(notifications)).toHaveLength(2);
  });
});
it("rolls back receipts, audit and realtime state on a real database failure, then retries", async () => {
  await withTestDb(async (db) => {
    await seedUser(db, { isAdmin: true });
    const batch = [event()];
    await db.execute(
      sql`CREATE FUNCTION reject_operational_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test write rejected'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER reject_operational_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_operational_notice()`,
    );
    await expect(persistOperationalEvents(db, batch, sig())).rejects.toThrow();
    await expect(recordOperationalHealth(db, outage, sig())).rejects.toThrow();
    expect(await db.select().from(newsletterOperationalState)).toHaveLength(0);
    expect(await db.select().from(newsletterOperationalReceipts)).toHaveLength(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(channelVersions)).toHaveLength(0);
    await db.execute(sql`DROP TRIGGER reject_operational_notice ON notifications`);
    expect(await persistOperationalEvents(db, batch, sig())).toBe(1);
    await expect(recordOperationalHealth(db, outage, sig())).resolves.toMatchObject({
      changed: true,
    });
  });
});
it("keeps durable outage state over restarts and pauses, then emits recovery once", async () => {
  await withTestDb(async (db) => {
    await seedUser(db, { isAdmin: true });
    await expect(recordOperationalHealth(db, outage, sig())).resolves.toMatchObject({
      changed: true,
    });
    await expect(recordOperationalHealth(db, outage, sig())).resolves.toMatchObject({
      changed: false,
    });
    await recordOperationalHealth(db, { fingerprint: "paused", reason: null }, sig());
    expect((await db.select().from(newsletterOperationalState))[0]?.incidentOpen).toBe(true);
    // The first new process probe is already ready; durable state still produces recovery.
    await expect(
      recordOperationalHealth(db, { fingerprint: "ready", reason: null }, sig()),
    ).resolves.toMatchObject({ changed: true });
    await expect(
      recordOperationalHealth(db, { fingerprint: "ready", reason: null }, sig()),
    ).resolves.toMatchObject({ changed: false });
    await recordOperationalPoll(db, sig());
    const [state] = await db.select().from(newsletterOperationalState);
    expect(state).toMatchObject({
      engineKey: OPERATIONAL_ENGINE_KEY,
      incidentOpen: false,
      problem: null,
    });
    expect(state?.lastPolledAt).toBeInstanceOf(Date);
    const audits = await db.select().from(auditEvents);
    expect(audits.map((row) => row.action)).toEqual([
      "newsletter.delivery.unavailable",
      "newsletter.delivery.recovered",
    ]);
  });
});
it("enforces current authority and in-app preferences at production and every feed/read exposure", async () => {
  await withTestDb(async (db) => {
    const admin = await seedUser(db, { isAdmin: true });
    const regular = await seedUser(db);
    const optedOut = await seedUser(db, { isAdmin: true });
    const inactive = await seedUser(db, { isAdmin: true, isActive: false });
    await setPreference(
      db,
      optedOut.id,
      "newsletter_operational",
      { inApp: false, email: true },
      sig(),
    );
    const input = {
      type: "newsletter_operational" as const,
      actorId: null,
      entityId: null,
      entityType: null,
      payload: { category: "delivery.uncertain", reason: "submission_unknown", count: 1 },
    };
    for (const id of [regular.id, optedOut.id, inactive.id])
      expect(await createNotification(db, { ...input, recipientId: id }, sig())).toEqual({
        ok: true,
        value: { suppressed: true },
      });
    await recordOperationalHealth(db, outage, sig());
    const [notice] = await db.select().from(notifications);
    expect(notice?.userId).toBe(admin.id);
    let actor = await hydrateActor(db, admin.id, sig());
    if (!actor || !notice) throw new Error("missing fixture");
    expect(await getUnreadCount(db, actor, sig())).toBe(1);
    expect(await getFeed(db, actor, 30, sig())).toHaveLength(1);
    await setPreference(
      db,
      admin.id,
      "newsletter_operational",
      { inApp: false, email: false },
      sig(),
    );
    expect(await getUnreadCount(db, actor, sig())).toBe(0);
    expect(await getFeed(db, actor, 30, sig())).toHaveLength(0);
    await setPreference(
      db,
      admin.id,
      "newsletter_operational",
      { inApp: true, email: false },
      sig(),
    );
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, admin.id));
    // Intentionally keep the pre-revocation actor: exposure must rehydrate current authority.
    expect(await getUnreadCount(db, actor, sig())).toBe(0);
    expect(await getFeed(db, actor, 30, sig())).toHaveLength(0);
    await markRead(db, actor, notice.id, sig());
    await markAllRead(db, actor, sig());
    expect((await db.select().from(notifications))[0]?.readAt).toBeNull();
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
    actor = await hydrateActor(db, admin.id, sig());
    if (!actor) throw new Error("missing actor");
    await markRead(db, actor, notice.id, sig());
    expect((await db.select().from(notifications))[0]?.readAt).toBeInstanceOf(Date);
  });
});
it("overrides malicious stored email preference and rejects email admission without a sender", async () => {
  await withTestDb(async (db) => {
    const admin = await seedUser(db, { isAdmin: true });
    await db
      .insert(notificationPreferences)
      .values({ userId: admin.id, type: "newsletter_operational", inApp: true, email: true });
    expect((await getPreferences(db, admin.id, sig())).newsletter_operational.email).toBe(false);
    expect(await resolveDelivery(db, admin.id, "newsletter_operational", sig())).toEqual({
      inApp: true,
      email: false,
    });
    await recordOperationalHealth(db, outage, sig());
    const [notice] = await db.select().from(notifications);
    if (!notice) throw new Error("missing notice");
    const policy = await db.transaction((tx) =>
      notificationSubmissionPolicy(
        tx,
        { version: 1, kind: "notification", notificationId: notice.id, recipientUserId: admin.id },
        { ownerId: admin.id, active: true, invited: false, connected: true, sendCapable: true },
        sig(),
      ),
    );
    expect(policy).toEqual({ state: "suppressed", reason: "preference_disabled" });
    expect(await db.select().from(emailSendAttempts)).toHaveLength(0);
  });
});
it("projects strict safe operational details into CRM logs and drops malformed raw JSON", async () => {
  await withTestDb(async (db) => {
    const admin = await seedUser(db, { isAdmin: true });
    await recordOperationalHealth(db, outage, sig());
    await db.insert(auditEvents).values({
      actorId: null,
      targetType: "settings",
      action: "newsletter.delivery.rejected",
      after: {
        outcome: "failed",
        operational: {
          category: "delivery.failed",
          reason: "delivery_rejected",
          count: 1,
          email: "private@example.test",
        },
        provider: "private-provider-body",
      },
    });
    const actor = await hydrateActor(db, admin.id, sig());
    if (!actor) throw new Error("missing actor");
    const result = await settingsReads["admin.logs"].run({ source: "campaigns" }, {
      db,
      actor,
      signal: sig(),
      configured: true,
      deliveryEnabled: false,
      requireDelivery() {},
    } satisfies NewsletterExecution);
    expect(JSON.stringify(result)).not.toMatch(/private@example|private-provider|"operational"/);
    expect(result).toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({
          detail: { category: "readiness", reason: "relay_unavailable", count: 0 },
        }),
      ]),
    });
  });
});

it("bounds real PostgreSQL lock contention without advancing receipts or health, then retries", async () => {
  await withTestDb(async (db) => {
    let release!: () => void;
    let held!: () => void;
    const barrier = new Promise<void>((resolve) => {
      held = resolve;
    });
    const unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`newsletter-operations:${OPERATIONAL_ENGINE_KEY}`}, 0))`,
      );
      held();
      await unlock;
    });
    await barrier;
    const batch = [event()];
    try {
      const started = Date.now();
      await expect(persistOperationalEvents(db, batch, sig())).rejects.toMatchObject({
        cause: { code: "55P03" },
      });
      await expect(recordOperationalPoll(db, sig())).rejects.toMatchObject({
        cause: { code: "55P03" },
      });
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeLessThan(12_000);
      console.warn("Newsletter operational lock contention regression", {
        sqlState: "55P03",
        timeouts: 2,
        elapsedMs,
      });
      expect(await db.select().from(newsletterOperationalReceipts)).toHaveLength(0);
      expect(await db.select().from(newsletterOperationalState)).toHaveLength(0);
      expect(await db.select().from(auditEvents)).toHaveLength(0);
    } finally {
      release();
      await blocker;
    }
    expect(await persistOperationalEvents(db, batch, sig())).toBe(1);
    await recordOperationalPoll(db, sig());
  });
});
