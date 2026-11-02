import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSendAttempt } from "@/features/email/outbox";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import { prepareNotificationEmail } from "./notificationBinding";
import {
  gmailNotificationCollisionFixture,
  NOTIFICATION_PROVIDER_MESSAGE_ID,
} from "./notificationCrmPrivacy.test-helpers";

describe("Gmail notification CRM isolation", () => {
  it("isolates a notification from an existing shared Gmail conversation", async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await gmailNotificationCollisionFixture(db, signal);
      const before = await f.originalState();
      expect(f.ordinaryLink).toMatchObject({
        kind: "linked",
        personId: f.personId,
        dealId: f.dealId,
      });
      const sent = await runEmailNotificationJob(
        db,
        { notificationId: f.notificationId },
        signal,
        f.transport.deps,
      );
      expect.soft(sent).toEqual(ok({ sent: true }));
      expect(f.transport.gmail.raw).toHaveLength(1);
      const copies = await f.copy();
      expect(copies).toHaveLength(1);
      expect.soft(copies[0]).toMatchObject({
        direction: "outbound",
        visibility: "private",
        person_id: null,
        deal_id: null,
      });
      expect.soft(copies[0]?.thread_id).not.toBe(f.originalThreadId);
      expect(await f.originalState()).toEqual(before);
    });
  });

  it("keeps an already private notification UUID and ordinary conversation unchanged on later Gmail sync", async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await gmailNotificationCollisionFixture(db, signal);
      const original = await f.originalState();
      expect
        .soft(
          await runEmailNotificationJob(
            db,
            { notificationId: f.notificationId },
            signal,
            f.transport.deps,
          ),
        )
        .toEqual(ok({ sent: true }));
      const beforeSync = await f.copy();
      const synced = await f.sync();
      expect(synced.result).toMatchObject({ ok: true });
      expect.soft(synced.touchedThreadIds).not.toContain("t1");
      expect.soft(await f.copy()).toEqual(beforeSync);
      expect.soft(beforeSync[0]).toMatchObject({
        direction: "outbound",
        visibility: "private",
        person_id: null,
        deal_id: null,
      });
      expect.soft(beforeSync[0]?.thread_id).not.toBe(f.originalThreadId);
      expect.soft(await f.originalState()).toEqual(original);
      expect(f.transport.gmail.raw).toHaveLength(1);
    });
  });

  it("isolates canonical accepted notification intake when Gmail sync wins the CRM-copy race", async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await gmailNotificationCollisionFixture(db, signal);
      const original = await f.originalState();
      expect(
        await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
      ).toMatchObject({ ok: true, value: { status: "prepared" } });
      // Exercise the existing send engine without the worker's later CRM phase.
      expect(
        await processSendAttempt(db, {
          accountId: f.account.id,
          idempotencyKey: f.notificationId,
          gmail: f.transport.gmail,
          storage: f.transport.deps.storage,
          signal,
        }),
      ).toMatchObject({
        ok: true,
        value: { status: "sent", gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID },
      });
      const receipt = (
        await db.execute(sql`SELECT status,gmail_message_id FROM email_send_attempts
        WHERE account_id=${f.account.id} AND idempotency_key=${f.notificationId}`)
      ).rows;
      expect(receipt).toMatchObject([
        { status: "sent", gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID },
      ]);
      expect(await f.copy()).toEqual([]);
      const intake = await f.sync();
      expect(intake.result).toMatchObject({ ok: true });
      expect.soft(intake.touchedThreadIds).not.toContain("t1");
      const intakeCopy = await f.copy();
      // Intake may safely leave the private copy to receipt repair. It must never
      // expose it through the ordinary conversation while that repair is pending.
      for (const copy of intakeCopy) {
        expect.soft(copy).toMatchObject({
          direction: "outbound",
          visibility: "private",
          person_id: null,
          deal_id: null,
        });
        expect.soft(copy.thread_id).not.toBe(f.originalThreadId);
      }
      expect.soft(await f.originalState()).toEqual(original);
      const sent = await runEmailNotificationJob(
        db,
        { notificationId: f.notificationId },
        signal,
        f.transport.deps,
      );
      expect.soft(sent).toEqual(ok({ sent: true }));
      const repaired = await f.copy();
      expect(repaired).toHaveLength(1);
      expect.soft(repaired[0]).toMatchObject({
        direction: "outbound",
        visibility: "private",
        person_id: null,
        deal_id: null,
      });
      expect.soft(repaired[0]?.thread_id).not.toBe(f.originalThreadId);
      if (intakeCopy.length !== 0) expect.soft(repaired).toEqual(intakeCopy);
      expect.soft(await f.originalState()).toEqual(original);
      expect(f.transport.gmail.raw).toHaveLength(1);
    });
  });
});
