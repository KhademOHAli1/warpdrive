import { z } from "zod";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { readCookie } from "@/features/auth/better/sessionToken";
import { exchangeAndBind, GMAIL_OAUTH_STATE_COOKIE } from "./oauth";
import {
  consumeGmailOAuthState,
  type GmailOAuthError,
  resolveGmailOAuthSession,
} from "./oauthState";

const querySchema = z.strictObject({
  code: z.string().min(1).max(4096),
  state: z.string().regex(/^[a-f0-9]{64}$/),
});
type ProviderDeps = Parameters<typeof exchangeAndBind>[0]["deps"];
export interface GmailCallbackDependencies {
  exchangeCode: (
    code: string,
    verifier: string,
    signal: AbortSignal,
  ) => ReturnType<ProviderDeps["exchangeCode"]>;
  fetchIdentity: ProviderDeps["fetchIdentity"];
  enqueue?: (accountId: string) => Promise<void>;
}
function redirect(status: "ok" | "error", reason?: GmailOAuthError): Response {
  const target = new URL("/inbox", env.BASE_URL);
  target.searchParams.set("connect", status);
  if (reason !== undefined) target.searchParams.set("reason", reason);
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": `${GMAIL_OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(env.BASE_URL).protocol === "https:" ? "; Secure" : ""}`,
    },
  });
}

export function createGmailOAuthCallback(db: Db, deps: GmailCallbackDependencies) {
  return async (request: Request): Promise<Response> => {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    try {
      const native = await resolveGmailOAuthSession(db, request.headers, signal);
      if (!native.ok) return redirect("error", native.error);
      const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!query.success) return redirect("error", "stale_state");
      const context = { actorId: native.value.user.id, sessionId: native.value.session.id };
      const state = await consumeGmailOAuthState(
        db,
        context,
        query.data.state,
        readCookie(request.headers, GMAIL_OAUTH_STATE_COOKIE) ?? undefined,
        signal,
      );
      if (!state.ok) return redirect("error", state.error);
      const result = await exchangeAndBind({
        db,
        signal,
        code: query.data.code,
        sessionUserId: context.actorId,
        sessionId: context.sessionId,
        sessionEmail: native.value.user.email,
        deps: {
          exchangeCode: (code, requestSignal) =>
            deps.exchangeCode(code, state.value.verifier, requestSignal),
          fetchIdentity: deps.fetchIdentity,
        },
      });
      if (!result.ok)
        return redirect(
          "error",
          result.error.id === "E_AUTH_009"
            ? "fresh_auth_required"
            : result.error.context?.reason === "revocation_pending"
              ? "revocation_pending"
              : "error",
        );
      if (deps.enqueue !== undefined) {
        try {
          await deps.enqueue(result.value.accountId);
        } catch {
          console.error("[gmail/oauth/callback] initial sync enqueue unavailable");
        }
      }
      return redirect("ok");
    } catch {
      request.signal.throwIfAborted();
      // Neither exception details nor OAuth secrets enter logs or return URLs.
      console.error("[gmail/oauth/callback] authorization unavailable");
      return redirect("error", "error");
    }
  };
}
