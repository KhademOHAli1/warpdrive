import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  auditEvents,
  authAccounts,
  authUsers,
  permissionSets,
  pipelines,
  visibilityGroupMembers,
  visibilityGroups,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createBetterAuth } from "@/features/auth/better/auth";
import { AuthCookieJar, nativeRequest } from "@/features/auth/better/passkey.protocol.test-helpers";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { makeTestDb, type TestDb } from "@/test/db";
import { setPipelineArchived } from "./pipelineLifecycle";

export const authoritySignal = () => AbortSignal.timeout(20_000);

export async function lifecycleAuthorityFixture() {
  const h = await makeTestDb();
  try {
    const [permissionSet] = await h.db
      .insert(permissionSets)
      .values({
        name: "Scoped pipeline management",
        flags: { "pipeline.manage": true },
      })
      .returning();
    const [group] = await h.db
      .insert(visibilityGroups)
      .values({ name: "Scoped sales" })
      .returning();
    if (permissionSet === undefined || group === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Authority fixture missing");
    const user = await seedUser(h.db, { permissionSetId: permissionSet.id, isAdmin: false });
    await h.db.insert(visibilityGroupMembers).values({ userId: user.id, groupId: group.id });
    const auth = createBetterAuth(h.db);
    await h.db
      .insert(authUsers)
      .values({ id: user.id, email: user.email, name: user.name, emailVerified: true });
    const password = "Synthetic-lifecycle-authority-password-42";
    await h.db.insert(authAccounts).values({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await (await auth.$context).password.hash(password),
    });
    const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
    expect(
      (await nativeRequest(auth, jar, "/sign-in/email", { email: user.email, password })).status,
    ).toBe(200);
    const native = await resolveWorkflowSession(h.db, jar.headers(), authoritySignal(), {
      requireFresh: true,
    });
    if (native === null)
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "Native password sign-in did not yield a fresh session",
      );
    const target = await seedPipelineWithStages(h.db, ["بررسی", "Angebot"], {
      visibilityGroupId: group.id,
    });
    await seedPipelineWithStages(h.db, ["Other active process"]);
    const input = {
      pipelineId: target.pipeline.id,
      expectedUpdatedAt: target.pipeline.updatedAt.toISOString(),
    };
    return { h, auth, jar, native, user, permissionSet, group, target, input };
  } catch (error) {
    await h.close();
    throw error;
  }
}

export type LifecycleAuthorityFixture = Awaited<ReturnType<typeof lifecycleAuthorityFixture>>;

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForLifecycleLock(h: TestDb, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await h.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%') AS waiting",
    );
    signal.throwIfAborted();
    if (result.rows[0]?.waiting === true) return true;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return false;
}

export async function queuedLifecycleChange(
  f: LifecycleAuthorityFixture,
  changeAuthority: () => Promise<void>,
) {
  const held = deferred();
  const release = deferred();
  const blocker = f.h.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('warpdrive:pipeline-lifecycle'))`);
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const command = setPipelineArchived(f.h.db, f.jar.headers(), f.input, true, authoritySignal());
  try {
    expect(await waitForLifecycleLock(f.h, authoritySignal())).toBe(true);
    await changeAuthority();
  } finally {
    release.resolve();
    await blocker;
    await command;
  }
  return command;
}

export async function expectUnchangedLifecycle(f: LifecycleAuthorityFixture): Promise<void> {
  const [row] = await f.h.db.select().from(pipelines).where(eq(pipelines.id, f.target.pipeline.id));
  expect(row?.isArchived).toBe(false);
  expect(row?.updatedAt).toEqual(f.target.pipeline.updatedAt);
  expect(
    await f.h.db.select().from(auditEvents).where(eq(auditEvents.targetId, f.target.pipeline.id)),
  ).toEqual([]);
}
