import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AuthUser } from "@/features/permissions/types";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { resolveDraftAttachments } from "./draftAttachments";
import { findDraftCreation } from "./draftCreation";
import { assertDraftLinks, assertDraftThread } from "./draftLinks";
import { DRAFT_COLUMNS, type DraftRow, type DraftSummary, toDraftSummary } from "./draftRow";
import type { EmailVisibility } from "./threadVisibility";

export type { DraftSummary } from "./draftRow";

export interface DraftInput {
  id?: string;
  createId?: string;
  accountId: string;
  threadId?: string | null;
  subject: string;
  bodyHtml: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails?: string[];
  attachments?: { fileId: string }[];
  sendIntentId?: string;
  trackOpens?: boolean;
  trackLinks?: boolean;
  // Compose privacy in progress. Omitted defaults to "shared" (the column default) so an old draft
  // or a caller that does not set it still round-trips a valid value.
  visibility?: EmailVisibility;
  // CRM link context, so a draft written against a deal still knows its record on resume and
  // shows on that record's timeline. Undefined and null both mean "no link".
  linkDealId?: string | null;
  linkPersonId?: string | null;
}

// Composer and MCP share this boundary. A previously rendered picker or hydrated tool actor
// cannot authorize a CRM link: recheck the current actor and links in the save transaction.
export async function saveDraft(
  db: Db,
  args: { actor: AuthUser; draft: DraftInput },
  signal: AbortSignal,
): Promise<Result<{ id: string }, AppError>> {
  signal.throwIfAborted();
  const d = args.draft;
  const owned = (
    await db.execute(sql`SELECT a.id FROM email_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=${d.accountId} AND a.user_id=${args.actor.id} AND u.is_active=true AND u.invited_at IS NULL`)
  ).rows[0];
  signal.throwIfAborted();
  if (!owned || (d.id !== undefined && d.createId !== undefined))
    return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
  const creation = await findDraftCreation(db, d, signal);
  if (!creation.ok) return creation;
  const attachments =
    creation.value === null
      ? await resolveDraftAttachments(db, args.actor, d.attachments ?? [], signal)
      : ok([]);
  if (!attachments.ok) return attachments;
  // When a threadId is supplied, verify it lives on this same account BEFORE the write, so a
  // foreign/nonexistent id returns a typed error instead of letting the composite FK throw.
  const thread = creation.value === null ? await assertDraftThread(db, d, signal) : ok(null);
  if (!thread.ok) return thread;
  const to = JSON.stringify(d.toEmails);
  const cc = JSON.stringify(d.ccEmails);
  const bcc = JSON.stringify(d.bccEmails ?? []);
  const attachmentJson = JSON.stringify(attachments.value);
  const visibility = d.visibility ?? "shared";
  const dealId = d.linkDealId ?? null;
  const personId = d.linkPersonId ?? null;
  return db.transaction(
    async (tx) => {
      // Match mailbox mutations' owner-before-account lock order. Paused or disconnected
      // mailboxes still support local drafts; their remote submission authority is separate.
      const owner = (
        await tx.execute(sql`SELECT id FROM users
        WHERE id=${args.actor.id} AND is_active=true AND invited_at IS NULL FOR NO KEY UPDATE`)
      ).rows[0];
      signal.throwIfAborted();
      if (owner === undefined)
        return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
      const account = (
        await tx.execute(sql`SELECT id FROM email_accounts
        WHERE id=${d.accountId} AND user_id=${args.actor.id} FOR NO KEY UPDATE`)
      ).rows[0];
      signal.throwIfAborted();
      if (account === undefined)
        return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
      const currentActor = await hydrateActor(tx, args.actor.id, signal);
      if (currentActor === null)
        return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
      const replay = await findDraftCreation(tx, d, signal);
      if (!replay.ok) return replay;
      if (replay.value !== null) return ok(replay.value);
      // A replay that disappeared during preflight must not recreate a draft with skipped
      // attachment/thread checks, or overwrite the deletion with a partial replacement.
      if (creation.value !== null)
        return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
      const links = await assertDraftLinks(tx, currentActor, d, signal);
      if (!links.ok) return links;
      if (d.id !== undefined) {
        const row = (
          await tx.execute(sql`
        UPDATE email_drafts
        SET subject = ${d.subject}, body_html = ${d.bodyHtml},
            to_emails = ${to}::jsonb, cc_emails = ${cc}::jsonb,
            bcc_emails=${bcc}::jsonb, attachments=${attachmentJson}::jsonb,
            send_intent_id=coalesce(${d.sendIntentId ?? null}::uuid,send_intent_id),
            track_opens=${d.trackOpens ?? false},track_links=${d.trackLinks ?? false},
            thread_id = ${d.threadId ?? null}, visibility = ${visibility},
            link_deal_id = ${dealId}, link_person_id = ${personId}, updated_at = now()
        WHERE id = ${d.id} AND account_id = ${d.accountId}
        RETURNING id
      `)
        ).rows[0] as { id: string } | undefined;
        signal.throwIfAborted();
        if (row === undefined)
          return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft not found", {}));
        return ok({ id: row.id });
      }
      const inserted = (
        await tx.execute(sql`
      INSERT INTO email_drafts (id, account_id, thread_id, subject, body_html, to_emails, cc_emails,
        visibility, link_deal_id, link_person_id,bcc_emails,attachments,send_intent_id,track_opens,track_links)
      VALUES (${d.createId ?? randomUUID()}, ${d.accountId}, ${d.threadId ?? null}, ${d.subject}, ${d.bodyHtml}, ${to}::jsonb,
        ${cc}::jsonb, ${visibility}, ${dealId}, ${personId},${bcc}::jsonb,${attachmentJson}::jsonb,
        ${d.sendIntentId ?? randomUUID()},${d.trackOpens ?? false},${d.trackLinks ?? false})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `)
      ).rows[0] as { id: string } | undefined;
      signal.throwIfAborted();
      if (inserted === undefined) {
        const concurrent = await findDraftCreation(tx, d, signal);
        if (!concurrent.ok) return concurrent;
        return concurrent.value !== null
          ? ok(concurrent.value)
          : err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft unavailable"));
      }
      return ok({ id: inserted.id });
    },
    { isolationLevel: "read committed" },
  );
}

export async function listDrafts(
  db: Db,
  actor: AuthUser,
  signal: AbortSignal,
): Promise<DraftSummary[]> {
  signal.throwIfAborted();
  const rows = (
    await db.execute(sql`
      SELECT ${sql.raw(DRAFT_COLUMNS)}
      FROM email_drafts d JOIN email_accounts a ON a.id = d.account_id
      WHERE a.user_id = ${actor.id}
      ORDER BY d.updated_at DESC
    `)
  ).rows as unknown as DraftRow[];
  signal.throwIfAborted();
  return rows.map(toDraftSummary);
}

// Delete only a draft the actor owns (mailbox owner). Missing and not-owned both return
// E_GMAIL_014 so a caller cannot probe which draft ids exist.
export async function deleteDraft(
  db: Db,
  args: { actor: AuthUser; draftId: string },
  signal: AbortSignal,
): Promise<Result<{ id: string }, AppError>> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
      DELETE FROM email_drafts d
      USING email_accounts a
      WHERE d.account_id = a.id AND d.id = ${args.draftId} AND a.user_id = ${args.actor.id}
      RETURNING d.id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined)
    return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft not found", {}));
  return ok({ id: row.id });
}

// Fields an agent may revise on an existing draft. Omitted means "leave alone": the UPDATE below
// names only the columns supplied, so a composer autosave landing mid-edit is not replayed over.
export interface DraftPatch {
  subject?: string;
  bodyHtml?: string;
  toEmails?: string[];
  ccEmails?: string[];
}

// Patch a draft the actor owns (mailbox owner). Missing and not-owned both return E_GMAIL_014,
// matching deleteDraft, so a caller cannot probe which draft ids exist.
export async function patchDraft(
  db: Db,
  args: { actor: AuthUser; draftId: string; patch: DraftPatch },
  signal: AbortSignal,
): Promise<Result<{ id: string }, AppError>> {
  signal.throwIfAborted();
  const p = args.patch;
  const sets = [sql`updated_at = now()`];
  if (p.subject !== undefined) sets.push(sql`subject = ${p.subject}`);
  if (p.bodyHtml !== undefined) sets.push(sql`body_html = ${p.bodyHtml}`);
  if (p.toEmails !== undefined) sets.push(sql`to_emails = ${JSON.stringify(p.toEmails)}::jsonb`);
  if (p.ccEmails !== undefined) sets.push(sql`cc_emails = ${JSON.stringify(p.ccEmails)}::jsonb`);
  const row = (
    await db.execute(sql`
      UPDATE email_drafts d
      SET ${sql.join(sets, sql`, `)}
      FROM email_accounts a
      WHERE d.account_id = a.id AND d.id = ${args.draftId} AND a.user_id = ${args.actor.id}
      RETURNING d.id
    `)
  ).rows[0] as { id: string } | undefined;
  signal.throwIfAborted();
  if (row === undefined)
    return err(new AppError(ERROR_IDS.GMAIL_DRAFT_NOT_FOUND, "draft not found", {}));
  return ok({ id: row.id });
}
