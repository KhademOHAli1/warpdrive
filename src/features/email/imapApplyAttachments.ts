import { and, eq, sql } from "drizzle-orm";
import { emailMessageAttachments } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { RawParsedMail } from "./providers/rawMimeTypes";

export async function imapAttachmentLocators(
  tx: DbOrTx,
  args: {
    accountId: string;
    messageId: string;
    folderPath: string;
    uidValidity: string;
    uid: number;
  },
  parsed: RawParsedMail,
  signal: AbortSignal,
): Promise<void> {
  const existing = await tx
    .select({
      id: emailMessageAttachments.id,
      filename: emailMessageAttachments.filename,
      contentType: emailMessageAttachments.mimeType,
      size: emailMessageAttachments.sizeBytes,
      kind: sql<string | null>`${emailMessageAttachments.providerLocator}->>'kind'`,
      hash: sql<string | null>`${emailMessageAttachments.providerLocator}->>'sha256'`,
      partKey: sql<string | null>`${emailMessageAttachments.providerLocator}->>'partKey'`,
    })
    .from(emailMessageAttachments)
    .where(
      and(
        eq(emailMessageAttachments.accountId, args.accountId),
        eq(emailMessageAttachments.messageId, args.messageId),
      ),
    );
  signal.throwIfAborted();
  const claimed = new Set<string>();
  for (const part of parsed.attachments) {
    const hash = createHash("sha256").update(part.content).digest("hex");
    const snapshot = existing.find(
      (row) =>
        row.kind === "stored" &&
        !claimed.has(row.id) &&
        row.hash === hash &&
        row.filename === part.filename &&
        row.contentType === part.contentType &&
        row.size === part.size,
    );
    if (snapshot !== undefined) {
      claimed.add(snapshot.id);
      continue;
    }
    const providerLocator = {
      kind: "imap" as const,
      folderPath: args.folderPath,
      uidValidity: args.uidValidity,
      uid: args.uid,
      partKey: part.partKey,
    };
    const remote = existing.find(
      (row) => row.kind === "imap" && !claimed.has(row.id) && row.partKey === part.partKey,
    );
    if (remote === undefined)
      await tx.insert(emailMessageAttachments).values({
        accountId: args.accountId,
        messageId: args.messageId,
        filename: part.filename,
        mimeType: part.contentType,
        sizeBytes: part.size,
        providerLocator,
      });
    else
      await tx
        .update(emailMessageAttachments)
        .set({ providerLocator })
        .where(eq(emailMessageAttachments.id, remote.id));
    if (remote !== undefined) claimed.add(remote.id);
    signal.throwIfAborted();
  }
}

import { createHash } from "node:crypto";
