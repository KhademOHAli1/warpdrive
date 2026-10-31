import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok } from "@/types/result";
import type {
  MailboxConnectionResult,
  MailboxConnectionView,
  SaveMailboxInput,
} from "./connections/types";
import { decryptToken, encryptToken } from "./crypto";
import { listActorMailboxes } from "./mailAccountsRepo";
import {
  hashMailboxProof,
  lockMailboxSession,
  mailboxProofEnvelopeSchema,
} from "./mailConnectionProofContext";
import {
  type CheckedMailbox,
  type MailboxActorSession,
  saveMailboxInputSchema,
} from "./mailConnectionSchemas";
import { queueMailboxSync } from "./queueMailboxSync";

interface ProofRow {
  id: string;
  payload_enc: Buffer | null;
}
interface ExistingMailbox {
  id: string;
  provider: string;
  email_address: string;
  identity_key: string | null;
  connection_generation: number;
  is_default: boolean;
}

function readProof(row: ProofRow, context: MailboxActorSession): CheckedMailbox | null {
  if (row.payload_enc === null) return null;
  const decrypted = decryptToken(row.payload_enc);
  if (!decrypted.ok) return null;
  try {
    const parsed = mailboxProofEnvelopeSchema.safeParse(JSON.parse(decrypted.value));
    if (
      !parsed.success ||
      parsed.data.actorId !== context.actorId ||
      parsed.data.sessionId !== context.sessionId
    )
      return null;
    return parsed.data.checked;
  } catch {
    return null;
  }
}

async function writeMailbox(
  tx: DbOrTx,
  context: MailboxActorSession,
  checked: CheckedMailbox,
  input: SaveMailboxInput,
  existing: ExistingMailbox | undefined,
): Promise<string | null> {
  const defaultRow = (
    await tx.execute(sql`
    SELECT id FROM email_accounts WHERE user_id=${context.actorId}
      AND is_default=true AND status<>'disconnected'
  `)
  ).rows[0];
  const isDefault = input.isDefault || existing?.is_default === true || defaultRow === undefined;
  if (isDefault)
    await tx.execute(
      sql`UPDATE email_accounts SET is_default=false WHERE user_id=${context.actorId} AND is_default=true`,
    );
  const settings = {
    imap: { ...checked.input.imap, password: undefined },
    smtp: { ...checked.input.smtp, password: undefined },
    sentCopyMode: input.sentCopyMode ?? "crm_only",
    sentFolderPath: input.sentFolderPath,
  };
  const credentials = encryptToken(JSON.stringify(checked.input));
  const values = {
    address: checked.input.emailAddress,
    name: checked.input.displayName ?? null,
    folders: [...new Set(input.folderPaths)],
  };
  const result =
    existing === undefined
      ? await tx.execute(sql`
      INSERT INTO email_accounts (user_id, email_address, provider, identity_key, display_name,
        is_default, credentials_enc, connection_settings, history_days, folder_paths, capabilities)
      VALUES (${context.actorId}, ${values.address}, 'imap_smtp', ${checked.identityKey}, ${values.name},
        ${isDefault}, ${credentials}, ${JSON.stringify(settings)}::jsonb, ${input.historyDays},
        ${JSON.stringify(values.folders)}::jsonb, ${JSON.stringify(checked.capabilities)}::jsonb)
      RETURNING id
    `)
      : await tx.execute(sql`
      UPDATE email_accounts SET credentials_enc=${credentials}, connection_settings=${JSON.stringify(settings)}::jsonb,
        history_days=${input.historyDays}, folder_paths=${JSON.stringify(values.folders)}::jsonb,
        capabilities=${JSON.stringify(checked.capabilities)}::jsonb, display_name=${values.name},
        is_default=${isDefault}, status='connected', paused=false, last_error_id=NULL,
        connection_generation=connection_generation+1, updated_at=now()
      WHERE id=${existing.id} AND user_id=${context.actorId} AND connection_generation=${checked.generation}
      RETURNING id
    `);
  const row = result.rows[0] as { id: string } | undefined;
  return row?.id ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export async function commitMailboxProof(
  db: Db,
  context: MailboxActorSession,
  raw: unknown,
  signal: AbortSignal,
  deps: { enqueueSync?: typeof queueMailboxSync } = {},
): Promise<MailboxConnectionResult<MailboxConnectionView>> {
  const parsed = saveMailboxInputSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input");
  const input = parsed.data;
  try {
    const saved = await db.transaction(async (tx): Promise<MailboxConnectionResult<string>> => {
      if (!(await lockMailboxSession(tx, context, signal))) return err("permission");
      const row = (
        await tx.execute(sql`
        SELECT id, payload_enc FROM mail_connection_checks
        WHERE token_hash=${hashMailboxProof(input.checkId)} AND user_id=${context.actorId}
          AND session_id=${context.sessionId} AND consumed_at IS NULL AND expires_at>now()
        FOR UPDATE
      `)
      ).rows[0] as ProofRow | undefined;
      const checked = row === undefined ? null : readProof(row, context);
      if (row === undefined || checked === null) return err("stale_check");
      const available = new Set(checked.folders.map((folder) => folder.path));
      if (input.folderPaths.some((path) => !available.has(path))) return err("invalid_input");
      if (
        input.sentCopyMode === "append" &&
        (input.sentFolderPath === undefined || !available.has(input.sentFolderPath))
      )
        return err("invalid_input");
      if (
        input.sentCopyMode === "append" &&
        checked.folders.some(
          (folder) => folder.path === input.sentFolderPath && folder.readOnly === true,
        )
      )
        return err("permission");
      let existing: ExistingMailbox | undefined;
      if (checked.input.accountId !== undefined) {
        existing = (
          await tx.execute(sql`
          SELECT id, provider, email_address, identity_key, connection_generation, is_default
          FROM email_accounts WHERE id=${checked.input.accountId} AND user_id=${context.actorId} FOR UPDATE
        `)
        ).rows[0] as ExistingMailbox | undefined;
        if (
          existing === undefined ||
          existing.provider !== "imap_smtp" ||
          existing.email_address.toLowerCase() !== checked.input.emailAddress.toLowerCase() ||
          existing.identity_key !== checked.identityKey ||
          existing.connection_generation !== checked.generation
        )
          return err("connection_changed");
      }
      const id = await writeMailbox(tx, context, checked, input, existing);
      if (id === null) return err("connection_changed");
      await recordSecurityEvent(
        tx,
        {
          actorId: context.actorId,
          targetUserId: context.actorId,
          action: existing === undefined ? "mailbox.connected" : "mailbox.reconnected",
          outcome: "success",
          metadata: {
            accountId: id,
            provider: "imap_smtp",
            historyDays: input.historyDays,
            folderCount: input.folderPaths.length,
          },
        },
        signal,
      );
      await tx.execute(
        sql`UPDATE mail_connection_checks SET payload_enc=NULL, consumed_at=now() WHERE id=${row.id}`,
      );
      signal.throwIfAborted();
      return ok(id);
    });
    if (!saved.ok) return saved;
    try {
      await (deps.enqueueSync ?? queueMailboxSync)(saved.value, signal);
    } catch {
      // The committed grant remains usable. The worker's recovery sweep will
      // enqueue it if this producer or its queue is temporarily unavailable.
      console.warn("[email.connection] initial sync enqueue deferred", { accountId: saved.value });
    }
    const view = (await listActorMailboxes(db, context.actorId, signal)).find(
      (row) => row.id === saved.value,
    );
    return view === undefined ? err("connection_changed") : ok(view);
  } catch (error) {
    if (isUniqueViolation(error)) return err("duplicate");
    throw error;
  }
}
