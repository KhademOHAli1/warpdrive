import {
  unstable_doesMiddlewareMatch as doesProxyMatch,
  getRedirectUrl,
  isRewrite,
} from "next/experimental/testing/server";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest";
import { PRIVACY_CASE_PATH_HEADER } from "@/features/privacy/requestPath";
import { config, proxy } from "./proxy";

const CASE_PATH = "/settings/privacy/requests/a3c8f25e-2b78-4c12-92f7-79c97b7ed913";
const FORGED_PATH = "/settings/privacy/requests/00000000-0000-4000-8000-000000000032";
let nextResponseSpy: MockInstance<typeof NextResponse.next>;

beforeEach(() => {
  nextResponseSpy = vi.spyOn(NextResponse, "next");
});
afterEach(() => vi.restoreAllMocks());

function forwardedHeaders() {
  return nextResponseSpy.mock.calls.at(-1)?.[0]?.request?.headers;
}

test.each(["GET", "POST"])(
  "%s derives the selector from the actual path and keeps credentials upstream",
  (method) => {
    const request = new NextRequest(
      `https://app.example.test${CASE_PATH}?summary=PRIVATE-query&returnTo=https://evil.example.test`,
      {
        method,
        headers: {
          [PRIVACY_CASE_PATH_HEADER]: FORGED_PATH,
          cookie: "session=PRIVATE-cookie",
          authorization: "Bearer PRIVATE-test-token",
        },
      },
    );
    expect(doesProxyMatch({ config, nextConfig: {}, url: request.url })).toBe(true);
    const response = proxy(request);
    const forwarded = forwardedHeaders();
    expect(nextResponseSpy).toHaveBeenCalledOnce();
    expect(forwarded).toBeInstanceOf(Headers);
    expect(forwarded?.get(PRIVACY_CASE_PATH_HEADER)).toBe(CASE_PATH);
    expect(forwarded?.get("cookie")).toBe("session=PRIVATE-cookie");
    expect(forwarded?.get("authorization")).toBe("Bearer PRIVATE-test-token");
    expect(request.headers.get(PRIVACY_CASE_PATH_HEADER)).toBe(FORGED_PATH);
    expect(request.bodyUsed).toBe(false);
    expect(request.nextUrl.searchParams.get("summary")).toBe("PRIVATE-query");
    expect(response.headers.get(PRIVACY_CASE_PATH_HEADER)).toBeNull();
    expect(response.headers.get("cookie")).toBeNull();
    expect(response.headers.get("authorization")).toBeNull();
    expect(getRedirectUrl(response)).toBeNull();
    expect(isRewrite(response)).toBe(false);
  },
);

test.each([
  "/",
  "/pipeline",
  "/settings/profile",
  "/settings/privacy",
  "/login",
  "/auth/continue",
  "/apiary/page",
  "/_next/static/chunk.js",
  "/_next/image?url=PRIVATE-query",
  "/future-module/deep/path",
  "/settings/privacy/requests/not-an-id",
])("covers %s and removes a caller-supplied internal selector", (path) => {
  const request = new NextRequest(`https://app.example.test${path}`, {
    headers: { [PRIVACY_CASE_PATH_HEADER]: FORGED_PATH, cookie: "session=PRIVATE-cookie" },
  });
  expect(doesProxyMatch({ config, nextConfig: {}, url: request.url })).toBe(true);
  const response = proxy(request);
  const forwarded = forwardedHeaders();
  expect(forwarded).toBeInstanceOf(Headers);
  expect(forwarded?.has(PRIVACY_CASE_PATH_HEADER)).toBe(false);
  expect(forwarded?.get("cookie")).toBe("session=PRIVATE-cookie");
  expect(request.headers.get(PRIVACY_CASE_PATH_HEADER)).toBe(FORGED_PATH);
  expect(getRedirectUrl(response)).toBeNull();
  expect(isRewrite(response)).toBe(false);
});

// API handlers never render AppLayout. Exclude this exact namespace before Next clones bodies;
// no proxy-sanitized navigation hint is trusted on an API request.
test.each(["/api", "/api/", "/api/auth/get-session", "/api/trpc/batch", "/api/trpc/batch?batch=1"])(
  "excludes %s from the proxy body-cloning path",
  (path) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url: `https://app.example.test${path}` })).toBe(
      false,
    );
  },
);
