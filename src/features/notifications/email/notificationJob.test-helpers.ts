import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { expect } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { notifications } from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { FakeGmailClient } from "@/features/email/gmailFake";
import { FakeStorageClient } from "@/features/files/storageFake";
import type { EmailAccountRow } from "@/types/email";
import { ok } from "@/types/result";

class NotificationJobGmail extends FakeGmailClient {
  raw: Buffer[] = [];

  override async sendRaw(
    args: Parameters<FakeGmailClient["sendRaw"]>[0],
  ): ReturnType<FakeGmailClient["sendRaw"]> {
    const result = await super.sendRaw(args);
    if (!result.ok) return result;
    const raw = Buffer.from(args.rawBase64, "base64url");
    const message = await simpleParser(raw);
    args.signal.throwIfAborted();
    this.raw.push(raw);
    const groups =
      message.to === undefined ? [] : Array.isArray(message.to) ? message.to : [message.to];
    const addresses = groups.flatMap((group) =>
      group.value.flatMap((entry) => (entry.address === undefined ? [] : [entry.address])),
    );
    this.messages.set(result.value.id, {
      id: result.value.id,
      threadId: result.value.threadId,
      labelIds: ["SENT"],
      payload: {
        mimeType: typeof message.html === "string" ? "text/html" : "text/plain",
        body: {
          data: Buffer.from(
            typeof message.html === "string" ? message.html : (message.text ?? ""),
          ).toString("base64url"),
        },
        headers: [
          { name: "From", value: message.from?.text ?? "" },
          { name: "To", value: addresses.join(", ") },
          { name: "Subject", value: message.subject ?? "" },
          { name: "Message-ID", value: message.messageId ?? "" },
        ],
      },
    });
    return result;
  }
}

export function notificationJobTransport() {
  const gmail = new NotificationJobGmail();
  return {
    gmail,
    deps: { resolveClient: () => Promise.resolve(ok(gmail)), storage: new FakeStorageClient() },
    async wireMessages(signal: AbortSignal) {
      signal.throwIfAborted();
      const messages = await Promise.all(gmail.raw.map((raw) => simpleParser(raw)));
      signal.throwIfAborted();
      return messages;
    },
  };
}

function externalFixtureAddress(): string {
  const domain =
    env.GOOGLE_WORKSPACE_DOMAIN.toLowerCase() === "notification-recipient.invalid"
      ? "notification-other.invalid"
      : "notification-recipient.invalid";
  return `mailbox-${randomUUID()}@${domain}`;
}

export async function connectNotificationMailbox(
  db: Db,
  userId: string,
  signal: AbortSignal,
  address = externalFixtureAddress(),
): Promise<EmailAccountRow> {
  const row = (
    await db.execute(sql`INSERT INTO email_accounts (user_id,email_address,status)
    VALUES (${userId},${address},'connected') RETURNING id`)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification fixture mailbox missing");
  return { id: row.id, userId, emailAddress: address };
}

export async function seedNotificationDeal(
  db: Db,
  ownerId: string,
  visibility: "owner" | "all",
  signal: AbortSignal,
): Promise<string> {
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
  signal.throwIfAborted();
  const stage = stages[0];
  if (stage === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification fixture stage missing");
  const row = (
    await db.execute(sql`INSERT INTO deals (title,pipeline_id,stage_id,owner_id,visibility_level)
    VALUES ('Test Deal',${pipeline.id},${stage.id},${ownerId},${visibility}::visibility_level) RETURNING id`)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification fixture deal missing");
  return row.id;
}

export async function insertJobNotification(
  db: Db,
  values: typeof notifications.$inferInsert,
  signal: AbortSignal,
) {
  const [row] = await db.insert(notifications).values(values).returning();
  signal.throwIfAborted();
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Notification fixture row missing");
  return row;
}

export async function assertNotificationJobAccepted(
  db: Db,
  args: { notificationId: string; account: EmailAccountRow; signal: AbortSignal },
): Promise<void> {
  const attempts = (
    await db.execute(sql`SELECT account_id,idempotency_key,payload,status,gmail_message_id,send_started_at
    FROM email_send_attempts WHERE idempotency_key=${args.notificationId}`)
  ).rows;
  args.signal.throwIfAborted();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    account_id: args.account.id,
    idempotency_key: args.notificationId,
    status: "sent",
    gmail_message_id: "sent-1",
    payload: {
      to: [args.account.emailAddress],
      visibility: "private",
      trackOpens: false,
      trackLinks: false,
      systemPurpose: {
        version: 1,
        kind: "notification",
        notificationId: args.notificationId,
        recipientUserId: args.account.userId,
      },
    },
  });
  expect(attempts[0]?.send_started_at).not.toBeNull();
  const copies = (
    await db.execute(sql`SELECT t.visibility,t.deal_id,t.person_id FROM email_messages m
    JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
    WHERE m.account_id=${args.account.id}`)
  ).rows;
  args.signal.throwIfAborted();
  expect(copies).toEqual([{ visibility: "private", deal_id: null, person_id: null }]);
  expect((await db.execute(sql`SELECT id FROM email_tracking_tokens`)).rows).toHaveLength(0);
  args.signal.throwIfAborted();
  const marker = (
    await db.execute(sql`SELECT email_sent_at FROM notifications WHERE id=${args.notificationId}`)
  ).rows[0];
  args.signal.throwIfAborted();
  expect(marker?.email_sent_at).not.toBeNull();
}
