import { eq } from "drizzle-orm";
import { assert, expect } from "vitest";
import { workflowRuns, workflowSteps, workflowVersions } from "@/db/schema";
import {
  type PublicDurationFixture,
  publicDurationDefinition,
} from "./durationPublicAdmission.test-helpers";
import type { Binding, WorkflowDefinition } from "./schemas";

export function fixedInstantDefinition(
  until: string,
  subject: Binding = { kind: "reference", nodeId: "read", path: ["title"] },
): WorkflowDefinition {
  const definition = publicDurationDefinition(1, subject);
  const wait = definition.nodes.find((node) => node.id === "wait");
  assert(wait !== undefined, "Missing wait fixture node");
  wait.config = { until: { kind: "value", value: until, literalType: "instant" } };
  return definition;
}

export async function databaseInstant(test: PublicDurationFixture, offsetMs = 0) {
  const result = await test.pool.query<{ deadline: Date }>(
    `SELECT date_trunc('milliseconds', clock_timestamp()
      + $1::bigint * interval '1 millisecond') AS deadline`,
    [offsetMs],
  );
  const deadline = result.rows[0]?.deadline;
  assert(deadline instanceof Date && Number.isFinite(deadline.getTime()));
  return deadline;
}

export async function fixedInstantSteps(test: PublicDurationFixture, runId: string) {
  return test.db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(workflowSteps.nodeId);
}

export async function expectPinnedVersion(
  test: PublicDurationFixture,
  version: typeof workflowVersions.$inferSelect,
) {
  expect(
    await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, version.id)),
  ).toEqual([version]);
}

export async function setStoredDeadline(
  test: PublicDurationFixture,
  runId: string,
  deadline: Date,
) {
  // Model an already durable deadline relative to a changed clock. This is a
  // deliberately edited timing fixture, not an actual OS/NTP clock-change test.
  const updated = await test.db
    .update(workflowRuns)
    .set({ resumeAt: deadline })
    .where(eq(workflowRuns.id, runId))
    .returning();
  expect(updated).toHaveLength(1);
  expect(updated[0]).toMatchObject({ status: "waiting", resumeAt: deadline });
}
