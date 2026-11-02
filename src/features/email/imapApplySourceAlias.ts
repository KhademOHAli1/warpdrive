import { and, eq, isNotNull } from "drizzle-orm";
import { mailMessageLocators } from "@/db/schema/mailRemote";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export async function uniqueImapSourceAlias(
  tx: DbOrTx,
  accountId: string,
  sourceFingerprint: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  // Distinct UUIDs are bounded, rather than locator rows: many copies of one UUID
  // must not hide another candidate. Inactive copies retain evidence after MOVE.
  const aliases = await tx
    .selectDistinct({ messageId: mailMessageLocators.messageId })
    .from(mailMessageLocators)
    .where(
      and(
        eq(mailMessageLocators.accountId, accountId),
        eq(mailMessageLocators.sourceFingerprint, sourceFingerprint),
        isNotNull(mailMessageLocators.messageId),
      ),
    )
    .limit(2);
  signal.throwIfAborted();
  // Ambiguity is ordinary unmatched input, never an arbitrary merge or page hold.
  return aliases.length === 1 ? (aliases[0]?.messageId ?? null) : null;
}
