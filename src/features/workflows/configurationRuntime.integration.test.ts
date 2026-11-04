import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  activities,
  customFieldDefs,
  deals,
  organizations,
  persons,
  users,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { listDefs } from "@/features/custom-fields/defsRepo";
import { admitManualRun, advanceWorkflowRun } from "./execution";
import { publishWorkflow, saveWorkflowDraft } from "./persistence";
import { setupRetryActor } from "./runRetry.test-helpers";

const signal = new AbortController().signal;
type Fixture = Awaited<ReturnType<typeof setupRuntime>>;

async function setupRuntime() {
  const test = await setupRetryActor();
  try {
    const [person] = await test.db
      .insert(persons)
      .values({ name: "Visible custom person", ownerId: test.actor.id, visibilityLevel: "owner" })
      .returning();
    const [org] = await test.db
      .insert(organizations)
      .values({
        name: "Visible custom organization",
        ownerId: test.actor.id,
        visibilityLevel: "owner",
      })
      .returning();
    assert(person !== undefined && org !== undefined);
    const examples = [
      ["text", "Follow-up"],
      ["autocomplete", "Suggestion"],
      ["large_text", "Long follow-up note"],
      ["phone", "+49 30 123456"],
      ["numeric", 0],
      ["monetary", 12.34],
      ["single_option", "first"],
      ["multi_option", ["first", "second"]],
      ["user", test.actor.id],
      ["person", person.id],
      ["org", org.id],
      ["date", "2026-11-04"],
      ["time", "09:30"],
      ["date_range", { start: "2026-11-04", end: "2026-11-05" }],
      ["time_range", { start: "09:30", end: "10:30" }],
      ["address", { country: "DE", city: "Berlin", lat: 0, lng: 0 }],
    ] as const;
    const defs = await test.db
      .insert(customFieldDefs)
      .values(
        examples.map(([type], order) => ({
          targetEntity: "activity" as const,
          type,
          key: `workflow_${type}`,
          name: `Workflow ${type}`,
          order,
          isRequired: type === "numeric",
          options:
            type === "single_option" || type === "multi_option"
              ? [
                  { id: "first", label: "First" },
                  { id: "second", label: "Second" },
                ]
              : [],
        })),
      )
      .returning();
    const [optional] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: "text",
        key: "workflow_optional",
        name: "Optional important",
        isImportant: true,
        order: 99,
      })
      .returning();
    assert(optional !== undefined);
    const canonical: Record<string, unknown> = Object.fromEntries(
      examples.map(([type, value]) => [`workflow_${type}`, structuredClone(value)]),
    );
    const settings: Record<string, unknown> = Object.fromEntries(
      defs.map((def) => [def.id, { kind: "value", value: canonical[def.key] }]),
    );
    return { ...test, defs, optional, canonical, settings, person, org };
  } catch (error) {
    await test.close();
    if (error instanceof Error) throw error;
    throw new Error("Workflow task fixture setup failed", { cause: error });
  }
}

async function publish(test: Fixture, settings: Record<string, unknown> = test.settings) {
  const [current] = await test.db
    .select()
    .from(workflows)
    .where(eq(workflows.id, test.workflow.id));
  assert(current !== undefined);
  const definition = {
    ...structuredClone(test.definition),
    nodes: test.definition.nodes
      .filter((node) => node.id !== "second_task")
      .map((node) =>
        node.type === "activity.create"
          ? { ...node, config: { ...node.config, customFields: settings } }
          : node,
      ),
    edges: test.definition.edges.filter((edge) => edge.to !== "second_task"),
  };
  const saved = await saveWorkflowDraft(
    test.db,
    test.actor,
    { id: current.id, revision: current.revision, name: "Custom workflow task", definition },
    signal,
  );
  assert(saved.ok, JSON.stringify(saved));
  return publishWorkflow(test.db, test.actor, current.id, saved.value.revision, signal);
}

async function admit(
  test: Fixture,
  mode: "live" | "simulation" = "live",
  requestKey = crypto.randomUUID(),
) {
  return admitManualRun(
    test.db,
    test.actor,
    { workflowId: test.workflow.id, requestKey, recordId: test.deal.id, mode },
    signal,
  );
}
async function finish(test: Fixture, runId: string) {
  for (let count = 0; count < 5; count++) {
    const advanced = await advanceWorkflowRun(test.db, runId, signal);
    assert(advanced.ok, JSON.stringify(advanced));
    if (advanced.value === "succeeded" || advanced.value === "failed") return advanced.value;
  }
  assert.fail("The finite three-node task did not finish");
}

it("stores all sixteen canonical custom types through the actual workflow task, retaining numeric zero and optional omission", async () => {
  const test = await setupRuntime();
  try {
    const published = await publish(test);
    assert(published.ok, JSON.stringify(published));
    const pinned = structuredClone(published.value);
    const run = await admit(test);
    assert(run.ok, JSON.stringify(run));
    expect(await finish(test, run.value.id)).toBe("succeeded");
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customFields).toEqual(test.canonical);
    expect(rows[0]).toMatchObject({
      ownerId: test.actor.id,
      assigneeId: test.actor.id,
      subject: "Earlier completed task",
      dealId: test.deal.id,
    });
    expect(Object.keys(test.canonical)).toHaveLength(16);
    expect(rows[0]?.customFields).not.toHaveProperty(test.optional.key);
    expect(
      await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, pinned.id)),
    ).toEqual([pinned]);
  } finally {
    await test.close();
  }
});

it("rejects required omissions and unknown, archived or recreated definition UUIDs before activity effects", async () => {
  const test = await setupRuntime();
  try {
    const required = test.defs.find((def) => def.type === "numeric");
    const replaced = test.defs.find((def) => def.type === "text");
    assert(required !== undefined && replaced !== undefined);
    const missing = { ...test.settings };
    delete missing[required.id];
    expect((await publish(test, missing)).ok).toBe(false);
    expect(
      (
        await publish(test, {
          ...test.settings,
          [crypto.randomUUID()]: { kind: "value", value: "Unknown" },
        })
      ).ok,
    ).toBe(false);
    await test.db
      .update(customFieldDefs)
      .set({ archivedAt: new Date() })
      .where(eq(customFieldDefs.id, replaced.id));
    expect((await publish(test)).ok).toBe(false);
    await test.db.delete(customFieldDefs).where(eq(customFieldDefs.id, replaced.id));
    const [replacement] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: replaced.type,
        key: replaced.key,
        name: "Recreated same-key field",
      })
      .returning();
    assert(replacement !== undefined);
    expect(replacement.id).not.toBe(replaced.id);
    expect((await publish(test)).ok).toBe(false);
    expect(await test.db.select().from(activities)).toEqual([]);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
  } finally {
    await test.close();
  }
});

it("fails hidden person or organization and inactive user custom references for the actual runner before effects", async () => {
  const test = await setupRuntime();
  try {
    const other = await seedUser(test.db);
    const [person] = await test.db
      .insert(persons)
      .values({ name: "Hidden custom person", ownerId: other.id, visibilityLevel: "owner" })
      .returning();
    const [org] = await test.db
      .insert(organizations)
      .values({ name: "Hidden custom organization", ownerId: other.id, visibilityLevel: "owner" })
      .returning();
    const inactive = await seedUser(test.db, { isActive: false });
    assert(person !== undefined && org !== undefined);
    for (const [type, id] of [
      ["person", person.id],
      ["org", org.id],
      ["user", inactive.id],
    ] as const) {
      const field = test.defs.find((def) => def.type === type);
      assert(field !== undefined);
      const published = await publish(test, {
        ...test.settings,
        [field.id]: { kind: "value", value: id },
      });
      assert(published.ok, JSON.stringify(published));
      const run = await admit(test);
      assert(run.ok, JSON.stringify(run));
      expect(await finish(test, run.value.id)).toBe("failed");
      expect(await test.db.select().from(activities)).toEqual([]);
    }
  } finally {
    await test.close();
  }
});

it("uses fresh required definitions after authoring/publication despite a warmed cache", async () => {
  const test = await setupRuntime();
  try {
    const published = await publish(test);
    assert(published.ok, JSON.stringify(published));
    const pinned = structuredClone(published.value);
    await listDefs(test.db, "activity", {}, signal);
    await test.db
      .update(customFieldDefs)
      .set({ isRequired: true })
      .where(eq(customFieldDefs.id, test.optional.id));
    const run = await admit(test);
    expect(run).toMatchObject({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
    expect(await test.db.select().from(activities)).toEqual([]);
    expect(await test.db.select().from(workflowRuns)).toEqual([]);
    expect(
      await test.db.select().from(workflowVersions).where(eq(workflowVersions.id, pinned.id)),
    ).toEqual([pinned]);
  } finally {
    await test.close();
  }
});

it("commits one custom activity and step when live admission and task delivery are replayed concurrently", async () => {
  const test = await setupRuntime();
  try {
    const published = await publish(test);
    assert(published.ok, JSON.stringify(published));
    const requestKey = crypto.randomUUID();
    const run = await admit(test, "live", requestKey);
    assert(run.ok, JSON.stringify(run));
    const replay = await admit(test, "live", requestKey);
    assert(replay.ok, JSON.stringify(replay));
    expect(replay.value.id).toBe(run.value.id);
    await advanceWorkflowRun(test.db, run.value.id, signal);
    await advanceWorkflowRun(test.db, run.value.id, signal);
    const deliveries = await Promise.all([
      advanceWorkflowRun(test.db, run.value.id, signal),
      advanceWorkflowRun(test.db, run.value.id, signal),
    ]);
    expect(deliveries.every((result) => result.ok && result.value === "succeeded")).toBe(true);
    const rows = await test.db.select().from(activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customFields).toEqual(test.canonical);
    const steps = await test.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, run.value.id));
    expect(steps).toHaveLength(3);
    expect(steps.filter((step) => step.nodeId === "task")).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("runs the same canonical custom pipeline in simulation and rolls back every activity and linked-deal write", async () => {
  const test = await setupRuntime();
  try {
    const published = await publish(test);
    assert(published.ok, JSON.stringify(published));
    const before = await test.db.select().from(deals).where(eq(deals.id, test.deal.id));
    const run = await admit(test, "simulation");
    assert(run.ok, JSON.stringify(run));
    expect(await finish(test, run.value.id)).toBe("succeeded");
    expect(await test.db.select().from(activities)).toEqual([]);
    expect(await test.db.select().from(deals).where(eq(deals.id, test.deal.id))).toEqual(before);
    const steps = await test.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, run.value.id));
    expect(steps).toHaveLength(3);
    expect(steps.every((step) => step.simulated)).toBe(true);
    const task = steps.find((step) => step.nodeId === "task");
    expect(task?.output.id).toEqual(expect.any(String));
    const [actor] = await test.db.select().from(users).where(eq(users.id, test.actor.id));
    expect(actor?.isActive).toBe(true);
  } finally {
    await test.close();
  }
});
