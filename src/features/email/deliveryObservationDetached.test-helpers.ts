import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { FakeStorageClient } from "@/features/files/storageFake";
import { ok } from "@/types/result";
import {
  deliveryActor,
  deliveryMachinePart,
  deliverySignal,
  reportedRecipient,
  seedDeliverySource,
} from "./deliveryObservation.test-helpers";
import { ingestDeliveryReports } from "./deliveryObservationIngest";
import { FakeGmailClient } from "./gmailFake";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { sendEmail } from "./send";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

interface DetachedSentFixture {
  owner: Awaited<ReturnType<typeof seedMailHttpSession>>;
  actor: ReturnType<typeof deliveryActor>;
  accountId: string;
  attemptId: string;
  reportId: string;
  sourceMessageId: string;
  copyMessageId: string;
  copyThreadId: string;
  sendCount: () => number;
}

export function expectedDetachedReport(
  reportId: string | null,
  attemptId: string,
  revision: number,
) {
  return {
    ok: true,
    value: [
      {
        id: reportId,
        recipients: [
          {
            review: {
              revision,
              decision: "associated",
              target: { attemptId, recipient: reportedRecipient, kind: "to" },
            },
          },
        ],
      },
    ],
  };
}

export async function withActualDetachedSend(
  db: Db,
  provider: "imap_smtp" | "gmail",
  run: (fixture: DetachedSentFixture) => Promise<void>,
): Promise<void> {
  const owner = await seedMailHttpSession(db);
  const smtp = provider === "imap_smtp" ? await smtpOutboxFixture(db) : null;
  try {
    const stringValue: unknown = expect.any(String);
    const presentValue: unknown = expect.anything();
    const accountId = smtp?.accountId ?? randomUUID();
    if (smtp === null)
      await db.execute(sql`INSERT INTO email_accounts
      (id,user_id,email_address,provider) VALUES(${accountId},${owner.user.id},
      ${`${accountId}@example.test`},'gmail')`);
    else
      await db.execute(
        sql`UPDATE email_accounts SET user_id=${owner.user.id} WHERE id=${accountId}`,
      );
    const gmail = new FakeGmailClient();
    const providerId = "detached-gmail-accepted";
    gmail.sendImpl = () => ok({ id: providerId, threadId: "detached-gmail-thread" });
    gmail.messages.set(providerId, {
      id: providerId,
      threadId: "detached-gmail-thread",
      labelIds: ["SENT"],
    });
    const sent = await sendEmail(db, {
      actorId: owner.user.id,
      actorType: "regular",
      actorGroupIds: new Set(),
      ...(smtp === null ? { gmail } : { mail: { ...smtp.runtime, ownerId: owner.user.id } }),
      storage: smtp?.storage ?? new FakeStorageClient(),
      signal: deliverySignal(),
      input: {
        accountId,
        idempotencyKey: randomUUID(),
        to: [reportedRecipient],
        subject: "پیشنهاد همکاری / Angebot zur Zusammenarbeit",
        bodyHtml: "<p>سلام / Guten Tag</p>",
        visibility: "private",
        trackOpens: false,
        trackLinks: false,
      },
    });
    expect(sent).toMatchObject({
      ok: true,
      value: { status: "sent", attemptId: stringValue },
    });
    if (!sent.ok || sent.value.attemptId === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Actual detached send fixture failed");
    const attemptId = sent.value.attemptId;
    const identity = provider === "imap_smtp" ? `smtp:${attemptId}` : providerId;
    const copy = (
      await db.execute(sql`SELECT m.id,m.thread_id,t.visibility,t.trashed_at
      FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
      WHERE m.account_id=${accountId} AND m.provider_message_id=${identity} AND m.direction='outbound'`)
    ).rows[0];
    expect(copy).toMatchObject({
      id: stringValue,
      thread_id: stringValue,
      visibility: "private",
      trashed_at: null,
    });
    if (copy === undefined || typeof copy.id !== "string" || typeof copy.thread_id !== "string")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Actual detached send copy missing");
    const attempt = (
      await db.execute(sql`SELECT thread_id,payload_prepared,send_started_at
      FROM email_send_attempts WHERE id=${attemptId}`)
    ).rows[0];
    expect(attempt).toMatchObject({
      thread_id: null,
      payload_prepared: true,
      send_started_at: presentValue,
    });
    expect(
      (
        await db.execute(
          sql`SELECT id FROM email_tracking_tokens WHERE send_attempt_id=${attemptId}`,
        )
      ).rows,
    ).toEqual([]);
    const source = await seedDeliverySource(db, accountId);
    const ingested = await ingestDeliveryReports(
      db,
      { accountId, sourceMessageId: source.messageId, parts: [deliveryMachinePart()] },
      deliverySignal(),
    );
    if (!ingested.ok || ingested.value.reportIds[0] === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Detached send source report missing");
    const sendCount = () =>
      smtp === null
        ? gmail.calls.filter((call) => call.method === "sendRaw").length
        : smtp.smtp.received.length;
    expect(sendCount()).toBe(1);
    await run({
      owner,
      actor: deliveryActor(owner.user.id),
      accountId,
      attemptId,
      reportId: ingested.value.reportIds[0],
      sourceMessageId: source.messageId,
      copyMessageId: copy.id,
      copyThreadId: copy.thread_id,
      sendCount,
    });
  } finally {
    await smtp?.close();
  }
}
