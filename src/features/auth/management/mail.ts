import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { authMailOutbox } from "@/db/schema/authManagement";
import { decryptToken, encryptToken } from "@/features/email/crypto";
import {
  INVITATION_TTL_MS,
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  RESET_MAIL_TTL_MS,
  VERIFICATION_MAIL_TTL_MS,
} from "./domain";
import { type AuthMailInput, renderAuthMail } from "./mailTemplates";

export async function enqueueAuthMail(
  db: Db,
  input: AuthMailInput,
  signal: AbortSignal,
): Promise<{ id: string }> {
  signal.throwIfAborted();
  if (input.url !== undefined && new URL(input.url).origin !== new URL(env.BASE_URL).origin)
    throw new AppError(
      ERROR_IDS.AUTH_MAIL_ORIGIN_INVALID,
      "Authentication message origin is not configured",
    );
  const id = randomUUID();
  const message = renderAuthMail(input);
  await db.insert(authMailOutbox).values({
    id,
    userId: input.userId,
    invitationId: input.invitationId,
    recipient: input.recipient,
    locale: input.locale,
    kind: input.kind,
    payloadEnc: encryptToken(JSON.stringify({ ...message, url: input.url })),
  });
  signal.throwIfAborted();
  return { id };
}

const mailPayload = z.object({ subject: z.string(), text: z.string(), html: z.string() });
type MailPayload = z.infer<typeof mailPayload>;
type MailRow = typeof authMailOutbox.$inferSelect;

async function claimMessages(db: Db, claimId: string): Promise<MailRow[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE auth_mail_outbox SET status='sending', claim_id=${claimId}, claimed_at=now(), attempts=attempts+1
      WHERE id IN (
        SELECT id FROM auth_mail_outbox
        WHERE ((status IN ('pending','failed') AND next_attempt_at <= now())
          OR (status='sending' AND claimed_at < ${new Date(Date.now() - MAIL_LEASE_MS)}))
          AND attempts < ${MAIL_MAX_ATTEMPTS}
        ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED
      )
    `);
    return tx.select().from(authMailOutbox).where(eq(authMailOutbox.claimId, claimId));
  });
}

async function sendSmtp(row: MailRow, payload: MailPayload, signal: AbortSignal): Promise<boolean> {
  const transport = nodemailer.createTransport({
    host: env.AUTH_SMTP_HOST,
    port: env.AUTH_SMTP_PORT,
    secure: env.AUTH_SMTP_SECURE,
    requireTLS: env.NODE_ENV === "production" && !env.AUTH_SMTP_SECURE,
    auth:
      env.AUTH_SMTP_USER === ""
        ? undefined
        : { user: env.AUTH_SMTP_USER, pass: env.AUTH_SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  const abort = () => transport.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await transport.sendMail({
      from: env.AUTH_MAIL_FROM,
      to: row.recipient,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      messageId: `<${row.id}@${new URL(env.BASE_URL).hostname}>`,
    });
    signal.throwIfAborted();
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  } finally {
    signal.removeEventListener("abort", abort);
    transport.close();
  }
}

async function deliverMessage(
  row: MailRow,
  signal: AbortSignal,
): Promise<{ success: boolean; errorCode: string | null }> {
  const decrypted = decryptToken(row.payloadEnc);
  if (!decrypted.ok) return { success: false, errorCode: "mail_decryption_failed" };
  let raw: unknown;
  try {
    raw = JSON.parse(decrypted.value);
  } catch {
    return { success: false, errorCode: "mail_payload_invalid" };
  }
  const payload = mailPayload.safeParse(raw);
  if (!payload.success) return { success: false, errorCode: "mail_payload_invalid" };
  if (env.AUTH_MAIL_TRANSPORT === "capture") return { success: true, errorCode: null };
  const success = await sendSmtp(row, payload.data, signal);
  return { success, errorCode: success ? null : "smtp_delivery_failed" };
}

// One delivery owns a DB lease. A failed attempt keeps the same expiring bearer link.
export async function dispatchAuthMail(
  db: Db,
  signal: AbortSignal,
): Promise<{ sent: number; failed: number }> {
  signal.throwIfAborted();
  await db.execute(sql`
    UPDATE auth_mail_outbox SET status='cancelled', payload_enc='\\x'::bytea, claim_id=NULL, claimed_at=NULL
    WHERE (status IN ('pending','failed') OR (status='sending' AND claimed_at < ${new Date(Date.now() - MAIL_LEASE_MS)})) AND (
      (kind='invitation' AND created_at <= ${new Date(Date.now() - INVITATION_TTL_MS)}) OR
      (kind='password_reset' AND created_at <= ${new Date(Date.now() - RESET_MAIL_TTL_MS)}) OR
      (kind='verification' AND created_at <= ${new Date(Date.now() - VERIFICATION_MAIL_TTL_MS)})
    )
  `);
  await db.execute(sql`
    UPDATE auth_mail_outbox SET status='failed', claim_id=NULL, claimed_at=NULL,
      last_error_code='delivery_interrupted'
    WHERE status='sending' AND claimed_at < ${new Date(Date.now() - MAIL_LEASE_MS)}
      AND attempts >= ${MAIL_MAX_ATTEMPTS}
  `);
  const claimId = randomUUID();
  const rows = await claimMessages(db, claimId);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    signal.throwIfAborted();
    const delivery = await deliverMessage(row, signal);
    const status = delivery.success
      ? env.AUTH_MAIL_TRANSPORT === "capture"
        ? "captured"
        : "sent"
      : "failed";
    await db
      .update(authMailOutbox)
      .set({
        status,
        sentAt: delivery.success ? new Date() : null,
        lastErrorCode: delivery.errorCode,
        claimId: null,
        claimedAt: null,
        nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
      })
      .where(
        and(
          eq(authMailOutbox.id, row.id),
          eq(authMailOutbox.claimId, claimId),
          eq(authMailOutbox.status, "sending"),
        ),
      );
    if (delivery.success) sent++;
    else failed++;
  }
  return { sent, failed };
}

export async function retryAuthMail(db: Db, id: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await db
    .update(authMailOutbox)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date() })
    .where(and(eq(authMailOutbox.id, id), inArray(authMailOutbox.status, ["failed", "pending"])));
}
