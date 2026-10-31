import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authUsers, sessions, users } from "@/db/schema";
import { mintCsrfToken } from "@/features/auth/csrf";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { logoutCurrentRequest } from "./logoutCurrentRequest";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(5000);
const origin = new URL(env.BASE_URL).origin;

async function setup() {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const password = "A-strong-logout-qualification-password";
  await h.db.insert(users).values({ id: userId, email, name: "Logout qualification" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Logout qualification", emailVerified: true });
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_GOOGLE_ENABLED: false,
    AUTH_ALLOW_PASSWORD: true,
    AUTH_SECRET: "logout-test-secret-over-thirty-two-characters",
  });
  const context = await auth.$context;
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash(password),
  });
  const devices = [new AuthCookieJar(origin), new AuthCookieJar(origin)] as const;
  const csrf = mintCsrfToken();
  for (const jar of devices) {
    expect((await nativeRequest(auth, jar, "/sign-in/email", { email, password })).status).toBe(
      200,
    );
    jar.apply(new Response(null, { headers: { "set-cookie": `wd_csrf=${csrf}; Path=/` } }));
  }
  return { userId, auth, devices, csrf };
}

function request(cookie: string, csrf: string, overrides: Record<string, string> = {}) {
  return new Request(`${origin}/auth/logout`, {
    method: "POST",
    headers: { origin, cookie, "sec-fetch-site": "same-origin", ...overrides },
    body: new URLSearchParams({ csrfToken: csrf }),
  });
}

describe("POST-only current-device logout", () => {
  test("revokes the native opaque current credential while another device stays signed in", async () => {
    const {
      userId,
      auth,
      devices: [current, other],
      csrf,
    } = await setup();
    const oldHeaders = current.headers();
    const response = await logoutCurrentRequest(
      h.db,
      request(oldHeaders.get("cookie") ?? "", csrf),
      signal(),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/login`);
    const rows = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows.filter((row) => row.revokedAt !== null)).toHaveLength(1);
    expect(await resolveWorkflowSession(h.db, oldHeaders, signal())).toBeNull();
    expect((await resolveWorkflowSession(h.db, other.headers(), signal()))?.user.id).toBe(userId);
    expect(
      await (
        await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: oldHeaders }))
      ).json(),
    ).toBeNull();
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("wd_sid=;"),
        expect.stringContaining("wd_csrf=;"),
      ]),
    );
    current.apply(response);
    expect(current.headers().get("cookie")).not.toContain("wd_sid=");
  });

  test("GET is inert and rejects mutation without clearing cookies", async () => {
    const {
      userId,
      devices: [current],
    } = await setup();
    const response = await logoutCurrentRequest(
      h.db,
      new Request(`${origin}/auth/logout`, { headers: current.headers() }),
      signal(),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(
      (await h.db.select().from(sessions).where(eq(sessions.userId, userId))).every(
        (row) => row.revokedAt === null,
      ),
    ).toBe(true);
  });

  test("rejects missing/wrong origin, cross-site posts, mismatched/missing CSRF and JSON", async () => {
    const {
      userId,
      devices: [current],
      csrf,
    } = await setup();
    const cookie = current.headers().get("cookie") ?? "";
    const invalid = [
      request(cookie, csrf, { origin: "https://attacker.example.com" }),
      request(cookie, csrf, { origin: "null" }),
      request(cookie, csrf, { "sec-fetch-site": "cross-site" }),
      request(cookie, "wrong-token"),
      request(cookie, ""),
      request(cookie.replace(/wd_csrf=[^;]+;?/, ""), csrf),
      new Request(`${origin}/auth/logout`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({ csrfToken: csrf }),
      }),
    ];
    const missingOrigin = request(cookie, csrf);
    missingOrigin.headers.delete("origin");
    invalid.push(missingOrigin);
    for (const input of invalid) {
      const response = await logoutCurrentRequest(h.db, input, signal());
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
    expect(
      (await h.db.select().from(sessions).where(eq(sessions.userId, userId))).every(
        (row) => row.revokedAt === null,
      ),
    ).toBe(true);
  });

  test("row IDs, stored digests and stale cookies cannot revoke another credential", async () => {
    const {
      userId,
      devices: [current],
      csrf,
    } = await setup();
    const [row] = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
    for (const credential of [row?.id, row?.tokenHash, "malformed", ""]) {
      const response = await logoutCurrentRequest(
        h.db,
        request(`wd_sid=${credential ?? ""}.signature; wd_csrf=${csrf}`, csrf),
        signal(),
      );
      expect(response.status).toBe(303);
    }
    expect(
      (await h.db.select().from(sessions).where(eq(sessions.userId, userId))).every(
        (session) => session.revokedAt === null,
      ),
    ).toBe(true);
    expect(await resolveWorkflowSession(h.db, current.headers(), signal())).not.toBeNull();
  });
});
