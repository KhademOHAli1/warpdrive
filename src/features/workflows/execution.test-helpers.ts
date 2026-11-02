import { deals } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;

export async function setupWorkflowExecution() {
  const test = await makeTestDb();
  const user = await seedUser(test.db, { isAdmin: true });
  const actor = await hydrateActor(test.db, user.id, signal);
  assert(actor !== null, "missing actor");
  const pipe = await seedPipelineWithStages(test.db, ["Proposal"]);
  const stage = pipe.stages.at(0);
  assert(stage !== undefined, "missing stage");
  const [deal] = await test.db
    .insert(deals)
    .values({
      title: "Example customer",
      ownerId: user.id,
      pipelineId: pipe.pipeline.id,
      stageId: stage.id,
      visibilityLevel: "owner",
    })
    .returning();
  assert(deal !== undefined, "missing deal");
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Follow up",
        config: {
          subject: { kind: "value", value: "تماس با مشتری" },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
  const created = await createWorkflow(test.db, actor, { name: "Follow up", definition }, signal);
  assert(created.ok, "workflow creation failed");
  const published = await publishWorkflow(test.db, actor, created.value.id, 1, signal);
  assert(published.ok, "workflow publication failed");
  return {
    ...test,
    user,
    actor,
    deal,
    definition,
    workflow: created.value,
    version: published.value,
  };
}

import { assert } from "vitest";
