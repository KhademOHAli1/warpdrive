import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import {
  authUsers,
  permissionSets,
  sessions,
  users,
  visibilityGroupMembers,
  visibilityGroups,
} from "@/db/schema";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { mintCsrfToken } from "@/features/auth/csrf";
import { makeTestDb, type TestDb } from "@/test/db";
import { createWorkRequest } from "./runtime";
import { workInstallations, workTypes } from "./schema";

let f: TestDb, userId: string, sessionId: string;
let request: ReturnType<typeof createWorkRequest>;
let cookie: string, csrf: string;
const origin = new URL(env.BASE_URL).origin;
beforeEach(async () => {
  f = await makeTestDb();
  request = createWorkRequest(f.db);
  const [user] = await f.db
    .insert(users)
    .values({ name: "HTTP admin", email: `${randomUUID()}@example.test`, isAdmin: true })
    .returning();
  userId = user!.id;
  await f.db
    .insert(authUsers)
    .values({ id: userId, name: user!.name, email: user!.email, emailVerified: true });
  const raw = randomBytes(32).toString("base64url");
  csrf = mintCsrfToken();
  cookie = `wd_sid=${raw}.signed-cookie-envelope; wd_csrf=${csrf}`;
  const [session] = await f.db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashSessionCredential(raw),
      expiresAt: new Date(Date.now() + 3600000),
      assurance: "passkey",
      authMethod: "passkey",
      freshAuthenticatedAt: new Date(),
    })
    .returning();
  sessionId = session!.id;
});
afterEach(async () => {
  await f.close();
});
const custom = () => ({
  action: "configure_type",
  requestId: randomUUID(),
  expectedRevision: 0,
  name: "HTTP custom",
  kind: "custom",
  fields: [],
  stages: [{ key: "new", name: "New", bucket: "open" }],
});
function post(body: unknown, overrides: Record<string, string> = {}) {
  return new Request(`${origin}/api/work-profile`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      host: new URL(origin).host,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": csrf,
      ...overrides,
    },
    body: JSON.stringify(body),
  });
}
describe("real work HTTP credential, CSRF, freshness and current role boundary", () => {
  it("requires real live credentials and rejects revoked sessions", async () => {
    expect(
      (await request(new Request(`${origin}/api/work-profile/overview`), ["overview"])).status,
    ).toBe(401);
    const get = () => new Request(`${origin}/api/work-profile/overview`, { headers: { cookie } });
    expect((await request(get(), ["overview"])).status).toBe(200);
    await f.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    expect((await request(get(), ["overview"])).status).toBe(401);
  });
  it("requires same-origin double-submit CSRF and strict commands before writes", async () => {
    expect((await request(post(custom(), { "x-csrf-token": "wrong" }), [])).status).toBe(403);
    expect((await request(post(custom(), { origin: "https://attacker.example" }), [])).status).toBe(
      403,
    );
    expect((await request(post({ ...custom(), permissionGrant: true }), [])).status).toBe(400);
    expect(await f.db.select().from(workTypes)).toHaveLength(0);
  });
  it("uses current role and permissions on every mutation", async () => {
    expect((await request(post(custom()), [])).status).toBe(200);
    const [set] = await f.db
      .insert(permissionSets)
      .values({ name: "Work readers", flags: { "work.view": true } })
      .returning();
    await f.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: set!.id })
      .where(eq(users.id, userId));
    expect((await request(post(custom()), [])).status).toBe(403);
    expect(await f.db.select().from(workTypes)).toHaveLength(1);
  });
  it("lists only a regular actor's current visibility groups as memberships change", async () => {
    const [set] = await f.db
      .insert(permissionSets)
      .values({ name: "Work readers", flags: { "work.view": true } })
      .returning();
    await f.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: set!.id })
      .where(eq(users.id, userId));
    const [first, second] = await f.db
      .insert(visibilityGroups)
      .values([{ name: "Design" }, { name: "Service" }, { name: "Private" }])
      .returning();
    const options = async (groups: { id: string; name: string }[]) => {
      const response = await request(
        new Request(`${origin}/api/work-profile/options`, { headers: { cookie } }),
        ["options"],
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, data: { groups } });
    };
    await options([]);
    await f.db.insert(visibilityGroupMembers).values({ userId, groupId: first!.id });
    await options([{ id: first!.id, name: first!.name }]);
    await f.db.insert(visibilityGroupMembers).values({ userId, groupId: second!.id });
    await options([
      { id: first!.id, name: first!.name },
      { id: second!.id, name: second!.name },
    ]);
  });
  it("requires fresh privileged authentication for actual preset apply", async () => {
    const body = {
      action: "preview",
      requestId: randomUUID(),
      presetId: "design",
      locale: "en",
      expectedRevision: 0,
      selection: { sales: true, delivery: true, dealFields: false, activityTypes: false },
    };
    const preview = await request(post(body), []);
    expect(preview.status).toBe(200);
    const response = await preview.json();
    await f.db
      .update(sessions)
      .set({ freshAuthenticatedAt: new Date(Date.now() - 3600000) })
      .where(eq(sessions.id, sessionId));
    const result = await request(
      post({ action: "apply", requestId: randomUUID(), preview: response.data }),
      [],
    );
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({
      ok: false,
      error: { code: "fresh_auth_required" },
    });
    expect(await f.db.select().from(workInstallations)).toHaveLength(0);
  });
});
