import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { FakeGmailClient } from "@/features/email/gmailFake";
import { enqueueSend } from "@/features/email/outbox";
import { runSendJob } from "@/features/email/worker";
import { ok } from "@/types/result";
import { notificationAttempts, notificationSmtpFixture } from "./notificationDispatch.test-helpers";

for (const kind of ["allowed", "opt_out", "visibility", "invited", "inactive"] as const)
  it(`runs Gmail's actual worker/outbox path with ${kind} at the final provider fence`, async () => {
    await withTestDb(async (db) => {
      const f = await notificationSmtpFixture(db);
      try {
        await db.execute(sql`UPDATE email_accounts SET provider='gmail' WHERE id=${f.accountId}`);
        expect(
          await enqueueSend(db, {
            accountId: f.accountId,
            idempotencyKey: f.notificationId,
            payload: {
              to: [f.runtime.emailAddress],
              subject: "Notification",
              html: "<p>Private notice</p>",
              visibility: "private",
              trackOpens: false,
              trackLinks: false,
              systemPurpose: {
                version: 1,
                kind: "notification",
                notificationId: f.notificationId,
                recipientUserId: f.owner.id,
              },
            },
          }),
        ).toMatchObject({ ok: true });
        const before = await notificationAttempts(db, f.notificationId);
        expect(before).toHaveLength(1);
        const gmail = new FakeGmailClient();
        gmail.messages.set("sent-1", {
          id: "sent-1",
          threadId: "t1",
          labelIds: ["SENT"],
          payload: {
            mimeType: "text/html",
            body: { data: Buffer.from("<p>Private notice</p>").toString("base64url") },
            headers: [
              { name: "From", value: f.runtime.emailAddress },
              { name: "To", value: f.runtime.emailAddress },
              { name: "Subject", value: "Notification" },
            ],
          },
        });
        let resolved = false;
        const result = await runSendJob(
          db,
          {
            accountId: f.accountId,
            idempotencyKey: f.notificationId,
            signal: f.args.signal,
          },
          {
            ...f.deps,
            resolveClient: async () => {
              // The worker has admitted the owner. Revoke before its actual stamp.
              resolved = true;
              if (kind !== "allowed") await f.revoke(kind);
              return ok(gmail);
            },
          },
        );
        expect(resolved).toBe(true);
        const sends = gmail.calls.filter((call) => call.method === "sendRaw");
        const attempts = await notificationAttempts(db, f.notificationId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.payload).toEqual(before[0]?.payload);
        const copies = (
          await db.execute(sql`SELECT t.visibility,t.deal_id,t.person_id
          FROM email_messages m JOIN email_threads t ON t.id=m.thread_id
          WHERE m.account_id=${f.accountId}`)
        ).rows;
        if (kind === "allowed") {
          expect(result).toMatchObject({ ok: true, value: { status: "sent" } });
          expect(sends).toHaveLength(1);
          expect(attempts[0]?.send_started_at).not.toBeNull();
          expect(copies).toEqual([{ visibility: "private", deal_id: null, person_id: null }]);
        } else {
          expect(sends).toHaveLength(0);
          expect(attempts[0]?.send_started_at).toBeNull();
          expect(copies).toHaveLength(0);
        }
        expect(f.smtp.received).toHaveLength(0);
      } finally {
        await f.close();
      }
    });
  });
