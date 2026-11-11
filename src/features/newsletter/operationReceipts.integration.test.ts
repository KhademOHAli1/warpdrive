import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import type { env as runtimeEnv } from "@/config/env";
import type { Db } from "@/db/client";
import { auditEvents, sessions, users } from "@/db/schema";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { newsletterRouter } from "./router";
import { newsletterOperationReceipts } from "./schema/operationReceipts";

vi.mock("@/config/env", async (original) => {
  const originalExports = await original<{ env: typeof runtimeEnv }>();
  return {
    ...originalExports,
    env: {
      ...originalExports.env,
      NEWSLETTER_BASE_URL: "http://newsletter-engine:9000",
      NEWSLETTER_API_USER: "synthetic-test",
      NEWSLETTER_API_TOKEN: "synthetic-test-token",
      NEWSLETTER_DELIVERY_ENABLED: true,
    },
  };
});

vi.mock("@/features/identity/actions/shared", () => ({
  guardCsrf: (token: string | null) => Promise.resolve({ ok: token === "verified-fixture" }),
}));

afterEach(() => vi.unstubAllGlobals());

const email = "synthetic-private@example.test";
const subscriberInput = {
  email,
  name: "Synthetic private name",
  status: "enabled",
  lists: [],
  attribs: '{"private":"synthetic"}',
};
const response = { id: 15, ...subscriberInput, attribs: { private: "synthetic" } };
const reply = (data: unknown): Response => Response.json({ data });
const key = () => randomUUID();

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = () => complete();
  });
  return { promise, resolve };
}

function engine(write: () => Promise<Response>, compatible = true) {
  const mocked = vi.fn(async (input: URL) => {
    if (input.pathname === "/api/warpdrive-capabilities") {
      return compatible
        ? reply({
            consent: 2,
            dispatch: 1,
            listConsentMode: 1,
            publicSubscriberUpdate: 1,
            campaignRevision: 1,
          })
        : new Response(null, { status: 404 });
    }
    if (input.pathname === "/api/subscribers") return write();
    if (input.pathname === "/api/templates/preview") return new Response("Private preview");
    throw new Error("Unexpected test provider route");
  });
  vi.stubGlobal("fetch", mocked);
  return mocked;
}

async function callerFor(db: Db) {
  const userId = key();
  const sessionId = key();
  await db.insert(users).values({
    id: userId,
    name: "Synthetic administrator",
    email: `${userId}@example.test`,
    isAdmin: true,
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: key(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const actor = await hydrateActor(db, userId, AbortSignal.timeout(5_000));
  if (actor === null) throw new Error("Synthetic administrator fixture missing");
  const ctx = { db, actor, session: { userId, sessionId } };
  return { userId, ctx, caller: newsletterRouter.createCaller(ctx) };
}

function command(operationId: string, input = subscriberInput) {
  return { operationId, operation: "subscribers.create", input, csrfToken: "verified-fixture" };
}

test("one concurrent dispatch, same-actor reload replay, canonical matching, and no stored PII", async () => {
  const testDb = await makeTestDb();
  try {
    const { db } = testDb;
    const { caller, ctx, userId } = await callerFor(db);
    const entered = deferred();
    const release = deferred();
    const write = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return reply(response);
    });
    engine(write);
    const id = key();
    const first = caller.write(command(id));
    // Attach the rejection handler immediately if a fixture or admission assertion fails.
    void first.catch(() => undefined);
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error("No provider dispatch");
        }),
      ]);
      const reloaded = newsletterRouter.createCaller(ctx);
      await expect(reloaded.receipt({ operationId: id })).resolves.toMatchObject({
        state: "admitted",
        reviewAvailable: false,
        resolution: null,
      });
      await expect(reloaded.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await first;
    }
    await expect(first).resolves.toMatchObject({ id: 15, email });
    const reloaded = newsletterRouter.createCaller(ctx);
    const reordered = {
      attribs: subscriberInput.attribs,
      lists: [],
      status: subscriberInput.status,
      name: subscriberInput.name,
      email,
    };
    await expect(reloaded.write(command(id, reordered))).resolves.toEqual({ id: 15 });
    await expect(
      reloaded.write(command(id, { ...reordered, name: "Different payload" })),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      reloaded.write({ ...command(id), operation: "lists.delete", input: { id: 15 } }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const other = await callerFor(db);
    await expect(other.caller.receipt({ operationId: id })).resolves.toBeNull();
    const [row] = await db
      .select()
      .from(newsletterOperationReceipts)
      .where(
        and(
          eq(newsletterOperationReceipts.actorId, userId),
          eq(newsletterOperationReceipts.operationId, id),
        ),
      );
    expect(row?.result).toEqual({ id: 15 });
    expect(row?.intentFingerprint).toHaveLength(32);
    expect(JSON.stringify(row)).not.toContain(email);
    expect(write).toHaveBeenCalledTimes(1);
    const logs = await db.select().from(auditEvents).where(eq(auditEvents.correlationId, id));
    expect(logs.map((item) => item.after)).toEqual(
      expect.arrayContaining([{ outcome: "requested" }, { outcome: "succeeded" }]),
    );
    expect(logs).toHaveLength(2);
  } finally {
    await testDb.close();
  }
});

test("a lost provider response stays fenced after explicit documented reconciliation", async () => {
  const testDb = await makeTestDb();
  try {
    const { caller, ctx } = await callerFor(testDb.db);
    const write = vi.fn(() =>
      Promise.reject(new Error("Synthetic transport loss after acceptance")),
    );
    engine(write);
    const id = key();
    await expect(caller.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    const reloaded = newsletterRouter.createCaller(ctx);
    await expect(reloaded.receipt({ operationId: id })).resolves.toMatchObject({
      state: "unknown",
      reviewAvailable: true,
      result: null,
    });
    await expect(reloaded.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    const review = {
      operationId: id,
      csrfToken: "verified-fixture",
      outcome: "applied" as const,
      evidenceSource: "engineRecord" as const,
      evidenceReference: "15",
    };
    await expect(
      reloaded.resolveReceipt({ ...review, evidenceReference: email }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(reloaded.resolveReceipt({ ...review, csrfToken: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const reviewed = await reloaded.resolveReceipt(review);
    expect(reviewed).toMatchObject({
      state: "unknown",
      reviewAvailable: false,
      resolution: { outcome: "applied", evidenceSource: "engineRecord", evidenceReference: "15" },
    });
    await expect(reloaded.resolveReceipt(review)).resolves.toEqual(reviewed);
    await expect(
      reloaded.resolveReceipt({ ...review, evidenceReference: "16" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const logs = await testDb.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.correlationId, id));
    expect(logs.filter((item) => item.action === "newsletter.operations.resolve")).toHaveLength(1);
    await expect(reloaded.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    await testDb.close();
  }
});

test("a known predispatch rejection remains distinct and previews retain their prior read-style response", async () => {
  const testDb = await makeTestDb();
  try {
    const { caller } = await callerFor(testDb.db);
    const write = vi.fn(() => Promise.resolve(reply(response)));
    engine(write, false);
    const id = key();
    await expect(caller.write(command(id))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.receipt({ operationId: id })).resolves.toMatchObject({
      state: "failed",
      result: null,
      reviewAvailable: false,
    });
    await expect(caller.write(command(id))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(write).not.toHaveBeenCalled();
    await expect(
      caller.write({
        operation: "subscribers.create",
        input: subscriberInput,
        csrfToken: "verified-fixture",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    engine(write);
    await expect(
      caller.write({
        operation: "templates.preview",
        input: { type: "campaign", body: "Private preview" },
        csrfToken: "verified-fixture",
      }),
    ).resolves.toBe("Private preview");
    const rows = await testDb.db.select().from(newsletterOperationReceipts);
    expect(rows).toHaveLength(1);
  } finally {
    await testDb.close();
  }
});

test("an abandoned admission remains fenced and becomes reviewable only after the in-flight window", async () => {
  const testDb = await makeTestDb();
  try {
    const { caller, userId } = await callerFor(testDb.db);
    const { newsletterIntent } = await import("./operationReceipts");
    const id = key();
    const { attribs, ...input } = subscriberInput;
    await testDb.db.insert(newsletterOperationReceipts).values(
      newsletterIntent({ actorId: userId, operationId: id }, "subscribers.create", {
        ...input,
        attribs: JSON.parse(attribs),
      }),
    );
    const write = vi.fn(() => Promise.resolve(reply(response)));
    engine(write);
    await expect(caller.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    const review = {
      operationId: id,
      csrfToken: "verified-fixture",
      outcome: "notApplied" as const,
      evidenceSource: "engineLog" as const,
      evidenceReference: "OPS-150",
    };
    await expect(caller.resolveReceipt(review)).rejects.toMatchObject({ code: "CONFLICT" });
    await testDb.db
      .update(newsletterOperationReceipts)
      .set({ createdAt: sql`clock_timestamp() - interval '2 minutes'` })
      .where(eq(newsletterOperationReceipts.operationId, id));
    await expect(caller.receipt({ operationId: id })).resolves.toMatchObject({
      reviewAvailable: true,
    });
    await expect(caller.resolveReceipt(review)).resolves.toMatchObject({ reviewAvailable: false });
    await expect(caller.write(command(id))).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(write).not.toHaveBeenCalled();
  } finally {
    await testDb.close();
  }
});
