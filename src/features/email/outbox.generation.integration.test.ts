import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { FakeStorageClient } from "@/features/files/storageFake";
import { ok } from "@/types/result";
import { seedAccount } from "./draft.test-helpers";
import { FakeGmailClient } from "./gmailFake";
import { enqueueSend, processSendAttempt } from "./outbox";

for (const change of ["generation", "inactive", "invited"] as const)
  it(`does not dispatch a queued Gmail attempt after ${change} authority changes`, async () => {
    await withTestDb(async (db) => {
      const owner = await seedUser(db);
      const accountId = await seedAccount(db, owner.id, "owner@mail.test");
      const idempotencyKey = randomUUID();
      await enqueueSend(db, {
        accountId,
        idempotencyKey,
        payload: { to: ["customer@mail.test"], subject: "Angebot", html: "<p>پیشنهاد</p>" },
      });
      if (change === "generation")
        await db.execute(
          sql`UPDATE email_accounts SET connection_generation=connection_generation+1 WHERE id=${accountId}`,
        );
      else if (change === "inactive")
        await db.execute(sql`UPDATE users SET is_active=false WHERE id=${owner.id}`);
      else await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${owner.id}`);
      const gmail = new FakeGmailClient();
      const result = await processSendAttempt(db, {
        accountId,
        idempotencyKey,
        gmail,
        storage: new FakeStorageClient(),
        signal: AbortSignal.timeout(10_000),
      });
      expect(result.ok).toBe(false);
      expect(gmail.calls).toHaveLength(0);
    });
  });

it("fences dispatch when authority changes during reply metadata retrieval", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const accountId = await seedAccount(db, owner.id, "owner@mail.test");
    const threadId = randomUUID();
    await db.execute(
      sql`INSERT INTO email_threads (id,account_id,gmail_thread_id) VALUES (${threadId},${accountId},'google-thread')`,
    );
    await db.execute(
      sql`INSERT INTO email_messages (thread_id,account_id,gmail_message_id,direction,from_email) VALUES (${threadId},${accountId},'google-parent','inbound','customer@mail.test')`,
    );
    const idempotencyKey = randomUUID();
    await enqueueSend(db, {
      accountId,
      idempotencyKey,
      threadId,
      payload: { to: ["customer@mail.test"], subject: "Re: Angebot", html: "<p>سپاس</p>" },
    });
    const gmail = new FakeGmailClient();
    gmail.getMessage = async () => {
      await db.execute(
        sql`UPDATE email_accounts SET connection_generation=connection_generation+1 WHERE id=${accountId}`,
      );
      return ok({ id: "google-parent", threadId: "google-thread", labelIds: [] });
    };
    expect(
      (
        await processSendAttempt(db, {
          accountId,
          idempotencyKey,
          gmail,
          storage: new FakeStorageClient(),
          signal: AbortSignal.timeout(10_000),
        })
      ).ok,
    ).toBe(false);
    expect(gmail.calls.some((call) => call.method === "sendRaw")).toBe(false);
  });
});

it("keeps a missing attachment definitely unsubmitted", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const accountId = await seedAccount(db, owner.id, "owner@mail.test");
    const idempotencyKey = randomUUID();
    await enqueueSend(db, {
      accountId,
      idempotencyKey,
      payload: {
        to: ["customer@mail.test"],
        subject: "Angebot",
        html: "",
        attachments: [
          {
            fileId: randomUUID(),
            s3Key: "missing-fixture",
            filename: "پیشنهاد.pdf",
            contentType: "application/pdf",
          },
        ],
      },
    });
    const gmail = new FakeGmailClient();
    expect(
      (
        await processSendAttempt(db, {
          accountId,
          idempotencyKey,
          gmail,
          storage: new FakeStorageClient(),
          signal: AbortSignal.timeout(10_000),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await db.execute(
          sql`SELECT send_started_at FROM email_send_attempts WHERE idempotency_key=${idempotencyKey}`,
        )
      ).rows[0],
    ).toMatchObject({ send_started_at: null });
  });
});
