import { and, eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { emailAccounts, emailThreads } from "@/db/schema/email";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationReader } from "./deliveryObservationAuthority";
import { canSeeEmail } from "./emailVisibility";
import { privateIntakeBlocksThread } from "./privateIntakeRestrictions";
import type { ReadIntentBinding } from "./readIntentTypes";
import { hydrateOwner } from "./syncCursor";

export interface ReadIntentScope {
  actor: AuthUser;
  binding: ReadIntentBinding;
}

// The caller owns a short transaction. Lock parents before intent evidence;
// owner-only account helpers would incorrectly exclude permitted co-viewers.
export async function lockReadIntentScope(
  tx: DbOrTx,
  args: { actor: AuthUser; threadId: string; desiredRead: boolean },
  signal: AbortSignal,
): Promise<Result<ReadIntentScope, AppError>> {
  signal.throwIfAborted();
  const missing = () => err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found"));
  if (!(await lockDeliveryObservationReader(tx, args.actor.id, signal))) return missing();
  const currentActor = await hydrateOwner(tx, args.actor.id, signal);
  if (!currentActor.ok) return missing();

  const [identity] = await tx
    .select({ accountId: emailThreads.accountId })
    .from(emailThreads)
    .where(eq(emailThreads.id, args.threadId));
  signal.throwIfAborted();
  if (identity === undefined) return missing();
  const [account] = await tx
    .select({
      id: emailAccounts.id,
      ownerId: emailAccounts.userId,
      provider: emailAccounts.provider,
      generation: emailAccounts.connectionGeneration,
    })
    .from(emailAccounts)
    .where(eq(emailAccounts.id, identity.accountId))
    .for("share");
  signal.throwIfAborted();
  if (account === undefined) return missing();
  const [thread] = await tx
    .select({
      visibility: emailThreads.visibility,
      dealId: emailThreads.dealId,
      personId: emailThreads.personId,
      // Nested SQL preserves the outer qualification in a single-table projection.
      privateCopy: privateIntakeBlocksThread(
        sql`${emailThreads.accountId}`,
        sql`${emailThreads.id}`,
      ),
    })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, args.threadId), eq(emailThreads.accountId, account.id)))
    .for("share");
  signal.throwIfAborted();
  if (thread === undefined || (thread.privateCopy && account.ownerId !== currentActor.value.id))
    return missing();
  const visible = await canSeeEmail(
    tx,
    currentActor.value,
    { ...thread, accountId: account.id, ownerUserId: account.ownerId },
    signal,
  );
  signal.throwIfAborted();
  if (!visible) return missing();

  // Local read preferences remain available while credentials/sync are offline.
  // Only ordinary owned IMAP work follows the existing remote operation route.
  const readMode =
    !thread.privateCopy && account.provider === "imap_smtp" && account.ownerId === args.actor.id
      ? "imap"
      : "local";
  return ok({
    actor: currentActor.value,
    binding: {
      actorId: currentActor.value.id,
      accountId: account.id,
      threadId: args.threadId,
      mailboxOwnerId: account.ownerId,
      accountProvider: account.provider,
      connectionGeneration: account.generation,
      privateCopy: thread.privateCopy,
      desiredRead: args.desiredRead,
      readMode,
    },
  });
}
