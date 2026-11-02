import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";

export const deliverySignal = () => AbortSignal.timeout(15_000);
export const reportedRecipient = "Kunde@example.test";
export const hiddenRecipient = "private-bcc@example.test";

export function deliveryMachinePart(overrides: { action?: string; status?: string } = {}) {
  return {
    partKey: "2",
    mediaType: "message/global-delivery-status" as const,
    provenance: "direct" as const,
    content: Buffer.from(
      [
        "Reporting-MTA: dns; relay.example.test",
        "Original-Envelope-Id: forged-envelope-id",
        "",
        `Final-Recipient: rfc822; ${reportedRecipient}`,
        `Action: ${overrides.action ?? "failed"}`,
        `Status: ${overrides.status ?? "5.1.1"}`,
        "Diagnostic-Code: smtp; 550 نشانی گیرنده پیدا نشد / Empfänger nicht gefunden",
        "Localized-Diagnostic: fa; نشانی گیرنده پیدا نشد",
        "Localized-Diagnostic: de; Die Empfängeradresse wurde nicht gefunden",
        "",
      ].join("\r\n"),
    ),
  };
}

export function deliveryActor(id: string, isAdmin = false): AuthUser {
  return { id, type: isAdmin ? "admin" : "regular", isActive: true, groupIds: new Set() };
}

export async function seedDeliverySource(db: Db, accountId: string) {
  const threadId = randomUUID();
  const messageId = randomUUID();
  await db.execute(sql`INSERT INTO email_threads(id,account_id,provider_thread_id,subject)
    VALUES(${threadId},${accountId},${`dsn-thread:${threadId}`},'گزارش تحویل / Zustellbericht')`);
  await db.execute(sql`INSERT INTO email_messages
    (id,account_id,thread_id,provider_message_id,direction,from_email,body_text)
    VALUES(${messageId},${accountId},${threadId},${`dsn-source:${messageId}`},'inbound',
      'mailer-daemon@example.test','گزارش دریافت‌شده / Empfangener Bericht')`);
  return { messageId, threadId };
}

export async function seedDeliveryAttempt(db: Db, accountId: string) {
  const attemptId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();
  const messageIdHeader = `<${attemptId}@example.test>`;
  const payload = {
    to: [reportedRecipient],
    cc: ["Kollegin@example.test"],
    bcc: [hiddenRecipient],
    subject: "پیشنهاد همکاری / Angebot zur Zusammenarbeit",
    html: "<p>پیشنهاد / Angebot</p>",
    text: "پیشنهاد / Angebot",
  };
  await db.execute(sql`INSERT INTO email_threads(id,account_id,provider_thread_id,subject)
    VALUES(${threadId},${accountId},${`outbound:${threadId}`},${payload.subject})`);
  await db.execute(sql`INSERT INTO email_messages
    (id,account_id,thread_id,provider_message_id,rfc_message_id,direction,from_email,to_emails,subject)
    VALUES(${messageId},${accountId},${threadId},${`sent:${messageId}`},${messageIdHeader},
      'outbound','owner@example.test',${JSON.stringify(payload.to)}::jsonb,${payload.subject})`);
  await db.execute(sql`INSERT INTO email_send_attempts
    (id,account_id,thread_id,idempotency_key,message_id_header,payload,payload_prepared,status,
      send_started_at,sent_at,connection_generation,delivery_outcome,provider_message_id)
    VALUES(${attemptId},${accountId},${threadId},${randomUUID()},${messageIdHeader},
      ${JSON.stringify(payload)}::jsonb,true,'sent',now(),now(),1,
      ${JSON.stringify({ state: "accepted", accepted: payload.to })}::jsonb,${`sent:${messageId}`})`);
  return { attemptId, threadId, messageId, messageIdHeader, payload };
}

export async function seedDeliveryFixture(db: Db) {
  const owner = await seedMailHttpSession(db);
  const accountId = randomUUID();
  await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
    VALUES(${accountId},${owner.user.id},${`${accountId}@example.test`},'imap_smtp')`);
  const source = await seedDeliverySource(db, accountId);
  const attempt = await seedDeliveryAttempt(db, accountId);
  return { owner, accountId, source, attempt, actor: deliveryActor(owner.user.id) };
}

export async function submissionFacts(db: Db, attemptId: string) {
  return (
    await db.execute(sql`SELECT status,delivery_outcome,payload,payload_prepared,
    message_id_header,send_started_at,sent_at,provider_message_id,claim_token,scheduled_at
    FROM email_send_attempts WHERE id=${attemptId}`)
  ).rows[0];
}
