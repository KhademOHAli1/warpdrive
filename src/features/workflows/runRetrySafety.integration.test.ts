import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  activities,
  authPolicies,
  authUsers,
  deals,
  permissionSets,
  sessions,
  users,
  workflowRunFailures,
  workflowRuns,
  workflows,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { AUTH_SESSION_COOKIE, hashSessionCredential } from "@/features/auth/better/sessionToken";
import { advanceWorkflowRun } from "./execution";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { admitManualRun } from "./runAdmission";
import { cancelWorkflowRun } from "./runControl";
import { readRunDetail } from "./runDetail";
import { retryWorkflowRun } from "./runRetry";
import {
  failLaterTask,
  type RetryFixture,
  repairRetryPermission,
  retryFlags,
  retryInput,
  retrySignal,
  setupRetryActor,
  storedRetryRun,
} from "./runRetry.test-helpers";

it.each(["healthy", "revoked", "expired", "mfaRequired"] as const)(
  "matches public workflow policy for a %s legacy session",
  async (state) => {
    const h = await setupRetryActor();
    try {
      const f = await failLaterTask(h);
      await repairRetryPermission(h);
      const raw = randomBytes(32).toString("base64url");
      await h.db
        .update(sessions)
        .set({ authMethod: "legacy", assurance: "password", tokenHash: hashSessionCredential(raw) })
        .where(eq(sessions.id, h.session.id));
      // A real credential lookup in the public loader establishes the comparison
      // reference. This is domain qualification, not a browser login ceremony.
      const headers = new Headers({ cookie: `${AUTH_SESSION_COOKIE}=${raw}` });
      const publicSession = await resolveWorkflowSession(h.db, headers, retrySignal());
      expect(publicSession?.session.id).toBe(h.session.id);
      if (publicSession === null)
        throw new Error("Healthy legacy session rejected by public policy");
      const who = { userId: publicSession.user.id, sessionId: publicSession.session.id };
      if (state === "revoked")
        await h.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, h.session.id));
      if (state === "expired")
        await h.db
          .update(sessions)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(sessions.id, h.session.id));
      if (state === "mfaRequired")
        await h.db
          .insert(authPolicies)
          .values({ id: true, requireMfaForAll: true })
          .onConflictDoUpdate({ target: authPolicies.id, set: { requireMfaForAll: true } });
      const result = await retryWorkflowRun(
        h.db,
        who,
        retryInput(f.run.id, f.failure.id),
        retrySignal(),
      );
      if (state === "healthy") {
        expect((await resolveWorkflowSession(h.db, headers, retrySignal()))?.session.id).toBe(
          h.session.id,
        );
        expect(result).toEqual({ ok: true, value: { id: f.run.id, replayed: false } });
        await advanceWorkflowRun(h.db, f.run.id, retrySignal());
        expect((await storedRetryRun(h, f.run.id)).status).toBe("succeeded");
        expect(await h.db.select().from(activities)).toHaveLength(2);
      } else {
        expect(await resolveWorkflowSession(h.db, headers, retrySignal())).toBeNull();
        expect(result).toEqual({ ok: false, error: "E_WORKFLOW_001" });
        expect(await storedRetryRun(h, f.run.id)).toEqual(f.run);
        expect(await h.db.select().from(workflowRunFailures)).toEqual([f.failure]);
        expect(await h.db.select().from(activities)).toHaveLength(1);
      }
    } finally {
      await h.close();
    }
  },
);

it.each(["revoked", "expired", "pending", "unverified", "inactive", "permission"] as const)(
  "refuses a %s requester without changing its failure or completed effects",
  async (cause) => {
    const h = await setupRetryActor();
    try {
      const f = await failLaterTask(h);
      await repairRetryPermission(h);
      if (cause === "revoked")
        await h.db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, h.session.id));
      if (cause === "expired")
        await h.db
          .update(sessions)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(sessions.id, h.session.id));
      if (cause === "pending")
        await h.db
          .update(sessions)
          .set({ assurance: "pending" })
          .where(eq(sessions.id, h.session.id));
      if (cause === "unverified")
        await h.db
          .update(authUsers)
          .set({ emailVerified: false })
          .where(eq(authUsers.id, h.user.id));
      if (cause === "inactive")
        await h.db.update(users).set({ isActive: false }).where(eq(users.id, h.user.id));
      if (cause === "permission")
        await h.db
          .update(permissionSets)
          .set({ flags: { ...retryFlags, "workflow.run": false } })
          .where(eq(permissionSets.id, h.permissions.id));
      expect(
        await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
      ).toEqual({ ok: false, error: "E_WORKFLOW_001" });
      expect(await storedRetryRun(h, f.run.id)).toEqual(f.run);
      expect(await h.db.select().from(workflowRunFailures)).toEqual([f.failure]);
      expect(await h.db.select().from(activities)).toHaveLength(1);
    } finally {
      await h.close();
    }
  },
);

it("never permits an unrelated administrator to take over the execution actor", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    const other = await seedUser(h.db, { isAdmin: true });
    await h.db
      .insert(authUsers)
      .values({ id: other.id, email: other.email, name: other.name, emailVerified: true });
    const [session] = await h.db
      .insert(sessions)
      .values({
        userId: other.id,
        tokenHash: crypto.randomUUID(),
        authMethod: "password",
        assurance: "mfa",
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    if (session === undefined) throw new Error("Missing other actor");
    expect(
      await retryWorkflowRun(
        h.db,
        { userId: other.id, sessionId: session.id },
        retryInput(f.run.id, f.failure.id),
        retrySignal(),
      ),
    ).toEqual({ ok: false, error: "E_WORKFLOW_001" });
    expect(await storedRetryRun(h, f.run.id)).toEqual(f.run);
  } finally {
    await h.close();
  }
});

async function observeBlockedRun(h: RetryFixture) {
  await expect
    .poll(
      async () =>
        (
          await h.pool.query<{ waiting: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND lower(query) LIKE '%workflow_runs%for update%') AS waiting`,
          )
        ).rows[0]?.waiting,
      { timeout: 2500, interval: 10 },
    )
    .toBe(true);
}

it.each(["permission", "naturalExpiry"] as const)(
  "rechecks %s after an independently observed run-row wait",
  async (cause) => {
    const h = await setupRetryActor();
    const holder = await h.pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof retryWorkflowRun>>> | null = null;
    try {
      const f = await failLaterTask(h);
      await repairRetryPermission(h);
      if (cause === "naturalExpiry")
        await h.pool.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",
          [h.session.id],
        );
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM workflow_runs WHERE id=$1 FOR UPDATE", [f.run.id]);
      pending = retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal());
      await observeBlockedRun(h);
      if (cause === "permission")
        await h.db
          .update(permissionSets)
          .set({ flags: { ...retryFlags, "workflow.run": false } })
          .where(eq(permissionSets.id, h.permissions.id));
      else
        await expect
          .poll(
            async () =>
              (
                await h.pool.query<{ expired: boolean }>(
                  "SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1",
                  [h.session.id],
                )
              ).rows[0]?.expired,
            { timeout: 2500, interval: 10 },
          )
          .toBe(true);
      await holder.query("COMMIT");
      expect(await pending).toEqual({ ok: false, error: "E_WORKFLOW_001" });
      expect(await storedRetryRun(h, f.run.id)).toEqual(f.run);
      expect(await h.db.select().from(workflowRunFailures)).toEqual([f.failure]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending !== null) await pending.catch(() => undefined);
      await h.close();
    }
  },
);

it.each([
  "paused",
  "archived",
  "hiddenDeal",
  "archivedDeal",
  "corruptProgress",
  "unsupportedVersion",
] as const)("does not reactivate a %s failure", async (cause) => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h);
    await repairRetryPermission(h);
    if (cause === "paused")
      await h.db.update(workflows).set({ active: false }).where(eq(workflows.id, h.workflow.id));
    if (cause === "archived")
      await h.db
        .update(workflows)
        .set({ active: false, archivedAt: new Date() })
        .where(eq(workflows.id, h.workflow.id));
    if (cause === "hiddenDeal") {
      const other = await seedUser(h.db);
      await h.db
        .update(deals)
        .set({ ownerId: other.id, visibilityLevel: "owner" })
        .where(eq(deals.id, h.deal.id));
    }
    if (cause === "archivedDeal")
      await h.db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, h.deal.id));
    if (cause === "corruptProgress")
      await h.db
        .update(workflowRuns)
        .set({ outputs: { ...f.run.outputs, task: { id: crypto.randomUUID() } } })
        .where(eq(workflowRuns.id, f.run.id));
    if (cause === "unsupportedVersion") {
      const versionId = crypto.randomUUID();
      const definition = {
        ...h.definition,
        nodes: h.definition.nodes.map((node) =>
          node.id === "second_task" ? { ...node, version: 2 } : node,
        ),
      };
      // Seed an unsupported historical row at the real persistence boundary.
      // Published versions stay immutable; this does not claim a public bypass.
      await h.pool.query(
        "INSERT INTO workflow_versions(id,workflow_id,number,name,definition,published_by) VALUES($1,$2,2,'Unsupported stored version',$3::jsonb,$4)",
        [versionId, h.workflow.id, JSON.stringify(definition), h.user.id],
      );
      await h.db.update(workflowRuns).set({ versionId }).where(eq(workflowRuns.id, f.run.id));
    }
    const before = await storedRetryRun(h, f.run.id);
    const result = await retryWorkflowRun(
      h.db,
      h.who,
      retryInput(f.run.id, f.failure.id),
      retrySignal(),
    );
    expect(result.ok).toBe(false);
    expect(await storedRetryRun(h, f.run.id)).toEqual(before);
    expect(await h.db.select().from(workflowRunFailures)).toEqual([f.failure]);
    expect(await h.db.select().from(activities)).toHaveLength(1);
    if (cause === "unsupportedVersion")
      expect(await readRunDetail(h.db, h.actor, h.workflow.id, f.run.id, retrySignal())).toEqual({
        ok: false,
        error: "E_WORKFLOW_002",
      });
  } finally {
    await h.close();
  }
});

it.each(["queued", "cancelled", "succeeded"] as const)(
  "does not reactivate a %s run with a fresh key",
  async (status) => {
    const h = await setupRetryActor();
    try {
      const f = await failLaterTask(h);
      await repairRetryPermission(h);
      expect(
        (await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal())).ok,
      ).toBe(true);
      if (status === "cancelled") await cancelWorkflowRun(h.db, h.actor, f.run.id, retrySignal());
      if (status === "succeeded") await advanceWorkflowRun(h.db, f.run.id, retrySignal());
      const before = await storedRetryRun(h, f.run.id);
      expect(before.status).toBe(status);
      expect(
        await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
      ).toEqual({ ok: false, error: "E_WORKFLOW_003" });
      expect(await storedRetryRun(h, f.run.id)).toEqual(before);
    } finally {
      await h.close();
    }
  },
);

it("does not convert a failed simulation into a live action", async () => {
  const h = await setupRetryActor();
  try {
    const f = await failLaterTask(h, "simulation");
    await repairRetryPermission(h);
    expect(
      await retryWorkflowRun(h.db, h.who, retryInput(f.run.id, f.failure.id), retrySignal()),
    ).toEqual({ ok: false, error: "E_WORKFLOW_005" });
    expect(await h.db.select().from(activities)).toHaveLength(0);
  } finally {
    await h.close();
  }
});

it("records the original failed-wait deadline but never restarts the duration", async () => {
  const h = await setupRetryActor();
  try {
    const definition = structuredClone(h.definition);
    definition.nodes.push({
      id: "wait",
      type: "delay",
      version: 1,
      name: "Wait once",
      config: { minutes: { kind: "value", value: 1 } },
    });
    const edge = definition.edges.find((item) => item.from === "start");
    if (edge === undefined) throw new Error("Missing start edge");
    edge.to = "wait";
    definition.edges.push({ from: "wait", to: "read", port: "next" });
    const saved = await saveWorkflowDraft(
      h.db,
      h.actor,
      { id: h.workflow.id, revision: h.workflow.revision, name: "Waiting", definition },
      retrySignal(),
    );
    if (!saved.ok) throw new Error(saved.error);
    expect(
      (await publishWorkflow(h.db, h.actor, h.workflow.id, saved.value.revision, retrySignal())).ok,
    ).toBe(true);
    const admitted = await admitManualRun(
      h.db,
      h.actor,
      {
        workflowId: h.workflow.id,
        requestKey: crypto.randomUUID(),
        recordId: h.deal.id,
        mode: "live",
      },
      retrySignal(),
    );
    if (!admitted.ok) throw new Error(admitted.error);
    await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
    await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
    const waiting = await storedRetryRun(h, admitted.value.id);
    expect(waiting.status).toBe("waiting");
    await h.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.run": false } })
      .where(eq(permissionSets.id, h.permissions.id));
    await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
    await repairRetryPermission(h);
    const [failure] = await h.db
      .select()
      .from(workflowRunFailures)
      .where(eq(workflowRunFailures.runId, admitted.value.id));
    expect(failure?.originalResumeAt).toEqual(waiting.resumeAt);
    if (failure === undefined) throw new Error("Missing failure");
    const before = await storedRetryRun(h, admitted.value.id);
    expect(
      (await retryWorkflowRun(h.db, h.who, retryInput(before.id, failure.id), retrySignal())).ok,
    ).toBe(false);
    expect(await storedRetryRun(h, admitted.value.id)).toEqual(before);
    expect(await h.db.select().from(activities)).toHaveLength(0);
  } finally {
    await h.close();
  }
});
