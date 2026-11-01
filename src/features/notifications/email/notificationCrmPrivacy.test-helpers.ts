import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import { applyMessageIds } from "@/features/email/applyMessages";
import { resolveOutboundLink } from "@/features/email/linking";
import { hydrateOwner } from "@/features/email/syncCursor";
import { setPreference } from "../preferences";
import {
  connectNotificationMailbox,
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "./notificationJob.test-helpers";

export const NOTIFICATION_PROVIDER_MESSAGE_ID = "sent-1";
const PROVIDER_THREAD_ID = "t1";
const SYNC_DATE_MS = String(Date.parse("2026-11-01T10:00:00.000Z"));

export async function gmailNotificationCollisionFixture(db: Db, signal: AbortSignal) {
  const recipient = await seedUser(db);
  const account = await connectNotificationMailbox(db, recipient.id, signal);
  const dealId = await seedNotificationDeal(db, recipient.id, "all", signal);
  const person = (
    await db.execute(sql`INSERT INTO persons (name,primary_email,owner_id,visibility_level)
      VALUES ('Existing customer',${account.emailAddress},${recipient.id},'all') RETURNING id`)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (person === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification privacy fixture contact missing");
  await db.execute(sql`UPDATE deals SET person_id=${person.id} WHERE id=${dealId}`);
  const thread = (
    await db.execute(sql`INSERT INTO email_threads
      (account_id,gmail_thread_id,provider_thread_id,subject,person_id,deal_id,visibility,last_message_at,updated_at)
      VALUES (${account.id},${PROVIDER_THREAD_ID},${PROVIDER_THREAD_ID},'Existing customer conversation',
        ${person.id},${dealId},'shared','2001-01-01T00:00:00Z','2001-01-01T00:00:00Z') RETURNING id`)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (thread === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification privacy fixture thread missing");
  const message = (
    await db.execute(sql`INSERT INTO email_messages
      (account_id,thread_id,gmail_message_id,provider_message_id,direction,from_email,subject,body_html,body_text)
      VALUES (${account.id},${thread.id},'ordinary-1','ordinary-1','inbound','customer@example.test',
        'Original customer mail','<p>Original customer body</p>','Original customer body') RETURNING id`)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (message === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification privacy fixture message missing");
  const owner = await hydrateOwner(db, recipient.id, signal);
  if (!owner.ok) throw owner.error;
  const ordinaryLink = await resolveOutboundLink(
    db,
    { owner: owner.value, fromEmail: account.emailAddress, recipients: [account.emailAddress] },
    signal,
  );
  await setPreference(db, recipient.id, "deal_won", { inApp: true, email: true }, signal);
  const notice = await insertJobNotification(
    db,
    { userId: recipient.id, type: "deal_won", entityType: "deal", entityId: dealId, payload: {} },
    signal,
  );
  const transport = notificationJobTransport();
  const originalGet = transport.gmail.getMessage.bind(transport.gmail);
  transport.gmail.getMessage = async (args) => {
    const result = await originalGet(args);
    return result.ok && args.id === NOTIFICATION_PROVIDER_MESSAGE_ID
      ? { ...result, value: { ...result.value, internalDate: SYNC_DATE_MS } }
      : result;
  };
  return {
    account,
    notificationId: notice.id,
    originalThreadId: thread.id,
    originalMessageId: message.id,
    personId: person.id,
    dealId,
    ordinaryLink,
    transport,
    async sync() {
      const touchedThreadIds = new Set<string>();
      const result = await applyMessageIds(
        {
          db,
          accountId: account.id,
          owner: owner.value,
          gmail: transport.gmail,
          signal,
          touchedThreadIds,
        },
        [NOTIFICATION_PROVIDER_MESSAGE_ID],
      );
      return { result, touchedThreadIds: [...touchedThreadIds] };
    },
    async originalState() {
      const result = await db.execute(sql`SELECT
        (SELECT to_jsonb(t) FROM email_threads t WHERE t.id=${thread.id}) AS thread,
        (SELECT to_jsonb(m) FROM email_messages m WHERE m.id=${message.id}) AS message`);
      signal.throwIfAborted();
      return result.rows;
    },
    async copy() {
      const result =
        await db.execute(sql`SELECT m.id,m.thread_id,m.direction,m.body_html,m.body_text,
        m.gmail_message_id,m.provider_message_id,t.visibility,t.person_id,t.deal_id
        FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
        WHERE m.account_id=${account.id} AND m.gmail_message_id=${NOTIFICATION_PROVIDER_MESSAGE_ID}`);
      signal.throwIfAborted();
      return result.rows;
    },
  };
}
