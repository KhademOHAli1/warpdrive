import type { AuthProviders } from "../better/contracts";

export const LAST_SIGN_IN_METHOD_COOKIE = "wd_last_signin_method";
const PREFERENCE_SECONDS = 365 * 24 * 60 * 60;
const PREFERENCE_EVENT = "warpdrive:signin-method";

export function subscribeToSignInMethod(listener: () => void): () => void {
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener("pageshow", listener);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener("pageshow", listener);
  };
}

/** A display preference only: it never authenticates a request or contains an identity. */
function normalizeSignInMethod(method: string): string {
  return method === "password" || method === "verify-totp" || method === "verify-backup-code"
    ? "email"
    : method === "verify-authentication"
      ? "passkey"
      : method;
}

export function availableSignInMethod(method: string, config: AuthProviders): string | null {
  const normalized = normalizeSignInMethod(method);
  if (normalized === "email") return config.emailPassword ? normalized : null;
  if (normalized === "passkey") return config.passkeys ? normalized : null;
  return config.providers.some((provider) => provider.id === normalized) ? normalized : null;
}

export function readLastSignInMethod(config: AuthProviders): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LAST_SIGN_IN_METHOD_COOKIE}=`));
  if (cookie === undefined) return null;
  try {
    const method = decodeURIComponent(cookie.slice(LAST_SIGN_IN_METHOD_COOKIE.length + 1));
    return method.length <= 160 ? availableSignInMethod(method, config) : null;
  } catch {
    return null;
  }
}

/** Call only after the server confirms verification and MFA/enrollment are complete. */
export function rememberSignInMethod(method: string, config?: AuthProviders): void {
  if (typeof document === "undefined") return;
  const allowed =
    config === undefined ? normalizeSignInMethod(method) : availableSignInMethod(method, config);
  if (
    allowed === null ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(allowed) ||
    allowed === "pending"
  )
    return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: host-only non-secret preference; encoded value and browser compatibility are explicit.
  document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=${encodeURIComponent(allowed)}; Path=/; Max-Age=${PREFERENCE_SECONDS}; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}
