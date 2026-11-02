import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { authUsers, users } from "@/db/schema";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { AUTH_SESSION_COOKIE } from "@/features/auth/better/sessionToken";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "./integrationPlatformFixtures";

const now = new Date("2026-10-31T12:00:00.000Z");
let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  vi.useRealTimers();
  await h.close();
});

test("native-model identities support member freshness and preserve administrator MFA enforcement", async () => {
  const result = await createIntegrationPlatformFixtures(
    h,
    { namespace: "native", now },
    AbortSignal.timeout(10_000),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const f = result.value;
  expect(await h.db.select().from(authUsers)).toHaveLength(4);
  const headers = (token: string) =>
    new Headers({ cookie: `${AUTH_SESSION_COOKIE}=${token}.synthetic-envelope` });
  const member = await resolveWorkflowSession(
    h.db,
    headers(f.sessions.member.token),
    AbortSignal.timeout(5000),
    { requireFresh: true },
  );
  expect(member?.user.id).toBe(f.users.member.id);
  expect(member?.session.authMethod).toBe("password");
  expect(
    await resolveWorkflowSession(
      h.db,
      headers(f.sessions.adminPending.token),
      AbortSignal.timeout(5000),
      { requireFresh: true },
    ),
  ).toBeNull();
  expect(
    await resolveWorkflowSession(
      h.db,
      headers(f.sessions.adminPending.token),
      AbortSignal.timeout(5000),
      { allowPending: true },
    ),
  ).not.toBeNull();
  expect(f.limits.authentication).toBe("synthetic-native-model-not-browser-enrollment");
});

test("abort cancels a blocked real write before its lock is released and rolls back partial rows", async () => {
  const blocker = await h.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    "INSERT INTO oauth_clients (id,name,redirect_uris) VALUES ('fixture:cancel:client','Blocking fixture','[]')",
  );
  const controller = new AbortController();
  const reason = new DOMException("Fixture cancelled", "AbortError");
  const outcome = createIntegrationPlatformFixtures(
    h,
    { namespace: "cancel", now },
    controller.signal,
  ).then(
    (value) => ({ kind: "result", value }),
    (error: unknown) => ({ kind: "error", error }),
  );
  try {
    const deadline = performance.now() + 3000;
    let waiting = false;
    while (!waiting && performance.now() < deadline) {
      const rows = await h.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%oauth_clients%') AS waiting",
      );
      waiting = rows.rows[0]?.waiting === true;
      if (!waiting)
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
    }
    expect(waiting).toBe(true);
    controller.abort(reason);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = await Promise.race([
        outcome,
        new Promise<{ kind: "still-waiting" }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: "still-waiting" }), 2000);
        }),
      ]);
      expect(observed).toEqual({ kind: "error", error: reason });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
    expect(await h.db.select().from(users)).toHaveLength(0);
    expect(await h.db.select().from(authUsers)).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await outcome;
  }
});
