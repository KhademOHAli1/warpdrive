import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailAccounts, emailMessages, emailThreads, users } from "@/db/schema";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import type { AuthUser } from "@/features/permissions/types";
import { IMAP_THREAD_MAX_LOCATORS } from "./imapThreadOperationsTypes";
import { mailboxCapabilitiesSchema } from "./mailConnectionSchemas";
import type { InboxThread } from "./threadShape";

export interface ThreadMailCapabilities {
  read: boolean;
  send: boolean;
  markRead: boolean;
  move: boolean;
  trash: boolean;
}
export const NO_MAIL_CAPABILITIES: ThreadMailCapabilities = {
  read: false,
  send: false,
  markRead: false,
  move: false,
  trash: false,
};

export async function threadMailCapabilities(
  db: Db,
  actor: AuthUser,
  threadIds: string[],
  signal: AbortSignal,
): Promise<Map<string, ThreadMailCapabilities>> {
  const output = new Map<string, ThreadMailCapabilities>();
  if (threadIds.length === 0) return output;
  const accounts = await db
    .select({
      threadId: emailThreads.id,
      ownerId: emailAccounts.userId,
      provider: emailAccounts.provider,
      status: emailAccounts.status,
      paused: emailAccounts.paused,
      capabilities: emailAccounts.capabilities,
      ownerActive: users.isActive,
      ownerInvitedAt: users.invitedAt,
    })
    .from(emailThreads)
    .innerJoin(emailAccounts, eq(emailAccounts.id, emailThreads.accountId))
    .innerJoin(users, eq(users.id, emailAccounts.userId))
    .where(inArray(emailThreads.id, threadIds));
  signal.throwIfAborted();
  const folders = await db
    .select({
      threadId: emailMessages.threadId,
      copies: sql<number>`count(*)::int`,
      writable: sql<boolean>`bool_and(${mailFolders.readOnly} IS FALSE)`,
    })
    .from(mailMessageLocators)
    .innerJoin(
      emailMessages,
      and(
        eq(emailMessages.id, mailMessageLocators.messageId),
        eq(emailMessages.accountId, mailMessageLocators.accountId),
      ),
    )
    .innerJoin(
      mailFolders,
      and(
        eq(mailFolders.id, mailMessageLocators.folderId),
        eq(mailFolders.accountId, mailMessageLocators.accountId),
        eq(mailFolders.uidValidity, mailMessageLocators.uidValidity),
      ),
    )
    .where(and(inArray(emailMessages.threadId, threadIds), eq(mailMessageLocators.active, true)))
    .groupBy(emailMessages.threadId);
  signal.throwIfAborted();
  const writable = new Map(
    folders.map((row) => [
      row.threadId,
      row.copies > 0 && row.copies <= IMAP_THREAD_MAX_LOCATORS && row.writable,
    ]),
  );
  for (const account of accounts) {
    const owner = account.ownerId === actor.id;
    const active =
      actor.isActive &&
      account.ownerActive &&
      account.ownerInvitedAt === null &&
      account.status === "connected" &&
      !account.paused;
    const caps = mailboxCapabilitiesSchema.safeParse(account.capabilities);
    const remote = active && caps.success && writable.get(account.threadId) === true;
    const gmail = account.provider === "gmail";
    output.set(account.threadId, {
      read: true,
      send: owner && active && (gmail || (caps.success && caps.data.send)),
      markRead: !owner || gmail || (remote && caps.data.markRead),
      move: owner && !gmail && remote && caps.data.move,
      trash: owner && active && (gmail || (remote && caps.data.trash)),
    });
  }
  return output;
}

export async function decorateThreadMailCapabilities(
  db: Db,
  actor: AuthUser,
  threads: InboxThread[],
  signal: AbortSignal,
): Promise<InboxThread[]> {
  const caps = await threadMailCapabilities(
    db,
    actor,
    threads.map((thread) => thread.id),
    signal,
  );
  return threads.map((thread) => ({
    ...thread,
    mailCapabilities: caps.get(thread.id) ?? NO_MAIL_CAPABILITIES,
  }));
}
