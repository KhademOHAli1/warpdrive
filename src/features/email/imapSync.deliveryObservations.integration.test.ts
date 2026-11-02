import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { submissionFacts } from "./deliveryObservation.test-helpers";
import {
  NATIVE_REPORT_BODY,
  NATIVE_REPORT_FILENAME,
  nativeDeliveryObservationFixture,
} from "./imapSync.deliveryObservations.test-helpers";

const signal = () => AbortSignal.timeout(30_000);

async function readableInbound(
  db: Db,
  f: Awaited<ReturnType<typeof nativeDeliveryObservationFixture>>,
  operationSignal: AbortSignal,
) {
  operationSignal.throwIfAborted();
  const messages = (
    await db.execute(sql`SELECT id,body_text,direction,gmail_message_id FROM email_messages
      WHERE account_id=${f.accountId} AND direction='inbound'`)
  ).rows as { id: string; body_text: string | null; direction: string; gmail_message_id: null }[];
  operationSignal.throwIfAborted();
  expect(messages).toHaveLength(1);
  const message = messages[0];
  if (message === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing native imported report message");
  expect(message.body_text).toContain(NATIVE_REPORT_BODY);
  expect(message.gmail_message_id).toBeNull();
  const attachments = await db.execute(sql`SELECT filename,gmail_attachment_id,provider_locator
    FROM email_message_attachments WHERE account_id=${f.accountId} AND message_id=${message.id}`);
  operationSignal.throwIfAborted();
  expect(attachments.rows).toEqual([
    {
      filename: NATIVE_REPORT_FILENAME,
      gmail_attachment_id: null,
      provider_locator: {
        kind: "imap",
        folderPath: "INBOX",
        uidValidity: f.inbox.validity,
        uid: 1,
        partKey: f.attachmentPartKey,
      },
    },
  ]);
  return message.id;
}

async function observationRows(db: Db, accountId: string, operationSignal: AbortSignal) {
  operationSignal.throwIfAborted();
  const result = await db.execute(sql`SELECT id,account_id,source_message_id,part_key,media_type,
      provenance,content_hash,content_bytes,parsed FROM email_delivery_reports
      WHERE account_id=${accountId} ORDER BY id`);
  operationSignal.throwIfAborted();
  return result.rows;
}

describe("delivery observations through native IMAP synchronization", () => {
  it("stores decoded report evidence against the imported inbound UUID without changing submission facts", async () => {
    await withTestDb(async (db) => {
      const f = await nativeDeliveryObservationFixture(db, "valid", signal());
      try {
        const before = await submissionFacts(db, f.attempt.attemptId);
        expect(await f.sync(signal())).toMatchObject({ ok: true, value: { applied: 1 } });
        const sourceMessageId = await readableInbound(db, f, signal());
        const reports = await observationRows(db, f.accountId, signal());
        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({
          account_id: f.accountId,
          source_message_id: sourceMessageId,
          part_key: "2",
          media_type: "message/global-delivery-status",
          provenance: "direct",
          content_hash: f.contentHash,
          content_bytes: f.contentBytes,
          parsed: {
            trust: "unverified",
            requiresReview: true,
            correlationAuthority: false,
            recipients: [
              {
                action: "failed",
                localizedDiagnostics: [
                  { languageTag: "fa", text: "نشانی گیرنده پیدا نشد", display: "plain_text" },
                  {
                    languageTag: "de",
                    text: "Die Empfängeradresse wurde nicht gefunden",
                    display: "plain_text",
                  },
                ],
              },
            ],
          },
        });
        expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toEqual([]);
        expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
        expect(
          (
            await db.execute(
              sql`SELECT id FROM email_send_attempts WHERE account_id=${f.accountId}`,
            )
          ).rows,
        ).toEqual([{ id: f.attempt.attemptId }]);

        // Rewind the owned fixture cursor so the same bytes/UID are actually fetched again.
        await db.execute(sql`UPDATE mail_folders SET last_uid=0 WHERE account_id=${f.accountId}`);
        const fetched = f.server.state.sourceFetches;
        expect(await f.sync(signal())).toMatchObject({ ok: true, value: { applied: 0 } });
        expect(f.server.state.sourceFetches).toBeGreaterThan(fetched);
        expect(await readableInbound(db, f, signal())).toBe(sourceMessageId);
        expect(await observationRows(db, f.accountId, signal())).toEqual(reports);

        // A new locator epoch must retain the same immutable evidence and source UUID too.
        f.inbox.validity = "789";
        expect(await f.sync(signal())).toMatchObject({ ok: true, value: { applied: 0 } });
        expect(await readableInbound(db, f, signal())).toBe(sourceMessageId);
        expect(await observationRows(db, f.accountId, signal())).toEqual(reports);
        expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toEqual([]);
        expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
      } finally {
        await f.server.close();
      }
    });
  });

  it.each([
    { mode: "malformed", description: "a malformed decoded machine part" },
    { mode: "ordinary", description: "ordinary mail with report-like public hints" },
  ] as const)(
    "keeps the readable message and PDF without inventing observations for $mode: $description",
    async ({ mode }) => {
      await withTestDb(async (db) => {
        const f = await nativeDeliveryObservationFixture(db, mode, signal());
        try {
          const before = await submissionFacts(db, f.attempt.attemptId);
          expect(await f.sync(signal())).toMatchObject({ ok: true, value: { applied: 1 } });
          await readableInbound(db, f, signal());
          expect(await observationRows(db, f.accountId, signal())).toEqual([]);
          expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toEqual([]);
          expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
        } finally {
          await f.server.close();
        }
      });
    },
  );
});
