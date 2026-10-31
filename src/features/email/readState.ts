import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailAccounts, emailThreadReads, emailThreads } from "@/db/schema";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import { canSeeEmail, type ThreadVisibilityRow } from "./emailVisibility";
import { runImapThreadOperation } from "./imapThreadOperations";
import type { ImapThreadOperationDeps } from "./imapThreadOperationsTypes";

// Load the thread's visibility-relevant columns; null if missing. canSeeEmail resolves the
// owning account (and, for shared threads, the linked deal/person) itself from these fields,
// so no separate owner lookup is needed here (unlike the illustrative brief draft).
async function loadThread(db: Db, threadId: string, signal: AbortSignal) {
  const rows = await db
    .select({
      accountId: emailThreads.accountId,
      visibility: emailThreads.visibility,
      dealId: emailThreads.dealId,
      personId: emailThreads.personId,
      ownerUserId: emailAccounts.userId,
      provider: emailAccounts.provider,
    })
    .from(emailThreads)
    .innerJoin(emailAccounts, eq(emailAccounts.id, emailThreads.accountId))
    .where(eq(emailThreads.id, threadId));
  const r = rows[0];
  signal.throwIfAborted();
  return r === undefined ? null : r;
}

// 404-on-invisible: a missing or unseeable thread returns the same error so existence is
// never leaked (same GMAIL_THREAD_NOT_FOUND used by listInbox/getThread).
async function gate(
  db: Db,
  actor: AuthUser,
  t: ThreadVisibilityRow | null,
  signal: AbortSignal,
): Promise<AppError | null> {
  if (t === null || !(await canSeeEmail(db, actor, t, signal))) {
    return new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found", {});
  }
  return null;
}

export async function markThreadRead(
  db: Db,
  args: { actor: AuthUser; threadId: string },
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<{ threadId: string }, AppError>> {
  signal.throwIfAborted();
  const thread = await loadThread(db, args.threadId, signal);
  const bad = await gate(db, args.actor, thread, signal);
  if (bad !== null) return err(bad);
  if (thread?.provider === "imap_smtp" && thread.ownerUserId === args.actor.id)
    return runImapThreadOperation(
      db,
      { ...args, operation: { kind: "read", read: true } },
      signal,
      deps,
    );
  signal.throwIfAborted();
  await db
    .insert(emailThreadReads)
    .values({ threadId: args.threadId, userId: args.actor.id, readAt: new Date() })
    .onConflictDoUpdate({
      target: [emailThreadReads.threadId, emailThreadReads.userId],
      set: { readAt: new Date() },
    });
  return ok({ threadId: args.threadId });
}

export async function markThreadUnread(
  db: Db,
  args: { actor: AuthUser; threadId: string },
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<{ threadId: string }, AppError>> {
  signal.throwIfAborted();
  const thread = await loadThread(db, args.threadId, signal);
  const bad = await gate(db, args.actor, thread, signal);
  if (bad !== null) return err(bad);
  if (thread?.provider === "imap_smtp" && thread.ownerUserId === args.actor.id)
    return runImapThreadOperation(
      db,
      { ...args, operation: { kind: "read", read: false } },
      signal,
      deps,
    );
  signal.throwIfAborted();
  await db
    .delete(emailThreadReads)
    .where(
      and(eq(emailThreadReads.threadId, args.threadId), eq(emailThreadReads.userId, args.actor.id)),
    );
  return ok({ threadId: args.threadId });
}

// Candidate rows = threads in the actor's OWN mailbox only (same candidate set as listInbox, which
// is a personal folder). A colleague's shared thread is not part of the actor's unread badge; it
// reaches them on the linked record instead. canSeeEmail still re-checks each row.
interface UnreadCandidateRow extends ThreadVisibilityRow {
  ownerId: string;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  readAt: Date | null;
}

export async function inboxUnreadCount(
  db: Db,
  args: { actor: AuthUser },
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  const rows: UnreadCandidateRow[] = await db
    .select({
      accountId: emailThreads.accountId,
      visibility: emailThreads.visibility,
      dealId: emailThreads.dealId,
      personId: emailThreads.personId,
      ownerId: emailAccounts.userId,
      archivedAt: emailThreads.archivedAt,
      lastMessageAt: emailThreads.lastMessageAt,
      readAt: emailThreadReads.readAt,
    })
    .from(emailThreads)
    .innerJoin(emailAccounts, eq(emailAccounts.id, emailThreads.accountId))
    .leftJoin(
      emailThreadReads,
      and(
        eq(emailThreadReads.threadId, emailThreads.id),
        eq(emailThreadReads.userId, args.actor.id),
      ),
    )
    .where(and(isNull(emailThreads.trashedAt), eq(emailAccounts.userId, args.actor.id)));
  signal.throwIfAborted();

  let n = 0;
  for (const r of rows) {
    // archived_at is a per-owner local flag: it only hides a thread from the owner's own
    // Inbox, never from a co-viewer of a shared thread.
    if (r.ownerId === args.actor.id && r.archivedAt !== null) continue;
    const unread = r.readAt === null || (r.lastMessageAt !== null && r.readAt < r.lastMessageAt);
    if (!unread) continue;
    if (!(await canSeeEmail(db, args.actor, r, signal))) continue;
    n++;
  }
  return n;
}
