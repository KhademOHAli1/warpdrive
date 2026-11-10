import { eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import { dealChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activityReminderIntents,
  changeLogs,
  channelVersions,
  deals,
  emailDrafts,
  notifications,
  permissionSets,
  persons,
  users,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import { readRunDetail } from "./runDetail";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const updatedTitle = "Updated from workflow";
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

async function seedPerson(test: Fixture) {
  const [person] = await test.db
    .insert(persons)
    .values({ name: "Example contact", ownerId: test.user.id, visibilityLevel: "owner" })
    .returning({ id: persons.id });
  assert(person !== undefined);
  return person.id;
}

function mutationDefinition(personId: string): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "update",
        type: "record.update",
        version: 1,
        name: "Update deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
          fields: { title: { kind: "value", value: updatedTitle } },
        },
      },
      {
        id: "remove",
        type: "record.delete",
        version: 1,
        name: "Delete person",
        config: { entity: "person", recordId: { kind: "value", value: personId } },
      },
    ],
    edges: [
      { from: "start", to: "update", port: "next" },
      { from: "update", to: "remove", port: "next" },
    ],
  };
}

async function save(test: Fixture, definition: WorkflowDefinition) {
  const created = await createWorkflow(
    test.db,
    test.actor,
    { name: "Record mutations", definition },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  return created.value;
}

async function publish(test: Fixture, definition: WorkflowDefinition) {
  const workflow = await save(test, definition);
  const published = await publishWorkflow(test.db, test.actor, workflow.id, 1, signal);
  assert(published.ok, JSON.stringify(published));
  return { workflow, version: published.value };
}

async function recordState(test: Fixture, personId: string) {
  const [deal] = await test.db.select().from(deals).where(eq(deals.id, test.deal.id));
  const [person] = await test.db.select().from(persons).where(eq(persons.id, personId));
  assert(deal !== undefined && person !== undefined);
  return { deal, person };
}

async function auditState(test: Fixture) {
  const log = await test.db
    .select({
      field: changeLogs.field,
      previous: changeLogs.oldValue,
      next: changeLogs.newValue,
      actorId: changeLogs.actorId,
    })
    .from(changeLogs)
    .where(eq(changeLogs.entityId, test.deal.id));
  const [event] = await test.db
    .select({ version: channelVersions.version })
    .from(channelVersions)
    .where(eq(channelVersions.channel, dealChannel(test.deal.id)));
  return { log, version: event?.version ?? 0 };
}

async function queuedEffects(test: Fixture) {
  return {
    drafts: await test.db.select({ id: emailDrafts.id }).from(emailDrafts).orderBy(emailDrafts.id),
    notifications: await test.db
      .select({ id: notifications.id })
      .from(notifications)
      .orderBy(notifications.id),
    reminders: await test.db
      .select({ id: activityReminderIntents.activityId })
      .from(activityReminderIntents)
      .orderBy(activityReminderIntents.activityId),
  };
}

it.each(["live", "simulation"] as const)(
  "runs one native update and one soft deletion under competing %s deliveries",
  async (mode) => {
    const test = await setupWorkflowExecution();
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network"));
    try {
      const personId = await seedPerson(test);
      const { workflow, version } = await publish(test, mutationDefinition(personId));
      const before = await recordState(test, personId);
      const audit = await auditState(test);
      const effects = await queuedEffects(test);
      const input = {
        workflowId: workflow.id,
        recordId: test.deal.id,
        reviewedVersionId: version.id,
        requestKey: crypto.randomUUID(),
        mode,
      };
      const [run, duplicate] = await Promise.all([
        admitManualRun(test.db, test.actor, input, signal),
        admitManualRun(test.db, test.actor, input, signal),
      ]);
      assert(run.ok && duplicate.ok, JSON.stringify([run, duplicate]));
      expect(duplicate.value.id).toBe(run.value.id);
      assert((await advanceWorkflowRun(test.db, run.value.id, signal)).ok);
      const advances = await Promise.all(
        Array.from({ length: 3 }, () => advanceWorkflowRun(test.db, run.value.id, signal)),
      );
      expect(advances.every((advance) => advance.ok)).toBe(true);
      const [stored] = await test.db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run.value.id));
      expect(stored).toMatchObject({
        status: "succeeded",
        nextNodeId: null,
        versionId: version.id,
      });
      const steps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.value.id));
      const simulated = mode === "simulation";
      expect(steps.map((step) => step.nodeId).sort()).toEqual(["remove", "start", "update"]);
      expect(steps.find((step) => step.nodeId === "update")).toMatchObject({
        simulated,
        output: { id: test.deal.id },
      });
      expect(steps.find((step) => step.nodeId === "remove")).toMatchObject({
        simulated,
        output: { deleted: true },
      });
      const detail = await readRunDetail(test.db, test.actor, workflow.id, run.value.id, signal);
      assert(detail.ok, JSON.stringify(detail));
      const receipt = detail.value.steps.find((step) => step.nodeId === "remove");
      expect(receipt).toMatchObject({ simulated, recordDeleted: true });
      expect(receipt).not.toHaveProperty("output");

      const after = await recordState(test, personId);
      if (simulated) {
        expect(after).toEqual(before);
        expect(await auditState(test)).toEqual(audit);
      } else {
        expect(after.deal).toMatchObject({ title: updatedTitle, value: before.deal.value });
        expect(after.person).toMatchObject({
          name: before.person.name,
          deletedAt: expect.any(Date),
        });
        expect(await auditState(test)).toEqual({
          log: [
            ...audit.log,
            {
              field: "title",
              previous: before.deal.title,
              next: updatedTitle,
              actorId: test.actor.id,
            },
          ],
          version: audit.version + 1,
        });
      }
      expect(await queuedEffects(test)).toEqual(effects);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      await test.close();
    }
  },
);

it("lets later draft steps see the test update and rolls back both records and the deal event", async () => {
  const test = await setupWorkflowExecution();
  try {
    const personId = await seedPerson(test);
    const mutation = mutationDefinition(personId);
    const definition: WorkflowDefinition = {
      ...mutation,
      nodes: [
        ...mutation.nodes,
        {
          id: "read",
          type: "record.read",
          version: 1,
          name: "Read updated deal",
          config: {
            entity: "deal",
            recordId: { kind: "reference", nodeId: "update", path: ["id"] },
          },
        },
        {
          id: "match",
          type: "condition",
          version: 1,
          name: "Title was updated",
          config: {
            left: { kind: "reference", nodeId: "read", path: ["title"] },
            operator: "equals",
            right: { kind: "value", value: updatedTitle },
          },
        },
        {
          id: "unexpectedTitle",
          type: "record.read",
          version: 1,
          name: "Read unmatched deal",
          config: {
            entity: "deal",
            recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
          },
        },
      ],
      edges: [
        { from: "start", to: "update", port: "next" },
        { from: "update", to: "read", port: "next" },
        { from: "read", to: "match", port: "next" },
        { from: "match", to: "remove", port: "true" },
        { from: "match", to: "unexpectedTitle", port: "false" },
      ],
    };
    const workflow = await save(test, definition);
    const before = await recordState(test, personId);
    const audit = await auditState(test);
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      { workflowId: workflow.id, recordId: test.deal.id, definition },
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expect(result.value.outcome).toBe("completed");
    expect(result.value.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "update",
      "read",
      "match",
      "remove",
    ]);
    expect(result.value.steps.at(-1)).toMatchObject({ recordDeleted: true, status: "succeeded" });
    expect(JSON.stringify(result.value)).not.toContain(personId);
    expect(await recordState(test, personId)).toEqual(before);
    expect(await auditState(test)).toEqual(audit);
    expect(await test.db.select({ id: workflowRuns.id }).from(workflowRuns)).toHaveLength(0);
    expect(await test.db.select({ id: workflowSteps.id }).from(workflowSteps)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("enforces the native contact delete grant after a runner loses admin access", async () => {
  const test = await setupWorkflowExecution();
  try {
    const personId = await seedPerson(test);
    const { workflow } = await publish(test, mutationDefinition(personId));
    const run = await admitManualRun(
      test.db,
      test.actor,
      {
        workflowId: workflow.id,
        recordId: test.deal.id,
        requestKey: crypto.randomUUID(),
        mode: "live",
      },
      signal,
    );
    assert(run.ok, JSON.stringify(run));
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: "Mutation runner without delete",
        flags: { "workflow.run": true, "deal.edit_own": true, "contact.edit_own": true },
      })
      .returning({ id: permissionSets.id });
    assert(permissions !== undefined);
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: permissions.id })
      .where(eq(users.id, test.user.id));

    for (let step = 0; step < 3; step++)
      assert((await advanceWorkflowRun(test.db, run.value.id, signal)).ok);
    const [stored] = await test.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.value.id));
    expect(stored).toMatchObject({
      status: "failed",
      errorId: ERROR_IDS.PERM_DENIED,
      nextNodeId: "remove",
    });
    const after = await recordState(test, personId);
    expect(after.deal.title).toBe(updatedTitle);
    expect(after.person.deletedAt).toBeNull();
    const steps = await test.db
      .select({ nodeId: workflowSteps.nodeId })
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, run.value.id));
    expect(steps.map((step) => step.nodeId).sort()).toEqual(["start", "update"]);
  } finally {
    await test.close();
  }
});
