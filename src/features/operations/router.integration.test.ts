import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  authUsers,
  operationsInstallation,
  operationsSources,
  permissionSets,
  sessions,
  users,
} from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { hydrateActor } from "@/server/hydrateActor";
import type { AppContext } from "@/server/trpc/context";
import {
  type OperationsObservation,
  operationsFeatures,
  operationsProviders,
  operationsQueues,
} from "./contracts";
import { recordOperationsBatch } from "./repository";
import { operationsRouter } from "./router";
import { enrollOperationsSource } from "./storage";

const signal = () => AbortSignal.timeout(10_000);
async function context(db: Db): Promise<AppContext> {
  const user = await seedUser(db, { isAdmin: true });
  await db.insert(authUsers).values({
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: true,
    twoFactorEnabled: true,
  });
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      authMethod: "password",
      assurance: "mfa",
    })
    .returning({ id: sessions.id });
  if (!session) throw new Error("Missing fixture session");
  const actor = await hydrateActor(db, user.id, signal());
  if (!actor) throw new Error("Missing fixture actor");
  return { db, actor, session: { userId: user.id, sessionId: session.id } };
}

it("leaves an unconfigured installation unchecked without creating enrollment from read requests", async () => {
  await withTestDb(async (db) => {
    const caller = operationsRouter.createCaller(await context(db));
    expect((await caller.observations({})).items).toEqual([]);
    expect((await caller.sources({})).items).toEqual([]);
    expect((await caller.incidents({})).items).toEqual([]);
    expect((await caller.events({})).items).toEqual([]);
    expect(await db.select().from(operationsInstallation)).toHaveLength(0);
  });
});

it("pages exactly30 finite observations without a pg-boss aggregate or request workspace authority", async () => {
  await withTestDb(async (db) => {
    const ctx = await context(db);
    const binding = await enrollOperationsSource(db, "application_sampler", signal());
    const observations: OperationsObservation[] = [
      ...operationsFeatures.map((feature) => ({
        kind: "feature" as const,
        feature,
        state: "healthy" as const,
        reason: "ok" as const,
      })),
      ...operationsProviders.map((provider) => ({
        kind: "provider" as const,
        provider,
        state: "healthy" as const,
        reason: "ok" as const,
      })),
      ...operationsQueues.map((queue) => ({
        kind: "queue" as const,
        queue,
        state: "unknown" as const,
        reason: "not_reported" as const,
        sampledAtMs: null,
        pendingCount: null,
        activeCount: null,
        readyOldestAgeMs: null,
        lastProgressAtMs: null,
      })),
    ];
    const admitted = await recordOperationsBatch(
      db,
      binding,
      JSON.stringify({
        schemaVersion: 2,
        generationId: binding.generationId,
        sequence: 1,
        observedAtMs: Date.now(),
        observations,
      }),
      signal(),
    );
    expect(admitted.ok).toBe(true);
    const caller = operationsRouter.createCaller(ctx);
    const first = await caller.observations({});
    expect(first.items).toHaveLength(30);
    if (!first.nextCursor) throw new Error("Missing fixture next cursor");
    const second = await caller.observations({ cursor: first.nextCursor });
    expect(second.items).toHaveLength(observations.length - 30);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.observationKey)).size).toBe(
      observations.length,
    );
    expect(
      [...first.items, ...second.items]
        .filter((row) => row.observation?.kind === "queue")
        .every((row) => row.freshness.ageMs === null),
    ).toBe(true);
    await expect(caller.observations({ workspaceId: randomUUID() } as never)).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
    await expect(
      caller.events({ installationId: binding.installationId } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.events({})).items).toHaveLength(1);
    expect((await caller.sources({})).items[0]?.sourceId).toBe(binding.sourceId);
  });
});

it("rehydrates real native admin authority for every read despite cached roles and broad manage permission", async () => {
  await withTestDb(async (db) => {
    const ctx = await context(db);
    if (!ctx.actor || !ctx.session) throw new Error("Missing fixture authentication context");
    const caller = operationsRouter.createCaller(ctx);
    expect((await caller.sources({})).items).toEqual([]);
    const [permission] = await db
      .insert(permissionSets)
      .values({ name: "Manage only", flags: { "permissions.manage": true } })
      .returning({ id: permissionSets.id });
    if (!permission) throw new Error("Missing fixture permission set");
    await withCurrentAuthority(db, "write", signal(), (tx) =>
      tx
        .update(users)
        .set({ isAdmin: false, permissionSetId: permission.id })
        .where(eq(users.id, ctx.actor!.id)),
    );
    for (const read of [
      () => caller.sources({}),
      () => caller.observations({}),
      () => caller.incidents({}),
      () => caller.events({}),
    ]) {
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

it("denies inactive, revoked, expired, pending-assurance and mismatched real session contexts", async () => {
  await withTestDb(async (db) => {
    for (const kind of ["inactive", "revoked", "expired", "pending", "mismatched"] as const) {
      const ctx = await context(db);
      if (!ctx.actor || !ctx.session) throw new Error("Missing fixture authentication context");
      if (kind === "inactive")
        await db.update(users).set({ isActive: false }).where(eq(users.id, ctx.actor.id));
      if (kind === "revoked")
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, ctx.session.sessionId));
      if (kind === "expired")
        await db
          .update(sessions)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(eq(sessions.id, ctx.session.sessionId));
      if (kind === "pending")
        await db
          .update(sessions)
          .set({ assurance: "pending" })
          .where(eq(sessions.id, ctx.session.sessionId));
      if (kind === "mismatched") ctx.session = { ...ctx.session, userId: randomUUID() };
      await expect(operationsRouter.createCaller(ctx).sources({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});

it("waits for a cooperating authority downgrade and never leaks data using its earlier actor snapshot", async () => {
  await withTestDb(async (db) => {
    const ctx = await context(db);
    if (!ctx.actor) throw new Error("Missing fixture actor");
    const actorId = ctx.actor.id;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = withCurrentAuthority(db, "write", signal(), async (tx) => {
      await tx.update(users).set({ isAdmin: false }).where(eq(users.id, actorId));
      entered();
      await gate;
    });
    try {
      await started;
      const reading = operationsRouter
        .createCaller(ctx)
        .observations({})
        .then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error: error as unknown }),
        );
      await vi.waitFor(
        async () => {
          const waiting = await db.execute<{
            waiting: boolean;
          }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE a.datname=current_database() AND l.locktype='advisory' AND NOT l.granted AND l.mode='ShareLock') AS waiting`);
          expect(waiting.rows[0]?.waiting).toBe(true);
        },
        { timeout: 2000, interval: 20 },
      );
      release();
      await writing;
      const result = await reading;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: "FORBIDDEN" });
    } finally {
      release();
      await writing;
    }
  });
});

it("bounds all enrolled source rows and reuses inactive slots only through a new server generation", async () => {
  await withTestDb(async (db) => {
    const bindings = [];
    for (let index = 0; index < 16; index++)
      bindings.push(await enrollOperationsSource(db, "host_collector", signal()));
    await expect(enrollOperationsSource(db, "host_collector", signal())).rejects.toMatchObject({
      id: ERROR_IDS.INTEGRATION_STATE_INVALID,
    });
    const first = bindings[0];
    if (!first) throw new Error("Missing fixture source");
    await db
      .update(operationsSources)
      .set({ active: false })
      .where(eq(operationsSources.id, first.sourceId));
    const replacement = await enrollOperationsSource(db, "application_sampler", signal());
    expect(replacement.sourceId).toBe(first.sourceId);
    expect(replacement.generationId).not.toBe(first.generationId);
    expect(await db.select().from(operationsSources)).toHaveLength(16);
  });
});
