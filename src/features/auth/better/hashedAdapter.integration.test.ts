import { createHash } from "node:crypto";
import type { DBAdapter } from "better-auth/adapters";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { hashSessionAdapter } from "./hashedAdapter";
import {
  prepareQualificationDb,
  type QualificationSession,
  qualificationOptions,
  qualificationSessions,
  sessionData,
} from "./hashedAdapter.test-helpers";

let h: TestDb;
let fixture: Awaited<ReturnType<typeof prepareQualificationDb>>;
let adapter: DBAdapter;

const digest = (token: string) => createHash("sha256").update(token).digest("base64url");
const tokenWhere = (token: string) => [{ field: "token", value: token }];

beforeAll(async () => {
  h = await makeTestDb();
  fixture = await prepareQualificationDb(h);
  adapter = hashSessionAdapter(fixture.factory)(qualificationOptions);
});
afterAll(async () => {
  await h.close();
});

async function create(token: string) {
  return adapter.create<QualificationSession>({
    model: "session",
    data: sessionData(fixture.userId, token),
    forceAllowId: true,
  });
}

describe("hashed Better Auth session adapter on PostgreSQL", () => {
  test("rejects soft-revoked credentials when configured for the existing session model", async () => {
    const liveAdapter = hashSessionAdapter(fixture.factory, { revokedField: "revokedAt" })({
      ...qualificationOptions,
      session: {
        ...qualificationOptions.session,
        additionalFields: { revokedAt: { type: "date", required: false, input: false } },
      },
    });
    const token = "soft-revoked-token";
    const row = await liveAdapter.create<QualificationSession>({
      model: "session",
      data: sessionData(fixture.userId, token),
      forceAllowId: true,
    });
    expect(
      await liveAdapter.findOne({ model: "session", where: tokenWhere(token) }),
    ).not.toBeNull();
    await fixture.db
      .update(qualificationSessions)
      .set({ revokedAt: new Date() })
      .where(eq(qualificationSessions.id, row.id));
    expect(await liveAdapter.findOne({ model: "session", where: tokenWhere(token) })).toBeNull();
    expect(
      await liveAdapter.findOne({ model: "session", where: [{ field: "id", value: row.id }] }),
    ).toBeNull();
    expect(
      await liveAdapter.update({
        model: "session",
        where: tokenWhere(token),
        update: { userAgent: "Must not refresh" },
      }),
    ).toBeNull();
  });

  test("returns the new bearer once and stores only its digest", async () => {
    const token = "created-opaque-bearer-token";
    const created = await create(token);
    expect(created.token).toBe(token);
    const rows = await fixture.db
      .select()
      .from(qualificationSessions)
      .where(eq(qualificationSessions.id, created.id));
    expect(rows[0]?.tokenHash).toBe(digest(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("looks up the presented bearer, never a stored digest or internal id", async () => {
    const token = "lookup-opaque-bearer-token";
    const created = await create(token);
    const loaded = await adapter.findOne<QualificationSession>({
      model: "session",
      where: tokenWhere(token),
      join: { user: true },
    });
    expect(loaded?.token).toBe(token);
    expect(loaded?.id).toBe(created.id);
    expect(
      await adapter.findOne({ model: "session", where: tokenWhere(digest(token)) }),
    ).toBeNull();
    expect(await adapter.findOne({ model: "session", where: tokenWhere(created.id) })).toBeNull();
  });

  test("redacts tokens from lists and id-only reads", async () => {
    const listed = await adapter.findMany<QualificationSession>({
      model: "session",
      where: [{ field: "userId", value: fixture.userId }],
    });
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((row) => row.token === "")).toBe(true);
    const first = listed[0];
    expect(first).toBeDefined();
    const byId = await adapter.findOne<QualificationSession>({
      model: "session",
      where: [{ field: "id", value: first?.id ?? "" }],
    });
    expect(byId?.token).toBe("");
  });

  test("hashes token rotation and restores only the newly supplied token", async () => {
    const token = "old-rotation-token";
    const nextToken = "new-rotation-token";
    const created = await create(token);
    const updated = await adapter.update<QualificationSession>({
      model: "session",
      where: tokenWhere(token),
      update: { token: nextToken },
    });
    expect(updated?.token).toBe(nextToken);
    expect(await adapter.findOne({ model: "session", where: tokenWhere(token) })).toBeNull();
    const [stored] = await fixture.db
      .select()
      .from(qualificationSessions)
      .where(eq(qualificationSessions.id, created.id));
    expect(stored?.tokenHash).toBe(digest(nextToken));
    const refreshed = await adapter.update<QualificationSession>({
      model: "session",
      where: tokenWhere(nextToken),
      update: { updatedAt: new Date() },
    });
    expect(refreshed?.token).toBe(nextToken);
  });

  test("handles array lookups, counters and bulk writes/deletion without double hashing", async () => {
    const tokens = ["array-token-one", "array-token-two"];
    await Promise.all(tokens.map(create));
    const where = [{ field: "token", value: tokens, operator: "in" as const }];
    expect(await adapter.count({ model: "session", where })).toBe(2);
    const rows = await adapter.findMany<QualificationSession>({ model: "session", where });
    expect(rows.map((row) => row.token).sort()).toEqual(tokens);
    expect(
      await adapter.updateMany({ model: "session", where, update: { userAgent: "Updated" } }),
    ).toBe(2);
    await adapter.delete({ model: "session", where: tokenWhere(tokens[0] ?? "") });
    expect(await adapter.deleteMany({ model: "session", where })).toBe(1);
    expect(await adapter.count({ model: "session", where })).toBe(0);
  });

  test("wraps transaction adapters and preserves rollback", async () => {
    const token = "transaction-token";
    await adapter.transaction(async (tx) => {
      const created = await tx.create<QualificationSession>({
        model: "session",
        data: sessionData(fixture.userId, token),
        forceAllowId: true,
      });
      expect(created.token).toBe(token);
      expect(
        (await tx.findOne<QualificationSession>({ model: "session", where: tokenWhere(token) }))
          ?.token,
      ).toBe(token);
    });
    expect(
      await adapter.findOne({ model: "session", where: tokenWhere(digest(token)) }),
    ).toBeNull();
    await expect(
      adapter.transaction(async (tx) => {
        await tx.create({
          model: "session",
          data: sessionData(fixture.userId, "rolled-back"),
          forceAllowId: true,
        });
        throw new Error("rollback qualification");
      }),
    ).rejects.toThrow("rollback qualification");
    expect(
      await adapter.findOne({ model: "session", where: tokenWhere("rolled-back") }),
    ).toBeNull();
  });

  test("atomically consumes a bearer exactly once and applies guarded mutation", async () => {
    const token = "atomic-consumption-token";
    await create(token);
    const touched = await adapter.incrementOne<QualificationSession>({
      model: "session",
      where: tokenWhere(token),
      increment: {},
      set: { userAgent: "Touched" },
    });
    expect(touched?.token).toBe(token);
    const results = await Promise.all([
      adapter.consumeOne<QualificationSession>({ model: "session", where: tokenWhere(token) }),
      adapter.consumeOne<QualificationSession>({ model: "session", where: tokenWhere(token) }),
    ]);
    expect(results.filter((row) => row !== null)).toHaveLength(1);
    expect(results.find((row) => row !== null)?.token).toBe(token);
  });

  test("rejects unsupported token pattern matching", async () => {
    await expect(
      adapter.findMany({
        model: "session",
        where: [{ field: "token", value: "token", operator: "contains" }],
      }),
    ).rejects.toThrow();
  });
});
