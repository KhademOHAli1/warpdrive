import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSendAttempt } from "@/features/email/outbox";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import { prepareNotificationEmail } from "./notificationBinding";
import {
  gmailNotificationCollisionFixture,
  NOTIFICATION_PROVIDER_MESSAGE_ID,
} from "./notificationCrmPrivacy.test-helpers";

for (const [locale, direction] of [
  ["fa", "rtl"],
  ["de", "ltr"],
] as const)
  it(`keeps ${locale} notification intake private before the actual Gmail ACK resolves`, async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await gmailNotificationCollisionFixture(db, signal);
      await setPreferences(
        db,
        f.account.userId,
        {
          ui: { localePreferences: { locale, calendar: "persian", timeZone: "Asia/Tehran" } },
        },
        signal,
      );
      const original = await f.originalState();
      expect(f.ordinaryLink).toMatchObject({
        kind: "linked",
        personId: f.personId,
        dealId: f.dealId,
      });
      expect(
        await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
      ).toMatchObject({ ok: true, value: { status: "prepared" } });
      const attemptState = async () => {
        const result = await db.execute(sql`SELECT s.status,s.message_id_header,
          s.gmail_message_id,s.provider_message_id,s.delivery_outcome,s.send_started_at,s.sent_at,
          n.email_sent_at FROM email_send_attempts s
          JOIN notifications n ON n.id=s.idempotency_key
          WHERE s.account_id=${f.account.id} AND s.idempotency_key=${f.notificationId}`);
        signal.throwIfAborted();
        return result.rows;
      };
      let preAckIntakeCount = 0;
      let heldMessageId: string | undefined;
      let heldThreadId: string | undefined;
      const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
      f.transport.gmail.sendRaw = async (args) => {
        const accepted = await providerSend(args);
        if (!accepted.ok) return accepted;
        // The protocol adapter has exposed the remote message, but its ACK has
        // not yet returned to the actual send engine or reached the database.
        preAckIntakeCount += 1;
        expect(accepted.value).toEqual({ id: NOTIFICATION_PROVIDER_MESSAGE_ID, threadId: "t1" });
        const before = await attemptState();
        expect(before).toMatchObject([
          {
            status: "sending",
            gmail_message_id: null,
            provider_message_id: null,
            delivery_outcome: null,
            sent_at: null,
            email_sent_at: null,
          },
        ]);
        expect(before[0]?.send_started_at).not.toBeNull();
        const remote = f.transport.gmail.messages.get(NOTIFICATION_PROVIDER_MESSAGE_ID);
        expect(remote?.payload?.headers).toContainEqual({
          name: "Message-ID",
          value: before[0]?.message_id_header,
        });
        const intake = await f.sync();
        // Safe delayed intake and isolated unverified storage are both allowed.
        // Neither may mutate the customer's conversation or authorize delivery.
        expect.soft(intake.touchedThreadIds).not.toContain("t1");
        expect.soft(await f.originalState()).toEqual(original);
        for (const copy of await f.copy()) {
          expect.soft(copy).toMatchObject({
            visibility: "private",
            person_id: null,
            deal_id: null,
          });
          expect.soft(copy.thread_id).not.toBe(f.originalThreadId);
        }
        const held = (
          await db.execute(sql`SELECT i.intake_state,i.confirmation_attempt_id,
          i.confirmation_snapshot,m.id,m.thread_id,m.gmail_message_id,m.provider_message_id,
          m.message_fingerprint,t.visibility,t.person_id,t.deal_id,t.lead_id
          FROM email_private_intake i JOIN email_messages m
            ON m.id=i.owned_message_id AND m.account_id=i.account_id
          JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
          WHERE i.account_id=${f.account.id} AND i.provider='gmail'
            AND i.observed_provider_id=${NOTIFICATION_PROVIDER_MESSAGE_ID}`)
        ).rows;
        signal.throwIfAborted();
        expect(held).toHaveLength(1);
        expect(held[0]).toMatchObject({
          intake_state: "unverified",
          confirmation_attempt_id: null,
          confirmation_snapshot: null,
          gmail_message_id: null,
          message_fingerprint: null,
          visibility: "private",
          person_id: null,
          deal_id: null,
          lead_id: null,
        });
        expect(held[0]?.provider_message_id).toMatch(/^private-intake:/);
        heldMessageId = typeof held[0]?.id === "string" ? held[0].id : undefined;
        heldThreadId = typeof held[0]?.thread_id === "string" ? held[0].thread_id : undefined;
        expect(heldMessageId).toBeDefined();
        expect(heldThreadId).not.toBe(f.originalThreadId);
        const after = await attemptState();
        expect.soft(after).toHaveLength(1);
        expect.soft(after[0]).toMatchObject({
          gmail_message_id: null,
          provider_message_id: null,
          sent_at: null,
          email_sent_at: null,
        });
        expect.soft(after[0]?.status).not.toBe("sent");
        expect.soft(after[0]).not.toMatchObject({ delivery_outcome: { state: "accepted" } });
        expect.soft(after[0]).not.toMatchObject({ delivery_outcome: { evidence: "api_ack" } });
        expect(after[0]?.send_started_at).not.toBeNull();
        return accepted;
      };

      expect(
        await processSendAttempt(db, {
          accountId: f.account.id,
          idempotencyKey: f.notificationId,
          gmail: f.transport.gmail,
          storage: f.transport.deps.storage,
          signal,
        }),
      ).toEqual(ok({ status: "sent", gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID }));
      expect(preAckIntakeCount).toBe(1);
      expect(await attemptState()).toMatchObject([
        {
          status: "sent",
          gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
          provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
          email_sent_at: null,
          delivery_outcome: {
            version: 1,
            provider: "gmail",
            state: "accepted",
            evidence: "api_ack",
            providerMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
          },
        },
      ]);
      expect
        .soft(
          await runEmailNotificationJob(
            db,
            {
              notificationId: f.notificationId,
            },
            signal,
            f.transport.deps,
          ),
        )
        .toEqual(ok({ sent: true }));
      const canonical = await f.copy();
      expect.soft(canonical).toHaveLength(1);
      expect.soft(canonical[0]).toMatchObject({
        direction: "outbound",
        visibility: "private",
        person_id: null,
        deal_id: null,
        gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
      });
      expect.soft(canonical[0]?.thread_id).not.toBe(f.originalThreadId);
      expect.soft(canonical[0]?.id).toBe(heldMessageId);
      expect.soft(canonical[0]?.thread_id).toBe(heldThreadId);
      const completed = await attemptState();
      expect.soft(completed[0]?.email_sent_at).not.toBeNull();
      const laterIntake = await f.sync();
      expect(laterIntake.result).toMatchObject({ ok: true });
      expect.soft(laterIntake.touchedThreadIds).not.toContain("t1");
      expect
        .soft(
          await runEmailNotificationJob(
            db,
            {
              notificationId: f.notificationId,
            },
            signal,
            f.transport.deps,
          ),
        )
        .toEqual(ok({ sent: false }));
      expect.soft(await f.copy()).toEqual(canonical);
      expect.soft(await attemptState()).toEqual(completed);
      expect.soft(await f.originalState()).toEqual(original);
      const copies = await db.execute(sql`SELECT id FROM email_messages
        WHERE account_id=${f.account.id} AND id<>${f.originalMessageId}`);
      signal.throwIfAborted();
      expect.soft(copies.rows).toHaveLength(1);
      const wire = await f.transport.wireMessages(signal);
      expect(wire).toHaveLength(1);
      expect(wire[0]?.html).toContain(`lang="${locale}" dir="${direction}"`);
      expect.soft(canonical[0]?.body_html).toBe(wire[0]?.html);
      expect(f.transport.gmail.raw).toHaveLength(1);
      expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
    });
  });
