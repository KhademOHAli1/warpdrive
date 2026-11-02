import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type { Db } from "@/db/client";
import { connectNotificationMailbox } from "@/features/notifications/email/notificationJob.test-helpers";
import type { AuthUser } from "@/features/permissions/types";
import { getThread } from "./emailReads";
import { listInbox } from "./inboxList";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { getMessage } from "./messageReads";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

export function privateProjectionActor(id: string, isAdmin = false): AuthUser {
  return { id, type: isAdmin ? "admin" : "regular", isActive: true, groupIds: new Set() };
}

export async function readPrivateProjectionCallers(
  db: Db,
  actor: AuthUser,
  ids: { threadId: string; messageId: string },
  signal: AbortSignal,
) {
  return {
    thread: await getThread(db, { actor, threadId: ids.threadId, allowRemote: false }, signal),
    message: await getMessage(db, { actor, messageId: ids.messageId, allowRemote: false }, signal),
    inbox: await listInbox(db, { actor, filter: "all" }, signal),
  };
}

export function expectPrivateProjectionSummary(
  dto: Awaited<ReturnType<typeof readPrivateProjectionCallers>>,
  threadId: string,
  expected: PrivateIntakeSummary | null,
  options: { messagePresent?: boolean; inboxPresent?: boolean } = {},
) {
  expect.soft(dto.thread.ok).toBe(true);
  if (dto.thread.ok) {
    expect.soft(dto.thread.value).toHaveProperty("privateIntake", expected);
    expect.soft(dto.thread.value.thread).toHaveProperty("privateIntake", expected);
    for (const message of dto.thread.value.messages)
      expect.soft(message).toHaveProperty("privateIntake", expected);
  }
  if (options.messagePresent !== false) {
    expect.soft(dto.message.ok).toBe(true);
    if (dto.message.ok) expect.soft(dto.message.value).toHaveProperty("privateIntake", expected);
  } else expect.soft(dto.message.ok).toBe(false);
  const row = dto.inbox.threads.find((thread) => thread.id === threadId);
  if (options.inboxPresent === false) expect.soft(row).toBeUndefined();
  else {
    expect.soft(row).toBeDefined();
    expect.soft(row).toHaveProperty("privateIntake", expected);
  }
}

export async function seedOrdinaryPrivateProjection(db: Db, signal: AbortSignal) {
  const owner = await seedMailHttpSession(db);
  const account = await connectNotificationMailbox(db, owner.user.id, signal);
  await db.execute(sql`UPDATE email_accounts SET provider='imap_smtp',capabilities=
    '{"read":true,"send":true,"markRead":true,"move":true,"trash":true}'::jsonb
    WHERE id=${account.id}`);
  const threadId = randomUUID();
  const messageId = randomUUID();
  await db.execute(sql`INSERT INTO email_threads(id,account_id,provider_thread_id,subject,visibility)
    VALUES(${threadId},${account.id},${`ordinary:${threadId}`},'Ordinary mail','private')`);
  await db.execute(sql`INSERT INTO email_messages
    (id,account_id,thread_id,provider_message_id,direction,from_email,to_emails,subject,body_html)
    VALUES(${messageId},${account.id},${threadId},${`ordinary:${messageId}`},'inbound',
      'customer@example.test',${JSON.stringify([account.emailAddress])}::jsonb,
      'Ordinary mail','<p>Ordinary body</p>')`);
  signal.throwIfAborted();
  return { owner, account, threadId, messageId, actor: privateProjectionActor(owner.user.id) };
}
