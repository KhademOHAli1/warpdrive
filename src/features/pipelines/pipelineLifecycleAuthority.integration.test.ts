import { and, eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";
import {
  auditEvents,
  permissionSets,
  pipelines,
  sessions,
  visibilityGroupMembers,
} from "@/db/schema";
import { nativeRequest } from "@/features/auth/better/passkey.protocol.test-helpers";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import type { TestDb } from "@/test/db";
import { setPipelineArchived } from "./pipelineLifecycle";
import {
  authoritySignal,
  expectUnchangedLifecycle,
  lifecycleAuthorityFixture,
  queuedLifecycleChange,
} from "./pipelineLifecycleAuthority.test-helpers";

let h: TestDb | undefined;
afterEach(async () => {
  await h?.close();
});
async function fixture() {
  const f = await lifecycleAuthorityFixture();
  h = f.h;
  return f;
}

test("a genuinely authenticated scoped manager can execute after the real lifecycle queue unlocks", async () => {
  const f = await fixture();
  expect(f.user.isAdmin).toBe(false);
  expect(await queuedLifecycleChange(f, () => Promise.resolve())).toMatchObject({ ok: true });
  const [row] = await f.h.db.select().from(pipelines).where(eq(pipelines.id, f.input.pipelineId));
  expect(row?.isArchived).toBe(true);
  const audits = await f.h.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.targetId, f.input.pipelineId));
  expect(audits.map((entry) => entry.action)).toEqual(["pipeline.archive"]);
});

test("a queued archive cannot outlive native session revocation", async () => {
  const f = await fixture();
  const acceptedHeaders = f.jar.headers();
  const result = await queuedLifecycleChange(f, async () => {
    expect((await nativeRequest(f.auth, f.jar, "/sign-out", {})).status).toBe(200);
    expect(await resolveWorkflowSession(f.h.db, acceptedHeaders, authoritySignal())).toBeNull();
  });
  expect(result).toEqual({ ok: false, error: "fresh-auth-required" });
  await expectUnchangedLifecycle(f);
});

test("a queued archive rechecks a permission-set downgrade rather than trusting earlier rights", async () => {
  const f = await fixture();
  const result = await queuedLifecycleChange(f, async () => {
    await f.h.db
      .update(permissionSets)
      .set({ flags: {} })
      .where(eq(permissionSets.id, f.permissionSet.id));
    expect(
      await resolveWorkflowSession(f.h.db, f.jar.headers(), authoritySignal(), {
        requireFresh: true,
      }),
    ).not.toBeNull();
  });
  expect(result).toEqual({ ok: false, error: "denied" });
  await expectUnchangedLifecycle(f);
});

test("a queued scoped archive fails after its current visibility-group membership is removed", async () => {
  const f = await fixture();
  const result = await queuedLifecycleChange(f, async () => {
    await f.h.db
      .delete(visibilityGroupMembers)
      .where(
        and(
          eq(visibilityGroupMembers.groupId, f.group.id),
          eq(visibilityGroupMembers.userId, f.user.id),
        ),
      );
    expect(
      await resolveWorkflowSession(f.h.db, f.jar.headers(), authoritySignal(), {
        requireFresh: true,
      }),
    ).not.toBeNull();
  });
  expect(result).toEqual({ ok: false, error: "denied" });
  await expectUnchangedLifecycle(f);
});

test("a queued archive requires native proof that is still fresh at execution", async () => {
  const f = await fixture();
  const result = await queuedLifecycleChange(f, async () => {
    const expiredProof = new Date(Date.now() - (f.native.policy.freshMinutes + 1) * 60_000);
    await f.h.db
      .update(sessions)
      .set({ freshAuthenticatedAt: expiredProof })
      .where(eq(sessions.id, f.native.session.id));
    expect(await resolveWorkflowSession(f.h.db, f.jar.headers(), authoritySignal())).not.toBeNull();
    expect(
      await resolveWorkflowSession(f.h.db, f.jar.headers(), authoritySignal(), {
        requireFresh: true,
      }),
    ).toBeNull();
  });
  expect(result).toEqual({ ok: false, error: "fresh-auth-required" });
  await expectUnchangedLifecycle(f);
});

test.each([
  { actor: { id: "injected", type: "admin" } },
  { isAdmin: true },
  { flags: { "pipeline.manage": true } },
])("rejects client-supplied authority fields in strict command input: %j", async (injected) => {
  const f = await fixture();
  expect(
    await setPipelineArchived(
      f.h.db,
      f.jar.headers(),
      { ...f.input, ...injected },
      true,
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "failed" });
  await expectUnchangedLifecycle(f);
});
