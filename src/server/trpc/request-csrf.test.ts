import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { CSRF_COOKIE, mintCsrfToken, validateCsrf } from "@/features/auth/csrf";
import {
  type RequestCsrfFacts,
  readRequestCsrf,
  requestCookiesFromHeaders,
  validateRequestCsrf,
} from "./request-csrf";

const origin = new URL(env.BASE_URL).origin;
const host = new URL(env.BASE_URL).host;

function headersFor(token: string): Headers {
  return new Headers({
    cookie: `other=unrelated; ${CSRF_COOKIE}=${token}; trailing=value`,
    origin,
    host,
    "sec-fetch-site": "same-origin",
  });
}

describe("request-bound CSRF", () => {
  test("uses the real cookie plus existing procedure token and request metadata", () => {
    const token = mintCsrfToken();
    expect(validateRequestCsrf(readRequestCsrf(headersFor(token)), token)).toEqual({
      ok: true,
      value: true,
    });
  });

  test("missing request facts fail closed even with a token", () => {
    expect(validateRequestCsrf(undefined, mintCsrfToken())).toEqual({
      ok: false,
      error: "missing csrf request context",
    });
  });

  test("an HTTP CSRF header cannot substitute for the existing payload token", () => {
    const token = mintCsrfToken();
    const headers = headersFor(token);
    headers.set("x-csrf-token", token);
    expect(validateRequestCsrf(readRequestCsrf(headers), null).ok).toBe(false);
  });

  test("missing or mismatched cookie and input tokens are rejected", () => {
    const token = mintCsrfToken();
    const headers = headersFor(token);
    expect(validateRequestCsrf(readRequestCsrf(headers), mintCsrfToken()).ok).toBe(false);
    expect(validateRequestCsrf(readRequestCsrf(headers), token.slice(1)).ok).toBe(false);
    headers.delete("cookie");
    expect(validateRequestCsrf(readRequestCsrf(headers), token).ok).toBe(false);
  });

  test("captures independent request facts before the Headers object can change", () => {
    const token = mintCsrfToken();
    const headers = headersFor(token);
    const first = readRequestCsrf(headers);
    headers.set("cookie", `${CSRF_COOKIE}=${mintCsrfToken()}`);
    headers.set("origin", "https://different.example");
    const second = readRequestCsrf(headers);
    expect(validateRequestCsrf(first, token).ok).toBe(true);
    expect(validateRequestCsrf(second, token).ok).toBe(false);
  });

  test("keeps the existing origin/site/token decisions without a transport exception", () => {
    const token = mintCsrfToken();
    const original = readRequestCsrf(headersFor(token));
    const facts: RequestCsrfFacts[] = [
      original,
      { ...original, origin: null, secFetchSite: null },
      { ...original, cookieToken: null },
      { ...original, origin: "https://different.example" },
      { ...original, origin: "malformed-origin" },
      { ...original, secFetchSite: "cross-site" },
      { ...original, origin: "http://localhost:3001", host: "localhost:3001" },
      {
        ...original,
        origin: "http://localhost:1234",
        host: "localhost:3001",
        secFetchSite: "same-site",
      },
      { ...original, origin: "http://localhost:3001", host: null },
    ];
    for (const request of facts) {
      expect(validateRequestCsrf(request, token)).toEqual(
        validateCsrf({ ...request, headerToken: token }),
      );
    }
  });

  test("enforces public origin, Fetch-Site and the existing strict dev-port rule", () => {
    const token = mintCsrfToken();
    const facts = readRequestCsrf(headersFor(token));
    expect(validateRequestCsrf({ ...facts, origin: "https://different.example" }, token).ok).toBe(
      false,
    );
    expect(validateRequestCsrf({ ...facts, secFetchSite: "cross-site" }, token).ok).toBe(false);
    expect(
      validateRequestCsrf(
        { ...facts, origin: "http://localhost:3001", host: "localhost:3001" },
        token,
      ).ok,
    ).toBe(true);
    expect(
      validateRequestCsrf(
        {
          ...facts,
          origin: "http://localhost:1234",
          host: "localhost:3001",
          secFetchSite: "same-site",
        },
        token,
      ).ok,
    ).toBe(false);
  });
});

describe("framework-neutral request cookies", () => {
  test("matches the installed Next cookie reader on duplicate, encoded and malformed input", () => {
    const inputs = [
      "",
      "wd_sid=first; wd_sid=second%2Esignature; time_zone=Europe%2FBerlin",
      "wd_sid=first; wd_sid=%E0%A4%A; invalid=%; wd_csrf=token",
      "bare; empty=; WD_SID=upper; spaced =value;\twd_sid=tabbed",
    ];
    const names = [
      "wd_sid",
      "wd_csrf",
      "time_zone",
      "invalid",
      "bare",
      "empty",
      "WD_SID",
      "spaced ",
      "\twd_sid",
    ];
    for (const input of inputs) {
      const headers = new Headers({ cookie: input });
      const current = new RequestCookies(headers);
      const portable = requestCookiesFromHeaders(headers);
      for (const name of names) {
        const cookie = current.get(name);
        expect(portable.get(name)).toEqual(
          cookie === undefined ? undefined : { value: cookie.value },
        );
      }
    }
  });

  test("uses the last valid duplicate and percent-decodes its value", () => {
    const cookies = requestCookiesFromHeaders(
      new Headers({ cookie: "wd_sid=first; wd_sid=second%2Esignature; time_zone=Europe%2FBerlin" }),
    );
    expect(cookies.get("wd_sid")).toEqual({ value: "second.signature" });
    expect(cookies.get("time_zone")).toEqual({ value: "Europe/Berlin" });
    expect(cookies.get("missing")).toBeUndefined();
  });

  test("ignores malformed encoded pairs while retaining an earlier valid duplicate", () => {
    const cookies = requestCookiesFromHeaders(
      new Headers({ cookie: "wd_sid=first; wd_sid=%E0%A4%A; invalid=%; after=valid" }),
    );
    expect(cookies.get("wd_sid")).toEqual({ value: "first" });
    expect(cookies.get("invalid")).toBeUndefined();
    expect(cookies.get("after")).toEqual({ value: "valid" });
  });

  test("retains Next key spelling, bare pairs and semicolon-space behavior", () => {
    const cookies = requestCookiesFromHeaders(
      new Headers({ cookie: "bare; empty=; WD_SID=upper; spaced =value;\twd_sid=tabbed" }),
    );
    expect(cookies.get("bare")).toEqual({ value: "true" });
    expect(cookies.get("empty")).toEqual({ value: "" });
    expect(cookies.get("WD_SID")).toEqual({ value: "upper" });
    expect(cookies.get("spaced ")).toEqual({ value: "value" });
    expect(cookies.get("wd_sid")).toBeUndefined();
    expect(cookies.get("\twd_sid")).toEqual({ value: "tabbed" });
  });

  test("captures cookie values independently of later header and returned-object mutations", () => {
    const headers = new Headers({ cookie: "wd_sid=first" });
    const cookies = requestCookiesFromHeaders(headers);
    headers.set("cookie", "wd_sid=second");
    const first = cookies.get("wd_sid");
    if (first !== undefined) first.value = "changed";
    expect(cookies.get("wd_sid")).toEqual({ value: "first" });
    expect(requestCookiesFromHeaders(headers).get("wd_sid")).toEqual({ value: "second" });
  });

  test("a Next cookie reader supplies the same decoded CSRF value without reparsing it", () => {
    const headers = headersFor("wire-value");
    const facts = readRequestCsrf(headers, {
      get: (name) => (name === CSRF_COOKIE ? { value: "request-cookie-value" } : undefined),
    });
    expect(validateRequestCsrf(facts, "request-cookie-value").ok).toBe(true);
    expect(validateRequestCsrf(facts, "wire-value").ok).toBe(false);
  });
});
