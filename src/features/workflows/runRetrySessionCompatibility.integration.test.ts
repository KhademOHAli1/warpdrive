import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  activities,
  authPolicies,
  authUsers,
  sessions,
  users,
  workflowRunFailures,
  workflowSteps,
} from "@/db/schema";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { loadLiveSessionByToken } from "@/features/auth/session";
import { advanceWorkflowRun } from "./execution";
import { retryWorkflowRun } from "./runRetry";
import {
  failLaterTask,
  type RetryFixture,
  repairRetryPermission,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";

const cases = [
  { profile: "legacy", state: "healthy", allowed: true },
  { profile: "legacy", state: "noAuthUser", allowed: true },
  { profile: "legacy", state: "mfaRequired", allowed: true },
  { profile: "legacy", state: "noAuthUserWithMfa", allowed: true },
  { profile: "legacy", state: "pending", allowed: true },
  { profile: "legacy", state: "idle", allowed: true },
  { profile: "legacy", state: "absolute", allowed: true },
  { profile: "legacy", state: "revoked", allowed: false },
  { profile: "legacy", state: "expired", allowed: false },
  { profile: "legacy", state: "inactive", allowed: false },
  { profile: "password", state: "healthy", allowed: true },
  { profile: "password", state: "noAuthUser", allowed: false },
  { profile: "password", state: "mfaRequired", allowed: false },
  { profile: "password", state: "idle", allowed: false },
  { profile: "password", state: "absolute", allowed: false },
] as const;
type State = (typeof cases)[number]["state"];

async function requireMfa(h: RetryFixture) {
  await h.db
    .insert(authPolicies)
    .values({ id: true, requireMfaForAll: true })
    .onConflictDoUpdate({ target: authPolicies.id, set: { requireMfaForAll: true } });
}

async function changeProfile(h: RetryFixture, state: State) {
  switch (state) {
    case "noAuthUser":
      await h.db.delete(authUsers).where(eq(authUsers.id, h.user.id));
      break;
    case "mfaRequired":
      await requireMfa(h);
      break;
    case "noAuthUserWithMfa":
      await h.db.delete(authUsers).where(eq(authUsers.id, h.user.id));
      await requireMfa(h);
      break;
    case "pending":
      await h.db
        .update(sessions)
        .set({ assurance: "pending" })
        .where(eq(sessions.id, h.session.id));
      break;
    case "idle":
      await h.db
        .update(sessions)
        .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(sessions.id, h.session.id));
      break;
    case "absolute":
      await h.db
        .update(sessions)
        .set({ createdAt: new Date(Date.now() - 169 * 3_600_000) })
        .where(eq(sessions.id, h.session.id));
      break;
    case "revoked":
      await h.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, h.session.id));
      break;
    case "expired":
      await h.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, h.session.id));
      break;
    case "inactive":
      await h.db.update(users).set({ isActive: false }).where(eq(users.id, h.user.id));
      break;
    case "healthy":
      break;
  }
}

// Native PostgreSQL credential-loader comparison, not a browser sign-in claim.
// The real createContext loader supplies the reference; the stricter publication
// resolver is a different contract and must not define routine retry eligibility.
it.each(cases)(
  "matches actual context loader for $profile / $state",
  async ({ profile, state, allowed }) => {
    const h = await setupRetryActor();
    try {
      const failure = await failLaterTask(h);
      await repairRetryPermission(h);
      const raw = randomBytes(32).toString("base64url");
      await h.db
        .update(sessions)
        .set({ authMethod: profile, assurance: "password", tokenHash: hashSessionCredential(raw) })
        .where(eq(sessions.id, h.session.id));
      const initial = await loadLiveSessionByToken(h.db, raw, retrySignal());
      expect(initial).toEqual({ ok: true, value: h.who });
      if (!initial.ok) throw new Error("Initial public credential lookup failed");
      await changeProfile(h, state);
      const current = await loadLiveSessionByToken(h.db, raw, retrySignal());
      expect(current.ok).toBe(allowed);
      const who = current.ok ? current.value : initial.value;
      const beforeEffects = await h.db.select().from(activities);
      const beforeSession = await h.db.select().from(sessions).where(eq(sessions.id, h.session.id));
      const input = retryInput(failure.run.id, failure.failure.id);
      const result = await retryWorkflowRun(h.db, who, input, retrySignal());
      expect(await h.db.select().from(sessions).where(eq(sessions.id, h.session.id))).toEqual(
        beforeSession,
      );
      expect(
        await h.db
          .select()
          .from(workflowSteps)
          .where(eq(workflowSteps.runId, failure.run.id))
          .orderBy(workflowSteps.id),
      ).toEqual(failure.beforeSteps);
      expect(await h.db.select().from(activities)).toEqual(beforeEffects);
      if (!allowed) {
        expect(result).toEqual({ ok: false, error: "E_WORKFLOW_001" });
        expect(await storedRetryRun(h, failure.run.id)).toEqual(failure.run);
        expect(await h.db.select().from(workflowRunFailures)).toEqual([failure.failure]);
        return;
      }
      expect(result).toEqual({ ok: true, value: { id: failure.run.id, replayed: false } });
      const queued = await storedRetryRun(h, failure.run.id);
      expect(queued).toMatchObject({
        id: failure.run.id,
        actorId: failure.run.actorId,
        versionId: failure.run.versionId,
        requestKey: failure.run.requestKey,
        nextNodeId: failure.run.nextNodeId,
        outputs: failure.run.outputs,
        status: "queued",
        errorId: null,
      });
      await advanceWorkflowRun(h.db, failure.run.id, retrySignal());
      expect((await storedRetryRun(h, failure.run.id)).status).toBe("succeeded");
      const completed = await h.db.select().from(activities);
      expect(completed).toHaveLength(2);
      for (const effect of beforeEffects) expect(completed).toContainEqual(effect);
      expect(await retryWorkflowRun(h.db, who, input, retrySignal())).toEqual({
        ok: true,
        value: { id: failure.run.id, replayed: true },
      });
      expect(await h.db.select().from(activities)).toEqual(completed);
    } finally {
      await h.close();
    }
  },
);
