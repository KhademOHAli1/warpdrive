import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals, notifications, persons, userPreferences } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { resolveOutboundLink } from "@/features/email/linking";
import { hydrateOwner } from "@/features/email/syncCursor";
import { setPreference } from "@/features/notifications/preferences";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import {
  assertNotificationJobAccepted,
  connectNotificationMailbox,
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "./notificationJob.test-helpers";

describe("runEmailNotificationJob", () => {
  it("renders in the recipient's saved language while retaining delivery keys", async () => {
    await withTestDb(async (db) => {
      const recipient = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      const account = await connectNotificationMailbox(db, recipient.id, signal);
      await db.insert(userPreferences).values({
        userId: recipient.id,
        ui: { localePreferences: { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" } },
      });
      await setPreference(db, recipient.id, "deal_won", { inApp: true, email: true }, signal);
      const row = await insertJobNotification(
        db,
        { userId: recipient.id, type: "deal_won", payload: {} },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: true }));
      const sent = await transport.wireMessages(signal);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toContain("فرصت فروش");
      expect(sent[0]?.html).toContain('lang="fa" dir="rtl"');
      await assertNotificationJobAccepted(db, { notificationId: row.id, account, signal });
    });
  });

  it("drops (no send) when the referenced deal is no longer visible to the recipient", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const other = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      await connectNotificationMailbox(db, alice.id, signal);
      await setPreference(
        db,
        alice.id,
        "deal_followed_update",
        { inApp: true, email: true },
        signal,
      );
      const dealId = await seedNotificationDeal(db, other.id, "owner", signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_followed_update",
          entityType: "deal",
          entityId: dealId,
          actorId: other.id,
          payload: {},
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: false }));
      expect(transport.gmail.calls).toHaveLength(0);
      expect((await db.execute(sql`SELECT id FROM email_send_attempts`)).rows).toHaveLength(0);
    });
  }, 60_000);

  it("suppresses (no send) when recipient has no connected mailbox", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      const dealId = await seedNotificationDeal(db, alice.id, "all", signal);
      await setPreference(db, alice.id, "deal_won", { inApp: true, email: true }, signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_won",
          entityType: "deal",
          entityId: dealId,
          payload: {},
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: false }));
      expect(transport.gmail.calls).toHaveLength(0);
    });
  }, 60_000);

  it("drops (no send) when the recipient has disabled email delivery for this type", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      await connectNotificationMailbox(db, alice.id, signal);
      const dealId = await seedNotificationDeal(db, alice.id, "all", signal);
      await setPreference(db, alice.id, "deal_won", { inApp: true, email: false }, signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_won",
          entityType: "deal",
          entityId: dealId,
          payload: {},
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: false }));
      expect(transport.gmail.calls).toHaveLength(0);
    });
  }, 60_000);

  it("sends when the recipient can see the entity and has a connected mailbox", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      const account = await connectNotificationMailbox(db, alice.id, signal);
      const dealId = await seedNotificationDeal(db, alice.id, "all", signal);
      const [person] = await db
        .insert(persons)
        .values({
          name: "Notification auto-link candidate",
          primaryEmail: account.emailAddress,
          ownerId: alice.id,
          visibilityLevel: "owner",
        })
        .returning();
      signal.throwIfAborted();
      if (person === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification fixture contact missing");
      await db.update(deals).set({ personId: person.id }).where(eq(deals.id, dealId));
      signal.throwIfAborted();
      const owner = await hydrateOwner(db, alice.id, signal);
      if (!owner.ok) throw owner.error;
      expect(
        await resolveOutboundLink(
          db,
          {
            owner: owner.value,
            fromEmail: account.emailAddress,
            recipients: [account.emailAddress],
          },
          signal,
        ),
      ).toEqual({ kind: "linked", personId: person.id, dealId, dealCandidates: [] });
      await setPreference(db, alice.id, "deal_won", { inApp: true, email: true }, signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_won",
          entityType: "deal",
          entityId: dealId,
          payload: {},
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: true }));
      const sent = await transport.wireMessages(signal);
      expect(sent).toHaveLength(1);
      const to = sent[0]?.to;
      const groups = to === undefined ? [] : Array.isArray(to) ? to : [to];
      expect(
        groups.flatMap((group) => group.value.map((recipient) => recipient.address)),
      ).toContain(account.emailAddress);
      expect(sent[0]?.subject?.length).toBeGreaterThan(0);
      await assertNotificationJobAccepted(db, { notificationId: row.id, account, signal });
    });
  }, 60_000);

  it("does not re-send when the notification was already emailed (idempotent retry)", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      await connectNotificationMailbox(db, alice.id, signal);
      const dealId = await seedNotificationDeal(db, alice.id, "all", signal);
      await setPreference(db, alice.id, "deal_won", { inApp: true, email: true }, signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_won",
          entityType: "deal",
          entityId: dealId,
          payload: {},
          emailSentAt: new Date(),
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: false }));
      expect(transport.gmail.calls).toHaveLength(0);
      expect((await db.execute(sql`SELECT id FROM email_send_attempts`)).rows).toHaveLength(0);
    });
  }, 60_000);

  it("records the delivery marker after a successful send", async () => {
    await withTestDb(async (db) => {
      const alice = await seedUser(db);
      const signal = AbortSignal.timeout(30_000);
      const account = await connectNotificationMailbox(db, alice.id, signal);
      const dealId = await seedNotificationDeal(db, alice.id, "all", signal);
      await setPreference(db, alice.id, "deal_won", { inApp: true, email: true }, signal);
      const row = await insertJobNotification(
        db,
        {
          userId: alice.id,
          type: "deal_won",
          entityType: "deal",
          entityId: dealId,
          payload: {},
        },
        signal,
      );
      const transport = notificationJobTransport();
      expect(
        await runEmailNotificationJob(db, { notificationId: row.id }, signal, transport.deps),
      ).toEqual(ok({ sent: true }));
      const [after] = await db
        .select({ emailSentAt: notifications.emailSentAt })
        .from(notifications)
        .where(eq(notifications.id, row.id));
      expect(after?.emailSentAt).not.toBeNull();
      await assertNotificationJobAccepted(db, { notificationId: row.id, account, signal });
    });
  }, 60_000);
});
