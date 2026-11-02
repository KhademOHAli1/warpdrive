import { eq } from "drizzle-orm";
import { assert, expect } from "vitest";
import { workflowRuns, workflowVersions } from "@/db/schema";
import { advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";

const signal = new AbortController().signal;

export async function setupWaitingCandidate(mode: "live" | "simulation" = "live") {
  const test = await setupWorkflowExecution();
  const definition = structuredClone(test.definition);
  definition.nodes.push({
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait one minute",
    config: { minutes: { kind: "value", value: 1 } },
  });
  definition.edges = [
    { from: "start", to: "wait", port: "next" },
    { from: "wait", to: "read", port: "next" },
    { from: "read", to: "task", port: "next" },
  ];
  // Seed an internal candidate version while public readiness remains closed.
  // These engine tests do not establish that delay publication is enabled.
  const [version] = await test.db
    .insert(workflowVersions)
    .values({
      workflowId: test.workflow.id,
      number: 2,
      name: "Waiting candidate",
      definition,
      publishedBy: test.actor.id,
    })
    .returning();
  assert(version !== undefined, "Missing candidate version");
  const [run] = await test.db
    .insert(workflowRuns)
    .values({
      workflowId: test.workflow.id,
      versionId: version.id,
      actorId: test.actor.id,
      requestKey: crypto.randomUUID(),
      mode,
      trigger: { recordId: test.deal.id },
      nextNodeId: "start",
    })
    .returning();
  assert(run !== undefined, "Missing candidate run");
  await advanceWorkflowRun(test.db, run.id, signal);
  return { ...test, run, waitingVersion: version };
}

export async function enterWait(test: Awaited<ReturnType<typeof setupWaitingCandidate>>) {
  expect(await advanceWorkflowRun(test.db, test.run.id, signal)).toEqual({
    ok: true,
    value: "waiting",
  });
  const [run] = await test.db.select().from(workflowRuns).where(eq(workflowRuns.id, test.run.id));
  expect(run?.status).toBe("waiting");
  expect(run?.nextNodeId).toBe("wait");
  expect(run?.resumeAt).toBeInstanceOf(Date);
  return run;
}

export async function makeDue(test: Awaited<ReturnType<typeof setupWaitingCandidate>>) {
  await test.pool.query(
    "UPDATE workflow_runs SET resume_at = clock_timestamp() - interval '1 second' WHERE id = $1",
    [test.run.id],
  );
}
