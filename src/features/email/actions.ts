"use server";

import { sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { makeStorageClient } from "@/features/files/storage";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { type ActionResult, clientErr, toClientResult } from "@/types/actionResult";
import type { SendEmailOutcome } from "@/types/mail";
import { ok } from "@/types/result";
import { createGmailClient } from "./gmailClient";
import { makeRefresh } from "./gmailRefresh";
import { reconcileImapOperation } from "./imapThreadOperationsQueue";
import { assertMailboxOwner } from "./mailboxOwnership";
import { disconnectMailboxWithNativeSession } from "./mailConnectionMutations";
import { GMAIL_OAUTH_STATE_COOKIE } from "./oauth";
import { startGmailOAuth } from "./oauthStart";
import { sendEmail as orchestrateSend, type SendEmailInput, sendEmailInput } from "./send";
import { resolveSendConnection } from "./sendConnection";
import { readOwnedSendStatus } from "./sendStatus";
import { trashThread } from "./threadTrash";
import { ensureAccessToken } from "./tokens";

// Interactive send action. CSRF first (before any DB/actor work), then the actor from
// the trusted context (NEVER client identity), Zod-validate the input, build the real
// Gmail client, and orchestrate. Returns a discriminated Result for the caller.
export async function sendEmail(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<SendEmailOutcome>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError("E_PERM_001", "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null) return clientErr(new AppError("E_PERM_001", "unauthenticated", {}));

  const parsed = sendEmailInput.safeParse(rawInput);
  if (!parsed.success) {
    return clientErr(
      new AppError("E_GMAIL_009", "invalid send input", { issues: parsed.error.issues }),
    );
  }
  const input: SendEmailInput = parsed.data;

  const signal = AbortSignal.timeout(8000);
  // Ownership FIRST (F5): confirm the mailbox belongs to the actor before any token
  // decrypt/refresh side effect. runSend re-checks ownership (defense in depth), but a
  // non-owner must never reach ensureAccessToken and trigger refresh-token rotation.
  const owner = await assertMailboxOwner(db, input.accountId, ctx.actor.id, signal);
  if (!owner.ok) return clientErr(owner.error);
  const receipt = await readOwnedSendStatus(db, {
    accountId: input.accountId,
    actorId: ctx.actor.id,
    idempotencyKey: input.idempotencyKey,
    signal,
  });
  if (!receipt.ok) return clientErr(receipt.error);
  if (
    receipt.value?.provider === "imap_smtp" &&
    ["sent", "needs_review"].includes(receipt.value.outcome.status)
  )
    return ok(receipt.value.outcome);

  const connection = await resolveSendConnection(db, {
    accountId: input.accountId,
    actorId: ctx.actor.id,
    idempotencyKey: input.idempotencyKey,
    scheduledSendAt: input.scheduledSendAt,
    signal,
  });
  if (!connection.ok) return clientErr(connection.error);
  return toClientResult(
    await orchestrateSend(db, {
      actorId: ctx.actor.id,
      actorType: ctx.actor.type,
      actorGroupIds: ctx.actor.groupIds,
      ...connection.value,
      storage: makeStorageClient(),
      input,
      signal,
    }),
  );
}

// Reader Delete -> Gmail Trash (P4). CSRF first, then the trusted actor. Resolve the thread's
// mailbox OWNER-SCOPED before touching tokens: a non-owner must never reach ensureAccessToken (a
// refresh-token rotation side effect), same guard as sendEmail. Then build the real Gmail client
// and delegate to trashThread, which moves the Gmail conversation and stamps trashed_at on success.
export async function trashThreadAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<{ threadId: string }>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null)
    return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "unauthenticated", {}));

  const parsed = z.object({ threadId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return clientErr(
      new AppError(ERROR_IDS.GMAIL_TRASH_INPUT_INVALID, "invalid trash input", {
        issues: parsed.error.issues,
      }),
    );
  }

  const signal = SIG();
  const acct = (
    await db.execute(sql`
      SELECT a.id,a.provider FROM email_threads t JOIN email_accounts a ON a.id = t.account_id
      WHERE t.id = ${parsed.data.threadId} AND a.user_id = ${ctx.actor.id}
    `)
  ).rows[0] as { id: string; provider: string } | undefined;
  if (acct === undefined)
    return clientErr(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found", {}));

  if (acct.provider === "imap_smtp") {
    const result = await trashThread(
      db,
      { actor: ctx.actor, threadId: parsed.data.threadId },
      signal,
    );
    await reconcileImapOperation(acct.id, signal);
    return toClientResult(result);
  }
  if (acct.provider !== "gmail")
    return clientErr(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "mailbox trash unsupported"));

  const token = await ensureAccessToken(db, {
    signal,
    accountId: acct.id,
    deps: { refresh: makeRefresh(signal) },
  });
  if (!token.ok) return clientErr(token.error);

  const gmail = createGmailClient(token.value.token);
  return toClientResult(
    await trashThread(db, { actor: ctx.actor, threadId: parsed.data.threadId, gmail }, signal),
  );
}

// OAuth consent is a credential grant: native fresh authority is required even
// when this legacy action is invoked outside its usual settings screen.
export async function connectGmailStart(): Promise<{ url: string }> {
  const signal = SIG();
  const grant = await startGmailOAuth(db, await headers(), signal);
  if (!grant.ok)
    throw new AppError(
      grant.error === "fresh_auth_required"
        ? "E_AUTH_009"
        : grant.error === "permission"
          ? "E_PERM_001"
          : "E_GMAIL_006",
      "gmail consent unavailable",
      { reason: grant.error },
    );
  const jar = await cookies();
  jar.set(GMAIL_OAUTH_STATE_COOKIE, grant.value.state, {
    httpOnly: true,
    secure: new URL(env.BASE_URL).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return { url: grant.value.url };
}

const disconnectMailboxInput = z.object({ accountId: z.string().uuid() });

// Disconnect the actor's Gmail mailbox (Settings > Email sync). CSRF first (before any DB or
// actor work), then the actor from the trusted context (NEVER client identity), then Zod-parse
// the input at the boundary, then ownership (F5: a non-owner must never mutate another user's
// mailbox), then a soft disconnect (status -> disconnected, token nulled, row retained so FK'd
// mail history survives and a later reconnect reuses the same row). Never logs tokens.
export async function disconnectMailboxAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<{ disconnected: true }>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError("E_PERM_001", "csrf check failed", {}));
  const parsed = disconnectMailboxInput.safeParse(rawInput);
  if (!parsed.success)
    return clientErr(new AppError("E_GMAIL_013", "invalid disconnect input", {}));
  const result = await disconnectMailboxWithNativeSession(
    db,
    await headers(),
    parsed.data.accountId,
    SIG(),
  );
  if (!result.ok)
    return clientErr(
      new AppError(
        result.error === "fresh_auth_required" ? "E_AUTH_009" : "E_PERM_001",
        "mailbox change requires current native authority",
        {},
      ),
    );
  return ok({ disconnected: true });
}
