import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emailAccounts, emailDrafts, emailMessages, emailThreads } from "@/db/schema";
import type { TestDb } from "@/test/db";

export async function seedDiscoveryMail(
  h: TestDb,
  user: { id: string; email: string },
  personId: string,
  address: string,
) {
  const [account] = await h.db
    .insert(emailAccounts)
    .values({ userId: user.id, emailAddress: user.email })
    .returning();
  assert(account !== undefined);
  const [thread, unrelatedThread] = await h.db
    .insert(emailThreads)
    .values([
      {
        accountId: account.id,
        gmailThreadId: randomUUID(),
        personId,
        subject: "PRIVATE-THREAD-SENTINEL",
      },
      { accountId: account.id, gmailThreadId: randomUUID(), subject: "Unrelated mailbox thread" },
    ])
    .returning();
  assert(thread !== undefined && unrelatedThread !== undefined);
  const [message, unrelatedMessage] = await h.db
    .insert(emailMessages)
    .values([
      {
        accountId: account.id,
        threadId: thread.id,
        gmailMessageId: randomUUID(),
        direction: "inbound",
        fromEmail: address,
        toEmails: [user.email],
        bodyText: "PRIVATE-MESSAGE-SENTINEL",
      },
      {
        accountId: account.id,
        threadId: unrelatedThread.id,
        gmailMessageId: randomUUID(),
        direction: "inbound",
        fromEmail: "someone-else@example.test",
        toEmails: ["another-person@example.test"],
        bodyText: "PRIVATE-UNRELATED-MAIL-SENTINEL",
      },
    ])
    .returning();
  const [draft] = await h.db
    .insert(emailDrafts)
    .values({
      accountId: account.id,
      linkPersonId: personId,
      toEmails: [address],
      bodyHtml: "PRIVATE-DRAFT-SENTINEL",
    })
    .returning();
  assert(message !== undefined && unrelatedMessage !== undefined && draft !== undefined);
  return { thread, unrelatedThread, message, unrelatedMessage, draft };
}
