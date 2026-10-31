import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { AuthUser } from "@/features/permissions/types";
import { makeTestDb } from "@/test/db";
import { readMailboxWorkspace } from "./mailboxWorkspace";

let h: Awaited<ReturnType<typeof makeTestDb>>;
let actor: AuthUser;
let accountId: string;
beforeAll(async () => {
  h = await makeTestDb();
  const owner = (
    await h.db.execute(
      sql`INSERT INTO users (email,name,google_sub) VALUES ('inbox-owner@example.com','Owner','inbox-owner') RETURNING id`,
    )
  ).rows[0] as { id: string };
  actor = { id: owner.id, type: "regular", isActive: true, groupIds: new Set() };
  accountId = (
    (
      await h.db.execute(
        sql`INSERT INTO email_accounts (user_id,email_address) VALUES (${owner.id},'inbox-owner@example.com') RETURNING id`,
      )
    ).rows[0] as { id: string }
  ).id;
  await h.db.execute(sql`INSERT INTO email_threads (account_id,gmail_thread_id,subject,visibility,last_message_at,follow_up_status)
    SELECT ${accountId}, 'workspace-' || n, 'Budget ' || n, 'private', now() - n * interval '1 minute', CASE WHEN n=121 THEN 'waiting' ELSE NULL END FROM generate_series(1,125) n`);
  await h.db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
    SELECT id,${owner.id},now() FROM email_threads WHERE account_id=${accountId} AND gmail_thread_id <> 'workspace-122'`);
  const foreign = (
    await h.db.execute(
      sql`INSERT INTO users (email,name,google_sub) VALUES ('inbox-other@example.com','Other','inbox-other') RETURNING id`,
    )
  ).rows[0] as { id: string };
  const foreignAccount = (
    (
      await h.db.execute(
        sql`INSERT INTO email_accounts (user_id,email_address) VALUES (${foreign.id},'inbox-other@example.com') RETURNING id`,
      )
    ).rows[0] as { id: string }
  ).id;
  await h.db.execute(
    sql`INSERT INTO email_threads (account_id,gmail_thread_id,subject,visibility,last_message_at,follow_up_status) VALUES (${foreignAccount},'foreign','Budget private','shared',now(),'waiting')`,
  );
});
afterAll(async () => {
  await h?.close();
});
const signal = () => new AbortController().signal;

it("searches beyond the previous 100-result cap and pages without overlap", async () => {
  const first = await readMailboxWorkspace(
    h.db,
    { actor, folder: "inbox", query: "Budget", limit: 100 },
    signal(),
  );
  expect(first.total).toBe(125);
  expect(first.threads).toHaveLength(100);
  expect(first.nextCursor).not.toBeNull();
  const second = await readMailboxWorkspace(
    h.db,
    { actor, folder: "inbox", query: "Budget", limit: 100, cursor: first.nextCursor },
    signal(),
  );
  expect(second.threads).toHaveLength(25);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.threads, ...second.threads].map((t) => t.id)).size).toBe(125);
});
it("applies unread and waiting across the whole mailbox, with distinct meanings", async () => {
  const unread = await readMailboxWorkspace(
    h.db,
    { actor, folder: "inbox", view: "unread" },
    signal(),
  );
  expect(unread.total).toBe(1);
  expect(unread.threads[0]?.subject).toBe("Budget 122");
  const waiting = await readMailboxWorkspace(
    h.db,
    { actor, folder: "inbox", view: "waiting" },
    signal(),
  );
  expect(waiting.total).toBe(1);
  expect(waiting.threads[0]?.subject).toBe("Budget 121");
  expect(waiting.threads[0]?.unread).toBe(false);
});
it("keeps colleague mail out of the personal mailbox even when shared", async () => {
  const result = await readMailboxWorkspace(
    h.db,
    { actor, folder: "inbox", query: "private" },
    signal(),
  );
  expect(result.total).toBe(0);
  expect(result.threads).toEqual([]);
});
it("does no work for an already cancelled request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readMailboxWorkspace(h.db, { actor, folder: "inbox" }, controller.signal),
  ).rejects.toThrow();
});
