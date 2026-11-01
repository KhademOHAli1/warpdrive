import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import type { SmtpAttempt } from "./smtpOutboxTypes";
import { storeSmtpArtifacts } from "./smtpStoreArtifacts";
import { smtpThreadLinks } from "./smtpStoreLinks";
import { guardSmtpReceiptOwner } from "./smtpStoreOwner";

// A receipt is committed before this repairable transaction. A CRM failure cannot trigger SMTP again.
export async function storeSmtpOutboundCopy(
  db: Db,
  attempt: SmtpAttempt,
  signal: AbortSignal,
): Promise<Result<string, AppError>> {
  const links = await smtpThreadLinks(db, attempt, signal);
  return db.transaction(async (tx) => {
    if (!(await guardSmtpReceiptOwner(tx, attempt, signal)))
      return err(
        new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "SMTP receipt owner is unavailable"),
      );
    const locked = (
      await tx.execute(sql`SELECT id FROM email_send_attempts WHERE id=${attempt.id}
      AND account_id=${attempt.account_id} AND delivery_outcome->>'state' IN ('accepted','partial') FOR UPDATE`)
    ).rows[0];
    signal.throwIfAborted();
    if (locked === undefined)
      return err(
        new AppError(ERROR_IDS.MAIL_SEND_UNKNOWN, "SMTP acceptance receipt is unavailable"),
      );
    const providerId = `smtp:${attempt.id}`;
    const existing = (
      await tx.execute(sql`SELECT id FROM email_messages WHERE account_id=${attempt.account_id}
      AND provider_message_id=${providerId}`)
    ).rows[0] as { id: string } | undefined;
    let messageId = existing?.id;
    if (messageId === undefined) {
      let threadId = attempt.thread_id;
      if (threadId === null) {
        const [thread] = (
          await tx.execute(sql`INSERT INTO email_threads
          (account_id,provider_thread_id,subject,person_id,deal_id,visibility,last_message_at)
          VALUES (${attempt.account_id},${providerId},${attempt.payload.subject},${links.personId},${links.dealId},
            ${attempt.payload.visibility ?? "private"}::email_visibility,${attempt.sent_at ?? new Date()})
          ON CONFLICT (account_id,provider_thread_id) DO UPDATE SET updated_at=now() RETURNING id`)
        ).rows as { id: string }[];
        threadId = thread?.id ?? null;
      }
      if (threadId === null)
        return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "SMTP thread insert returned no row"));
      const snapshot = attempt.delivery_outcome;
      const inReplyTo =
        snapshot !== null && "inReplyTo" in snapshot
          ? (snapshot.inReplyTo ?? null)
          : attempt.in_reply_to;
      const references = snapshot?.references ?? [...(attempt.parent_references ?? [])];
      if (inReplyTo !== null && !references.includes(inReplyTo)) references.push(inReplyTo);
      const payload = attempt.payload;
      const tracking =
        payload.trackOpens === true ||
        payload.trackLinks === true ||
        payload.trackingEnabled === true;
      const [message] = (
        await tx.execute(sql`INSERT INTO email_messages
        (account_id,thread_id,provider_message_id,rfc_message_id,in_reply_to,"references",direction,
         from_email,from_name,to_emails,cc_emails,subject,snippet,body_html,body_text,sent_at,tracking_enabled)
        VALUES (${attempt.account_id},${threadId},${providerId},${attempt.message_id_header},${inReplyTo},
          ARRAY[${sql.join(
            references.map((reference) => sql`${reference}`),
            sql`, `,
          )}]::text[],'outbound',${attempt.from_email},${payload.fromName ?? null},${JSON.stringify(payload.to)}::jsonb,
          ${JSON.stringify(payload.cc ?? [])}::jsonb,${payload.subject},${Array.from(
            payload.text ?? payload.subject,
          )
            .slice(0, 200)
            .join("")},
          ${payload.html},${payload.text ?? null},${attempt.sent_at ?? new Date()},${tracking})
        ON CONFLICT (account_id,provider_message_id) DO UPDATE SET provider_message_id=EXCLUDED.provider_message_id RETURNING id`)
      ).rows as { id: string }[];
      messageId = message?.id;
      await tx.execute(sql`UPDATE email_threads SET last_message_at=GREATEST(last_message_at,${attempt.sent_at ?? new Date()}),updated_at=now()
        WHERE id=${threadId} AND account_id=${attempt.account_id}`);
    }
    signal.throwIfAborted();
    if (messageId === undefined)
      return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "SMTP message insert returned no row"));
    await storeSmtpArtifacts(tx, attempt, messageId, signal);
    await tx.execute(sql`UPDATE email_tracking_tokens SET message_id=${messageId}
      WHERE send_attempt_id=${attempt.id} AND message_id IS NULL`);
    signal.throwIfAborted();
    return ok(messageId);
  });
}
