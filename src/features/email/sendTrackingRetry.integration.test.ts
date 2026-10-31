import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err, ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { createSmtpTransport } from "./providers/smtp";
import { sendEmail } from "./send";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

for (const provider of ["gmail", "imap_smtp"] as const)
  it(`restores prepared tracking only when a safe ${provider} retry reaches submission`, async () => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        await db.execute(
          sql`UPDATE email_accounts SET provider=${provider} WHERE id=${f.accountId}`,
        );
        const gmail = new FakeGmailClient();
        gmail.sendImpl = () =>
          err(new AppError("E_GMAIL_001", "synthetic definite rejection", { status: 400 }));
        const badMail = {
          ...f.runtime,
          smtp: createSmtpTransport({
            endpoint: f.smtp.endpoint,
            username: "owner@mail.test",
            password: "incorrect-fixture-password",
          }),
        };
        const base = {
          actorId: f.owner.id,
          actorType: "regular" as const,
          actorGroupIds: new Set<string>(),
          storage: f.storage,
          signal: f.args.signal,
          input: {
            accountId: f.accountId,
            idempotencyKey: randomUUID(),
            to: ["customer@mail.test"],
            subject: "پیگیری · Rückfrage",
            bodyHtml: "<p>سلام</p>",
            trackOpens: true,
          },
        };
        const rejected = await sendEmail(db, {
          ...base,
          ...(provider === "gmail" ? { gmail } : { mail: badMail }),
        });
        expect(rejected.ok && rejected.value.status).toBe("failed");
        expect((await db.execute(sql`SELECT disabled FROM email_tracking_tokens`)).rows).toEqual([
          { disabled: true },
        ]);
        gmail.sendImpl = () => ok({ id: "accepted-retry", threadId: "thread-retry" });
        gmail.messages.set("accepted-retry", {
          id: "accepted-retry",
          threadId: "thread-retry",
          labelIds: ["SENT"],
        });
        const accepted = await sendEmail(db, {
          ...base,
          ...(provider === "gmail" ? { gmail } : { mail: f.runtime }),
        });
        expect(accepted.ok && accepted.value.status).toBe("sent");
        expect(
          (await db.execute(sql`SELECT disabled,message_id FROM email_tracking_tokens`)).rows,
        ).toEqual([{ disabled: false, message_id: expect.any(String) }]);
      } finally {
        await f.close();
      }
    });
  });
