"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { clientErr, toClientResult } from "@/types/actionResult";
import { runImapThreadOperation } from "./imapThreadOperations";
import { listImapMoveFolders } from "./imapThreadOperationsList";
import { reconcileImapOperation } from "./imapThreadOperationsQueue";

const threadInput = z.strictObject({ threadId: z.uuid() });
const moveInput = threadInput.extend({
  destinationPath: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !/[\r\n\0]/.test(value)),
});

export async function listThreadMoveFoldersAction(csrfToken: string | null, raw: unknown) {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed"));
  const context = await createContext();
  if (context.actor === null)
    return clientErr(new AppError(ERROR_IDS.AUTH_LOGIN_REJECTED, "unauthenticated"));
  const parsed = threadInput.safeParse(raw);
  if (!parsed.success)
    return clientErr(new AppError(ERROR_IDS.GMAIL_FOLDER_INPUT_INVALID, "invalid folder input"));
  return toClientResult(
    await listImapMoveFolders(db, { actor: context.actor, threadId: parsed.data.threadId }, SIG()),
  );
}

export async function moveThreadAction(csrfToken: string | null, raw: unknown) {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed"));
  const context = await createContext();
  if (context.actor === null)
    return clientErr(new AppError(ERROR_IDS.AUTH_LOGIN_REJECTED, "unauthenticated"));
  const parsed = moveInput.safeParse(raw);
  if (!parsed.success)
    return clientErr(new AppError(ERROR_IDS.GMAIL_FOLDER_INPUT_INVALID, "invalid folder input"));
  const signal = SIG();
  const result = await runImapThreadOperation(
    db,
    {
      actor: context.actor,
      threadId: parsed.data.threadId,
      operation: { kind: "move", destinationPath: parsed.data.destinationPath },
    },
    signal,
  );
  const [account] = (
    await db.execute(sql`SELECT a.id FROM email_accounts a JOIN email_threads t ON t.account_id=a.id
    WHERE t.id=${parsed.data.threadId} AND a.user_id=${context.actor.id}`)
  ).rows;
  signal.throwIfAborted();
  if (typeof account?.id === "string") await reconcileImapOperation(account.id, signal);
  return toClientResult(result);
}
