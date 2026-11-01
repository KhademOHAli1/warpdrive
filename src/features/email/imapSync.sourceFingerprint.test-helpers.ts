import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW } from "./imapSync.test-helpers";
import { runImapThreadOperation } from "./imapThreadOperations";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

export async function movedSmtpCopyFixture(
  db: Db,
  args: { observed: boolean; signal: AbortSignal },
) {
  const f = await smtpOutboxFixture(db);
  try {
    f.storage.objectBytes.set("alias-source-pdf", Buffer.from("%PDF-1.7"));
    f.storage.objectsByKey.set("alias-source-pdf", { size: 8, contentType: "application/pdf" });
    await f.enqueue({
      subject: "پیگیری پیشنهاد / Rückfrage zum Angebot",
      text: "از پیشنهاد شما سپاسگزاریم. Vielen Dank für Ihr Angebot.",
      html: "<p>از پیشنهاد شما سپاسگزاریم. Vielen Dank für Ihr Angebot.</p>",
      attachments: [
        {
          fileId: f.attemptId,
          s3Key: "alias-source-pdf",
          filename: "پیشنهاد.pdf",
          contentType: "application/pdf",
        },
      ],
    });
    await db.execute(
      sql`UPDATE email_accounts SET connection_settings='{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb WHERE id=${f.accountId}`,
    );
    expect(await processSmtpSendAttempt(db, { ...f.args, signal: args.signal })).toMatchObject({
      ok: true,
      value: { status: "sent", sentCopy: { state: "complete" } },
    });
    const copy = (
      await db.execute(
        sql`SELECT id,thread_id,message_fingerprint FROM email_messages WHERE account_id=${f.accountId}`,
      )
    ).rows[0];
    if (typeof copy?.id !== "string" || typeof copy.thread_id !== "string")
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing accepted SMTP copy fixture");
    const attachmentRows = (
      await db.execute(
        sql`SELECT id,message_id,provider_locator FROM email_message_attachments WHERE account_id=${f.accountId} ORDER BY id`,
      )
    ).rows;
    expect(copy.message_fingerprint).toBeNull();
    const sent = f.imap.state.folders.get("Sent");
    const sentCopy = sent?.messages[0];
    if (sentCopy === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing authoritative APPEND copy fixture");
    const sync = (runtime = f.runtime) =>
      runImapSyncJob(
        db,
        { accountId: runtime.accountId, signal: args.signal, now: IMAP_SYNC_NOW },
        { loadConnection: () => Promise.resolve(ok(runtime)) },
      );
    if (args.observed) {
      sentCopy.source = Buffer.concat([
        Buffer.from("Received: by controlled.mail.test\r\n"),
        sentCopy.source,
      ]);
      f.runtime.folderPaths = ["Sent"];
      expect(await sync()).toMatchObject({ ok: true, value: { applied: 0, more: false } });
    }
    f.imap.state.folders.set("Archiv", { validity: "987", readOnly: false, messages: [] });
    f.imap.state.omitCopyUid = true;
    f.runtime.folderPaths = ["Sent", "Archiv"];
    const actor: AuthUser = {
      id: f.owner.id,
      type: "regular",
      isActive: true,
      groupIds: new Set(),
    };
    expect(
      await runImapThreadOperation(
        db,
        { actor, threadId: copy.thread_id, operation: { kind: "move", destinationPath: "Archiv" } },
        args.signal,
        { loadConnection: () => Promise.resolve(ok(f.runtime)) },
      ),
    ).toMatchObject({ ok: true, value: { requiresResync: true } });
    const archive = f.imap.state.folders.get("Archiv");
    const moved = archive?.messages[0];
    if (moved === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing moved SMTP copy fixture");
    expect(f.smtp.received).toHaveLength(1);
    return {
      ...f,
      messageId: copy.id,
      threadId: copy.thread_id,
      attachmentRows,
      moved,
      originalSource: Buffer.from(moved.source),
      sync,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
