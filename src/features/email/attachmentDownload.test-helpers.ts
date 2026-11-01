import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { FakeStorageClient } from "@/features/files/storageFake";
import type { AuthUser } from "@/features/permissions/types";
import { ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { buildMime } from "./mime";

export const attachmentActor = (id: string): AuthUser => ({
  id,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
});
export const ATTACHMENT_TEST_BYTES = Buffer.from("%PDF-1.7 synthetic attachment");

export async function attachmentDownloadFixture(db: Db, filename = "پیشنهاد.pdf") {
  const f = await imapSyncFixture(db);
  const reply = f.server.state.folders.get("INBOX")?.messages[2];
  if (reply === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing fixture reply");
  reply.source = Buffer.from(
    buildMime({
      from: "client@mail.test",
      to: [f.runtime.emailAddress],
      subject: "پیشنهاد / Angebot",
      html: "<p>Vielen Dank / سپاسگزاریم</p>",
      messageId: "<reply@mail.test>",
      attachments: [{ filename, contentType: "application/pdf", bytes: ATTACHMENT_TEST_BYTES }],
    }),
  );
  const signal = AbortSignal.timeout(30000);
  const synced = await runImapSyncJob(
    db,
    { accountId: f.accountId, signal, now: IMAP_SYNC_NOW },
    f.deps,
  );
  if (!synced.ok) throw synced.error;
  const [attachment] = (
    await db.execute(
      sql`SELECT id,message_id FROM email_message_attachments WHERE account_id=${f.accountId}`,
    )
  ).rows;
  if (typeof attachment?.id !== "string" || typeof attachment.message_id !== "string")
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing imported attachment");
  const gmail = new FakeGmailClient();
  let gmailResolutions = 0;
  let imapResolutions = 0;
  const storage = new FakeStorageClient();
  return {
    ...f,
    attachmentId: attachment.id,
    messageId: attachment.message_id,
    filename,
    signal,
    actor: attachmentActor(f.owner.id),
    storage,
    gmail,
    deps: {
      resolveClient: () => {
        gmailResolutions += 1;
        return Promise.resolve(ok(gmail));
      },
      loadConnection: () => {
        imapResolutions += 1;
        return Promise.resolve(ok(f.runtime));
      },
      storage,
    },
    resolutions: () => ({ gmail: gmailResolutions, imap: imapResolutions }),
  };
}
