import { and, eq } from "drizzle-orm";
import { emailMessages } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { repairImapAttachmentLocators } from "./imapApplyAttachmentFallback";

export async function reconciledImapThread(
  tx: DbOrTx,
  args: { accountId: string; messageId: string | null; missing: boolean; signal: AbortSignal },
): Promise<string | null> {
  if (args.messageId === null) return null;
  if (args.missing)
    await repairImapAttachmentLocators(tx, args.accountId, args.messageId, args.signal);
  const [message] = await tx
    .select({ threadId: emailMessages.threadId })
    .from(emailMessages)
    .where(and(eq(emailMessages.id, args.messageId), eq(emailMessages.accountId, args.accountId)));
  args.signal.throwIfAborted();
  return message?.threadId ?? null;
}
