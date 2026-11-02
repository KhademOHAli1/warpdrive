import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { FakeStorageClient } from "@/features/files/storageFake";
import { seedAccount, seedReadyFile } from "./attachmentSend.helpers";
import { FakeGmailClient } from "./gmailFake";
import { enqueueSend, processSendAttempt } from "./outbox";
import { sendEmail } from "./send";

describe("email attachment resource bounds", () => {
  it("rejects repeated authorized file IDs before enqueueing", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const accountId = await seedAccount(db, owner.id);
      const personId = randomUUID();
      await db.execute(sql`INSERT INTO persons (id,name,owner_id,visibility_level)
        VALUES (${personId},'Attachment owner',${owner.id},'all')`);
      const storage = new FakeStorageClient();
      const { fileId } = await seedReadyFile(db, {
        uploadedBy: owner.id,
        entityType: "person",
        entityId: personId,
        filename: "note.txt",
        contentType: "text/plain",
        content: Buffer.from("one"),
        storage,
      });
      const idempotencyKey = randomUUID();
      const gmail = new FakeGmailClient();
      const result = await sendEmail(db, {
        actorId: owner.id,
        actorType: "regular",
        actorGroupIds: new Set(),
        gmail,
        storage,
        input: {
          accountId,
          idempotencyKey,
          to: ["recipient@example.com"],
          subject: "Hello",
          bodyHtml: "<p>Hello</p>",
          attachments: [{ fileId }, { fileId }],
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe(ERROR_IDS.MAIL_SEND_REJECTED);
      expect(
        (
          await db.execute(
            sql`SELECT id FROM email_send_attempts WHERE idempotency_key=${idempotencyKey}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(gmail.calls).toHaveLength(0);
    });
  });

  it("rejects aggregate attachment bytes before queueing or reading storage", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const accountId = await seedAccount(db, owner.id);
      const personId = randomUUID();
      await db.execute(sql`INSERT INTO persons (id,name,owner_id,visibility_level)
        VALUES (${personId},'Attachment owner',${owner.id},'all')`);
      const storage = new FakeStorageClient();
      const fileIds: string[] = [];
      for (let index = 0; index < 2; index++) {
        const seeded = await seedReadyFile(db, {
          uploadedBy: owner.id,
          entityType: "person",
          entityId: personId,
          filename: `part-${index}.pdf`,
          contentType: "application/pdf",
          content: Buffer.alloc(8 * 1024 * 1024),
          storage,
        });
        fileIds.push(seeded.fileId);
      }
      const result = await sendEmail(db, {
        actorId: owner.id,
        actorType: "regular",
        actorGroupIds: new Set(),
        gmail: new FakeGmailClient(),
        storage,
        input: {
          accountId,
          idempotencyKey: randomUUID(),
          to: ["recipient@example.com"],
          subject: "Hello",
          bodyHtml: "<p>Hello</p>",
          attachments: fileIds.map((fileId) => ({ fileId })),
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe(ERROR_IDS.MAIL_SEND_REJECTED);
      expect(storage.calls.some((call) => call.method === "getObjectBytes")).toBe(false);
    });
  });

  it("rejects an old queued payload with duplicate attachments before storage or Gmail dispatch", async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const accountId = await seedAccount(db, owner.id);
      const idempotencyKey = randomUUID();
      const fileId = randomUUID();
      const attachment = {
        fileId,
        s3Key: "confirmed/test-attachment",
        filename: "test.pdf",
        contentType: "application/pdf",
      };
      await enqueueSend(db, {
        accountId,
        idempotencyKey,
        payload: {
          to: ["recipient@example.com"],
          subject: "Hello",
          html: "<p>Hello</p>",
          attachments: [attachment, attachment],
        },
      });
      const storage = new FakeStorageClient();
      const gmail = new FakeGmailClient();
      const result = await processSendAttempt(db, {
        accountId,
        idempotencyKey,
        gmail,
        storage,
        signal: AbortSignal.timeout(10_000),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe(ERROR_IDS.MAIL_SEND_REJECTED);
      expect(storage.calls).toHaveLength(0);
      expect(gmail.calls.some((call) => call.method === "sendRaw")).toBe(false);
      expect(
        (
          await db.execute(sql`SELECT send_started_at FROM email_send_attempts
          WHERE idempotency_key=${idempotencyKey}`)
        ).rows[0],
      ).toMatchObject({ send_started_at: null });
    });
  });
});
