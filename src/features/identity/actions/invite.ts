"use server";
import { headers } from "next/headers";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { readCookie } from "@/features/auth/better/sessionToken";
import { issueInvitation } from "@/features/auth/management/invitations";
import { dispatchAuthMail } from "@/features/auth/management/mail";
import { LOCALE_COOKIE } from "@/features/i18n/preferences";
import { inviteUserInput } from "@/features/identity/schemas";
import { createContext } from "@/server/trpc/context";
import { guardCsrf } from "./shared";
import { SIG } from "./sig";

type InviteActionResult = { ok: true; userId: string } | { ok: false; error: { id: string } };

// The legacy Users form uses the same expiring invitation and delivery lifecycle as Security admin.
export async function inviteUserAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<InviteActionResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  const parsed = inviteUserInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTH_INVITE_INPUT_INVALID } };
  const requestHeaders = await headers();
  const fresh = await resolveWorkflowSession(db, requestHeaders, SIG(), { requireFresh: true });
  if (fresh === null) return { ok: false, error: { id: ERROR_IDS.AUTH_POLICY_DENIED } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_LOGIN_REJECTED } };
  const rawLocale = readCookie(requestHeaders, LOCALE_COOKIE);
  const locale = rawLocale === "fa" || rawLocale === "de" ? rawLocale : "en";
  const result = await issueInvitation(db, actor, { ...parsed.data, locale }, SIG());
  if (!result.ok)
    return {
      ok: false,
      error: {
        id: result.error === "email_taken" ? ERROR_IDS.AUTH_EMAIL_TAKEN : ERROR_IDS.PERM_DENIED,
      },
    };
  if (env.AUTH_MAIL_TRANSPORT === "capture") await dispatchAuthMail(db, SIG());
  return { ok: true, userId: result.value.userId };
}
