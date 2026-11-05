import { eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import {
  activities,
  activityReminderIntents,
  activityTypes,
  notifications,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import { getActivityForEdit } from "@/features/activities/getForEdit";
import * as reminders from "@/features/activities/reminders";
import { simulateWorkflowDraft } from "./draftSimulation";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { setupWorkflowExecution } from "./execution.test-helpers";
import { createWorkflow, publishWorkflow } from "./persistence";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const title = "Calendar planning review";
const timeZone = "Europe/Berlin";
const startsOn = "2027-03-28";
const endsOn = "2027-03-29";
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
    {
      id: "event",
      type: "calendar.create",
      version: 1,
      name: "Create Calendar Event",
      config: {
        title: { kind: "value", value: title },
        startsAt: { kind: "value", literalType: "date", value: startsOn },
        endsAt: { kind: "value", literalType: "date", value: endsOn },
        allDay: true,
        timeZone,
      },
    },
  ],
  edges: [{ from: "start", to: "event", port: "next" }],
};
type Fixture = Awaited<ReturnType<typeof setupWorkflowExecution>>;

async function saveWorkflow(test: Fixture) {
  const result = await createWorkflow(
    test.db,
    test.actor,
    { name: "Calendar workflow", definition },
    signal,
  );
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

function guardExternalEffects() {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
  const reminder = vi
    .spyOn(reminders, "scheduleReminder")
    .mockRejectedValue(new Error("Unexpected reminder scheduling"));
  return { network, reminder };
}

async function expectLiveEvent(test: Fixture, eventId: string) {
  const rows = await test.db
    .select({
      id: activities.id,
      type: activityTypes.key,
      ownerId: activities.ownerId,
    })
    .from(activities)
    .innerJoin(activityTypes, eq(activityTypes.id, activities.typeId));
  expect(rows).toEqual([{ id: eventId, type: "meeting", ownerId: test.actor.id }]);
  const event = await getActivityForEdit(test.db, test.actor, eventId, signal);
  assert(event.ok, JSON.stringify(event));
  expect(event.value).toMatchObject({
    subject: title,
    allDay: true,
    dueDate: startsOn,
    endDate: endsOn,
    dueAt: "2027-03-27T23:00:00.000Z",
    endAt: "2027-03-28T22:00:00.000Z",
    durationMinutes: null,
    authoredTimeZone: timeZone,
    reminder: { status: "cancelled", selection: { kind: "none" }, fireAt: null },
    guestPersonIds: [],
    participantUserIds: [],
    videoCallUrl: null,
  });
}

async function expectNoCalendarEvent(test: Fixture) {
  expect(await test.db.select().from(activities)).toHaveLength(0);
  expect(await test.db.select().from(activityReminderIntents)).toHaveLength(0);
}

it.each(["live", "simulation"] as const)(
  "runs a published calendar step once under competing %s deliveries",
  async (mode) => {
    const test = await setupWorkflowExecution();
    const { network, reminder } = guardExternalEffects();
    try {
      const workflow = await saveWorkflow(test);
      const version = await publishWorkflow(test.db, test.actor, workflow.id, 1, signal);
      assert(version.ok, JSON.stringify(version));
      const input = {
        workflowId: workflow.id,
        recordId: test.deal.id,
        requestKey: crypto.randomUUID(),
        reviewedVersionId: version.value.id,
        mode,
      };
      const [run, replay] = await Promise.all([
        admitManualRun(test.db, test.actor, input, signal),
        admitManualRun(test.db, test.actor, input, signal),
      ]);
      assert(run.ok && replay.ok, JSON.stringify([run, replay]));
      expect(replay.value.id).toBe(run.value.id);
      assert((await advanceWorkflowRun(test.db, run.value.id, signal)).ok);
      const deliveries = await Promise.all([
        advanceWorkflowRun(test.db, run.value.id, signal),
        advanceWorkflowRun(test.db, run.value.id, signal),
      ]);
      expect(deliveries).toEqual([
        { ok: true, value: "succeeded" },
        { ok: true, value: "succeeded" },
      ]);
      const runs = await test.db.select().from(workflowRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        id: run.value.id,
        status: "succeeded",
        nextNodeId: null,
        versionId: version.value.id,
      });
      const steps = await test.db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.runId, run.value.id));
      expect(steps.map((step) => step.nodeId).sort()).toEqual(["event", "start"]);
      const eventStep = steps.find((step) => step.nodeId === "event");
      const eventId = eventStep?.output.id;
      assert(typeof eventId === "string");
      expect(eventStep).toMatchObject({
        simulated: mode === "simulation",
        output: { id: eventId },
      });
      if (mode === "live") await expectLiveEvent(test, eventId);
      else await expectNoCalendarEvent(test);
      expect(await test.db.select().from(notifications)).toHaveLength(0);
      expect(reminder).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      reminder.mockRestore();
      network.mockRestore();
      await test.close();
    }
  },
);

it("rolls back the calendar event and its metadata when testing an unpublished draft", async () => {
  const test = await setupWorkflowExecution();
  const { network, reminder } = guardExternalEffects();
  try {
    const workflow = await saveWorkflow(test);
    const result = await simulateWorkflowDraft(
      test.db,
      test.actor,
      { workflowId: workflow.id, recordId: test.deal.id, definition },
      signal,
    );
    assert(result.ok, JSON.stringify(result));
    expect(result.value).toMatchObject({
      outcome: "completed",
      steps: [
        { nodeId: "start", nodeType: "trigger.manual", status: "succeeded" },
        { nodeId: "event", nodeType: "calendar.create", status: "succeeded" },
      ],
    });
    expect(result.value.steps.at(-1)).not.toHaveProperty("output");
    await expectNoCalendarEvent(test);
    expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
    expect(await test.db.select().from(workflowSteps)).toHaveLength(0);
    expect(await test.db.select().from(notifications)).toHaveLength(0);
    expect(reminder).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    reminder.mockRestore();
    network.mockRestore();
    await test.close();
  }
});
