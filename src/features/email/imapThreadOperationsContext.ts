import { and, asc, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailAccounts, emailMessages, emailThreads, users } from "@/db/schema";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok } from "@/types/result";
import {
  IMAP_THREAD_MAX_LOCATORS,
  type ImapThreadOperationDeps,
} from "./imapThreadOperationsTypes";
import { loadImapConnection } from "./mailConnectionRuntime";

export async function loadImapOperation(
  db: Db,
  actor: AuthUser,
  threadId: string,
  signal: AbortSignal,
  deps: ImapThreadOperationDeps,
) {
  signal.throwIfAborted();
  if (!actor.isActive)
    return err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
  const [thread] = await db
    .select({ accountId: emailAccounts.id, provider: emailAccounts.provider })
    .from(emailThreads)
    .innerJoin(emailAccounts, eq(emailAccounts.id, emailThreads.accountId))
    .innerJoin(users, eq(users.id, emailAccounts.userId))
    .where(
      and(
        eq(emailThreads.id, threadId),
        eq(emailAccounts.userId, actor.id),
        eq(users.isActive, true),
        isNull(users.invitedAt),
      ),
    );
  signal.throwIfAborted();
  if (thread === undefined)
    return err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
  if (thread.provider !== "imap_smtp")
    return err(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "mailbox operation unsupported"));
  const runtime = await (deps.loadConnection ?? loadImapConnection)(db, thread.accountId, signal);
  signal.throwIfAborted();
  if (!runtime.ok) return runtime;
  if (runtime.value.accountId !== thread.accountId || runtime.value.ownerId !== actor.id)
    return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
  return runtime;
}

export async function imapOperationLocators(
  tx: DbOrTx,
  accountId: string,
  threadId: string,
  signal: AbortSignal,
) {
  const rows = await tx
    .select({
      id: mailMessageLocators.id,
      folderId: mailFolders.id,
      path: mailFolders.path,
      uidValidity: mailMessageLocators.uidValidity,
      uid: mailMessageLocators.uid,
      messageId: emailMessages.id,
      flags: mailMessageLocators.flags,
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
    .where(
      and(
        eq(mailMessageLocators.accountId, accountId),
        eq(emailMessages.threadId, threadId),
        eq(mailMessageLocators.active, true),
      ),
    )
    .orderBy(asc(mailFolders.path), asc(mailMessageLocators.uid))
    .limit(IMAP_THREAD_MAX_LOCATORS + 1);
  signal.throwIfAborted();
  return rows.length === 0 || rows.length > IMAP_THREAD_MAX_LOCATORS
    ? err(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "no bounded writable remote copies"))
    : ok(rows);
}
