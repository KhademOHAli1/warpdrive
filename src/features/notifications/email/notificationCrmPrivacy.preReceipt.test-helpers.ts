import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { Db } from "@/db/client";
import { applyMessageIds } from "@/features/email/applyMessages";
import { processSendAttempt } from "@/features/email/outbox";
import { hydrateOwner } from "@/features/email/syncCursor";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { prepareNotificationEmail } from "./notificationBinding";
import { gmailNotificationCollisionFixture } from "./notificationCrmPrivacy.test-helpers";

export async function preparedGmailIntakeFixture(db: Db, signal: AbortSignal, locale: "fa" | "de") {
  const f = await gmailNotificationCollisionFixture(db, signal);
  await setPreferences(
    db,
    f.account.userId,
    {
      ui: { localePreferences: { locale, calendar: "persian", timeZone: "Asia/Tehran" } },
    },
    signal,
  );
  expect(
    await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
  ).toMatchObject({ ok: true, value: { status: "prepared" } });
  const owner = await hydrateOwner(db, f.account.userId, signal);
  if (!owner.ok) throw owner.error;
  return {
    ...f,
    send() {
      return processSendAttempt(db, {
        accountId: f.account.id,
        idempotencyKey: f.notificationId,
        gmail: f.transport.gmail,
        storage: f.transport.deps.storage,
        signal,
      });
    },
    async observe(ids: string[]) {
      const touchedThreadIds = new Set<string>();
      const result = await applyMessageIds(
        {
          db,
          accountId: f.account.id,
          owner: owner.value,
          gmail: f.transport.gmail,
          signal,
          touchedThreadIds,
        },
        ids,
      );
      return { result, touchedThreadIds: [...touchedThreadIds] };
    },
    async attempt() {
      const result = await db.execute(sql`SELECT s.status,s.message_id_header,s.gmail_message_id,
        s.provider_message_id,s.send_started_at,s.delivery_outcome,n.email_sent_at
        FROM email_send_attempts s JOIN notifications n ON n.id=s.idempotency_key
        WHERE s.account_id=${f.account.id} AND s.idempotency_key=${f.notificationId}`);
      signal.throwIfAborted();
      return result.rows;
    },
    async observed(providerId: string) {
      const result =
        await db.execute(sql`SELECT m.id,m.thread_id,m.direction,m.body_html,m.body_text,
        m.gmail_message_id,m.provider_message_id,t.visibility,t.person_id,t.deal_id,t.lead_id,
        to_jsonb(m) AS message,to_jsonb(t) AS thread
        FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
        WHERE m.account_id=${f.account.id} AND (m.gmail_message_id=${providerId}
          OR EXISTS(SELECT 1 FROM email_private_intake i WHERE i.account_id=m.account_id
            AND i.owned_message_id=m.id AND i.provider='gmail' AND i.observed_provider_id=${providerId}))`);
      signal.throwIfAborted();
      return result.rows;
    },
    async allRows() {
      const result = await db.execute(sql`SELECT to_jsonb(m) AS message,to_jsonb(t) AS thread
        FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
        WHERE m.account_id=${f.account.id} ORDER BY m.id`);
      signal.throwIfAborted();
      return result.rows;
    },
  };
}

export function expectPrivateObservation(
  rows: Awaited<ReturnType<Awaited<ReturnType<typeof preparedGmailIntakeFixture>>["observed"]>>,
  originalThreadId: string,
) {
  expect.soft(rows).toHaveLength(1);
  expect.soft(rows[0]).toMatchObject({
    visibility: "private",
    person_id: null,
    deal_id: null,
    lead_id: null,
  });
  expect.soft(rows[0]?.thread_id).not.toBe(originalThreadId);
}

export function expectNoGmailAcceptance(
  rows: Awaited<ReturnType<Awaited<ReturnType<typeof preparedGmailIntakeFixture>>["attempt"]>>,
) {
  expect(rows).toHaveLength(1);
  expect.soft(rows[0]).toMatchObject({
    gmail_message_id: null,
    provider_message_id: null,
    email_sent_at: null,
  });
  expect.soft(rows[0]).not.toMatchObject({ delivery_outcome: { state: "accepted" } });
  expect.soft(rows[0]?.status).not.toBe("sent");
  expect(rows[0]?.send_started_at).not.toBeNull();
}
