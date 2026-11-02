import { and, eq, isNull } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  activityTypes,
  authUsers,
  deals,
  permissionSets,
  sessions,
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { initialDefinition } from "./editorModel";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { createWorkflow, publishWorkflow } from "./persistence";

export const retryFlags = {
  "workflow.view": true,
  "workflow.create": true,
  "workflow.edit": true,
  "workflow.publish": true,
  "workflow.run": true,
  "workflow.cancel": true,
  "activity.create": true,
};
export const retrySignal = () => AbortSignal.timeout(10_000);

// Native-domain fixture only. It seeds a native session row/internal reference;
// actual cookie authentication, browser CSRF and publication are separate tests.
export async function setupRetryActor(existing?: TestDb) {
  const h = existing ?? (await makeTestDb());
  try {
    const [set] = await h.db
      .insert(permissionSets)
      .values({ name: "Retry actor", flags: retryFlags })
      .returning();
    if (set === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing permission set");
    const user = await seedUser(h.db, { isAdmin: false, permissionSetId: set.id });
    await h.db
      .insert(authUsers)
      .values({ id: user.id, email: user.email, name: user.name, emailVerified: true });
    const [session] = await h.db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: crypto.randomUUID(),
        authMethod: "password",
        assurance: "password",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    const actor = await hydrateActor(h.db, user.id, retrySignal());
    if (session === undefined || actor === null)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native domain fixture");
    const pipeline = await seedPipelineWithStages(h.db, ["Follow-up"]);
    const stage = pipeline.stages[0];
    if (stage === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing stage");
    const [deal] = await h.db
      .insert(deals)
      .values({
        title: "Retry customer's deal",
        ownerId: user.id,
        pipelineId: pipeline.pipeline.id,
        stageId: stage.id,
        visibilityLevel: "owner",
      })
      .returning();
    if (deal === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing deal");
    const definition = initialDefinition({
      start: "Start",
      read: "Read deal",
      task: "Earlier task",
      subject: "Earlier completed task",
    });
    const task = definition.nodes.find((node) => node.id === "task");
    if (task === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing first task");
    definition.nodes.push({
      ...structuredClone(task),
      id: "second_task",
      name: "Recover later task",
      config: { ...task.config, subject: { kind: "value", value: "Recovered later task" } },
    });
    definition.edges.push({ from: "task", to: "second_task", port: "next" });
    const created = await createWorkflow(
      h.db,
      actor,
      { name: "Retry follow-up", definition },
      retrySignal(),
    );
    if (!created.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, created.error);
    const version = await publishWorkflow(
      h.db,
      actor,
      created.value.id,
      created.value.revision,
      retrySignal(),
    );
    if (!version.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, version.error);
    return {
      ...h,
      actor,
      user,
      deal,
      definition,
      workflow: created.value,
      version: version.value,
      permissions: set,
      session,
      who: { userId: user.id, sessionId: session.id },
    };
  } catch (error) {
    await h.close();
    throw error;
  }
}

export type RetryFixture = Awaited<ReturnType<typeof setupRetryActor>>;

export async function storedRetryRun(h: RetryFixture, id: string) {
  const [run] = await h.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  if (run === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Run missing");
  return run;
}

export async function failLaterTask(h: RetryFixture, mode: "live" | "simulation" = "live") {
  await h.db
    .update(permissionSets)
    .set({ flags: retryFlags })
    .where(eq(permissionSets.id, h.permissions.id));
  const admitted = await admitManualRun(
    h.db,
    h.actor,
    { workflowId: h.workflow.id, requestKey: crypto.randomUUID(), recordId: h.deal.id, mode },
    retrySignal(),
  );
  if (!admitted.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, admitted.error);
  for (let n = 0; n < 3; n++) await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
  await h.db
    .update(permissionSets)
    .set({ flags: { ...retryFlags, "activity.create": false } })
    .where(eq(permissionSets.id, h.permissions.id));
  await advanceWorkflowRun(h.db, admitted.value.id, retrySignal());
  const [failure] = await h.db
    .select()
    .from(workflowRunFailures)
    .where(
      and(eq(workflowRunFailures.runId, admitted.value.id), isNull(workflowRunFailures.retriedAt)),
    );
  if (failure === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Failure generation missing");
  return {
    run: await storedRetryRun(h, admitted.value.id),
    failure,
    beforeSteps: await h.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, admitted.value.id))
      .orderBy(workflowSteps.id),
  };
}

export async function repairRetryPermission(h: RetryFixture) {
  await h.db
    .update(permissionSets)
    .set({ flags: retryFlags })
    .where(eq(permissionSets.id, h.permissions.id));
}

export function retryInput(runId: string, failureId: string, requestKey = crypto.randomUUID()) {
  return { runId, failureId, requestKey };
}

export async function activeTaskType(h: RetryFixture) {
  const [type] = await h.db
    .select()
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)));
  if (type === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Task type missing");
  return type;
}
