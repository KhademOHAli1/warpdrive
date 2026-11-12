import { CSRF_COOKIE, validateCsrf } from "@/features/auth/csrf";
import { err, type Result } from "@/types/result";

/** Server-owned facts captured from this request, never from a serialized actor/context. */
export interface RequestCsrfFacts {
  readonly cookieToken: string | null;
  readonly origin: string | null;
  readonly host: string | null;
  readonly secFetchSite: string | null;
}

export interface RequestCookieSource {
  get(name: string): { value: string } | undefined;
}

/** Match the installed Next RequestCookies parser, without importing its request runtime. */
export function requestCookiesFromHeaders(headers: Headers): RequestCookieSource {
  const values = new Map<string, string>();
  for (const pair of (headers.get("cookie") ?? "").split(/; */)) {
    if (!pair) continue;
    const splitAt = pair.indexOf("=");
    if (splitAt === -1) {
      values.set(pair, "true");
      continue;
    }
    try {
      values.set(pair.slice(0, splitAt), decodeURIComponent(pair.slice(splitAt + 1)));
    } catch {
      // Next ignores an invalid encoded pair without replacing an earlier valid duplicate.
    }
  }
  return Object.freeze({
    get(name: string) {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
  });
}

export function readRequestCsrf(
  headers: Headers,
  cookies: RequestCookieSource = requestCookiesFromHeaders(headers),
): RequestCsrfFacts {
  return Object.freeze({
    cookieToken: cookies.get(CSRF_COOKIE)?.value ?? null,
    origin: headers.get("origin"),
    host: headers.get("host"),
    secFetchSite: headers.get("sec-fetch-site"),
  });
}

/** The supplied token remains the existing procedure input, not a new header-only API. */
export function validateRequestCsrf(
  facts: RequestCsrfFacts | undefined,
  inputToken: string | null,
): Result<true, string> {
  if (facts === undefined) return err("missing csrf request context");
  return validateCsrf({ ...facts, headerToken: inputToken });
}
