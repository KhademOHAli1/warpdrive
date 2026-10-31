import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { guardImapConnection } from "./imapSyncGuard";
import { type ImapConnectionRuntime, isMailConnectionCurrent } from "./mailConnectionRuntime";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";
import type { SmtpAttempt } from "./smtpOutboxTypes";

export async function appendSmtpSentCopy(
  db: Db,
  args: {
    attempt: SmtpAttempt;
    runtime: ImapConnectionRuntime;
    messageId: string;
    raw: Buffer;
    signal: AbortSignal;
  },
): Promise<void> {
  const config = (
    await db.execute(
      sql`SELECT connection_settings FROM email_accounts WHERE id=${args.runtime.accountId}`,
    )
  ).rows[0] as
    | { connection_settings: { sentCopyMode?: string; sentFolderPath?: string } | null }
    | undefined;
  args.signal.throwIfAborted();
  const path = config?.connection_settings?.sentFolderPath;
  if (config?.connection_settings?.sentCopyMode !== "append" || path === undefined || path === "")
    return;
  if (!(await isMailConnectionCurrent(db, args.runtime, args.signal))) return;
  // This durable checkpoint survives a crash or a rollback of the network transaction.
  const started =
    await db.execute(sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(delivery_outcome,'{sentCopy}',
    ${JSON.stringify({ state: "started", folderPath: path })}::jsonb)
    WHERE id=${args.attempt.id} AND delivery_outcome->>'state' IN ('accepted','partial')
      AND delivery_outcome->'sentCopy' IS NULL RETURNING id`);
  args.signal.throwIfAborted();
  if (started.rows.length === 0) return;
  const result: { state: "complete" | "failed" | "unknown" } = { state: "failed" };
  let locator: { uid: number; uidValidity: string } | undefined;
  try {
    await db.transaction(async (tx) => {
      await lockMailRemoteWrites(tx, args.runtime.accountId, args.signal);
      if (!(await isMailConnectionCurrent(tx, args.runtime, args.signal))) return;
      const inspected = await args.runtime.imap.inspectFolder({ path, signal: args.signal });
      if (!inspected.ok || inspected.value.readOnly) return;
      if (!(await isMailConnectionCurrent(tx, args.runtime, args.signal))) return;
      const appended = await args.runtime.imap.appendSent({
        path,
        source: args.raw,
        signal: args.signal,
        beforeAppend: (signal) => isMailConnectionCurrent(tx, args.runtime, signal),
      });
      args.signal.throwIfAborted();
      if (!appended.ok) {
        result.state = appended.error.kind === "mutation_unknown" ? "unknown" : "failed";
        return;
      }
      result.state = "unknown";
      if (appended.value.uid === null || appended.value.uidValidity === null) return;
      if (!(await guardImapConnection(tx, args.runtime, args.signal))) return;
      locator = { uid: appended.value.uid, uidValidity: appended.value.uidValidity };
      const [folder] = (
        await tx.execute(sql`INSERT INTO mail_folders (account_id,path,uid_validity,read_only)
        VALUES (${args.runtime.accountId},${path},${locator.uidValidity},false)
        ON CONFLICT (account_id,path) DO UPDATE SET updated_at=now() RETURNING id`)
      ).rows as { id: string }[];
      if (folder === undefined) return;
      const recorded = await tx.execute(sql`INSERT INTO mail_message_locators
        (account_id,folder_id,uid_validity,uid,message_id,flags)
        VALUES (${args.runtime.accountId},${folder.id},${locator.uidValidity},${locator.uid},${args.messageId},ARRAY['\\Seen']::text[])
        ON CONFLICT (folder_id,uid_validity,uid) DO UPDATE SET message_id=EXCLUDED.message_id,active=true,last_seen_at=now()
          WHERE mail_message_locators.message_id IS NULL OR mail_message_locators.message_id=EXCLUDED.message_id RETURNING id`);
      if (recorded.rows.length !== 1) return;
      result.state = "complete";
    });
  } catch {
    args.signal.throwIfAborted();
    result.state = "unknown";
  }
  await db.execute(sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(delivery_outcome,'{sentCopy}',
    ${JSON.stringify({ state: result.state, folderPath: path, ...(result.state === "complete" ? locator : {}) })}::jsonb) WHERE id=${args.attempt.id}`);
  args.signal.throwIfAborted();
}
