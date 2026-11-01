import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  emailAccounts,
  emailMessageAttachments,
  emailMessages,
  emailThreads,
  users,
} from "@/db/schema";
import type { AuthUser } from "@/features/permissions/types";
import { canSeeEmail } from "./emailVisibility";

export async function authorizedAttachment(
  db: Db,
  actor: AuthUser,
  attachmentId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!actor.isActive) return null;
  const [activeActor] = await db
    .select({ active: users.isActive, invitedAt: users.invitedAt })
    .from(users)
    .where(eq(users.id, actor.id));
  signal.throwIfAborted();
  if (activeActor?.active !== true || activeActor.invitedAt !== null) return null;
  const [row] = await db
    .select({
      id: emailMessageAttachments.id,
      filename: emailMessageAttachments.filename,
      mimeType: emailMessageAttachments.mimeType,
      size: emailMessageAttachments.sizeBytes,
      providerLocator: emailMessageAttachments.providerLocator,
      gmailAttachmentId: emailMessageAttachments.gmailAttachmentId,
      messageId: emailMessages.id,
      gmailMessageId: emailMessages.gmailMessageId,
      accountId: emailThreads.accountId,
      threadId: emailThreads.id,
      visibility: emailThreads.visibility,
      dealId: emailThreads.dealId,
      personId: emailThreads.personId,
      ownerUserId: emailAccounts.userId,
      ownerActive: users.isActive,
      ownerInvitedAt: users.invitedAt,
      provider: emailAccounts.provider,
      generation: emailAccounts.connectionGeneration,
      status: emailAccounts.status,
      paused: emailAccounts.paused,
    })
    .from(emailMessageAttachments)
    .innerJoin(
      emailMessages,
      and(
        eq(emailMessages.id, emailMessageAttachments.messageId),
        eq(emailMessages.accountId, emailMessageAttachments.accountId),
      ),
    )
    .innerJoin(
      emailThreads,
      and(
        eq(emailThreads.id, emailMessages.threadId),
        eq(emailThreads.accountId, emailMessages.accountId),
      ),
    )
    .innerJoin(emailAccounts, eq(emailAccounts.id, emailThreads.accountId))
    .innerJoin(users, eq(users.id, emailAccounts.userId))
    .where(eq(emailMessageAttachments.id, attachmentId));
  signal.throwIfAborted();
  if (row?.ownerActive !== true || row.ownerInvitedAt !== null) return null;
  return (await canSeeEmail(db, actor, row, signal)) ? row : null;
}

export type AuthorizedAttachment = NonNullable<Awaited<ReturnType<typeof authorizedAttachment>>>;
