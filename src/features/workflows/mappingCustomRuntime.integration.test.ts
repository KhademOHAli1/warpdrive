import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { customFieldDefs } from "@/db/schema";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import { resolveTaskCustomFields } from "./configurationRuntime";
import { setupRetryActor } from "./runRetry.test-helpers";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;

async function setupMapping(path = "expectedCloseDate") {
  const test = await setupRetryActor();
  try {
    const [field] = await test.db
      .insert(customFieldDefs)
      .values({ targetEntity: "activity", type: "date", key: "mapped_date", name: "Mapped date" })
      .returning();
    assert(field !== undefined);
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        { id: "manual", type: "trigger.manual", version: 1, name: "Start", config: {} },
        {
          id: "read",
          type: "record.read",
          version: 1,
          name: "Read",
          config: { entity: "deal", recordId: { kind: "value", value: test.deal.id } },
        },
        {
          id: "task",
          type: "activity.create",
          version: 1,
          name: "Task",
          config: {
            subject: { kind: "value", value: "Follow up" },
            customFields: { [field.id]: { kind: "reference", nodeId: "read", path: [path] } },
          },
        },
      ],
      edges: [
        { from: "manual", to: "read", port: "next" },
        { from: "read", to: "task", port: "next" },
      ],
    };
    const task = definition.nodes[2];
    assert(task !== undefined);
    const prepared = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    return { ...test, field, definition, task, prepared };
  } catch (error) {
    await test.close();
    if (error instanceof Error) throw error;
    throw new Error("Typed custom mapping fixture setup failed", { cause: error });
  }
}

type Fixture = Awaited<ReturnType<typeof setupMapping>>;
function resolve(test: Fixture, outputs: RunOutputs) {
  return resolveTaskCustomFields(
    test.db,
    test.actor,
    test.task,
    { outputs, definition: test.definition },
    test.prepared,
    signal,
  );
}

it("resolves a declared ancestor civil date through the current canonical field parser", async () => {
  const test = await setupMapping();
  try {
    expect(await resolve(test, { read: { expectedCloseDate: "2030-03-20" } })).toStrictEqual({
      ok: true,
      value: { mapped_date: "2030-03-20" },
    });
  } finally {
    await test.close();
  }
});

it("rejects a date-looking generic title despite a canonical date-compatible string value", async () => {
  const test = await setupMapping("title");
  try {
    expect(await resolve(test, { read: { title: "2030-03-20" } })).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_INVALID },
    });
  } finally {
    await test.close();
  }
});

it("rejects a disconnected source even when its old cumulative output is still present", async () => {
  const test = await setupMapping();
  try {
    test.definition.edges = test.definition.edges.filter((edge) => edge.to !== "task");
    expect(await resolve(test, { read: { expectedCloseDate: "2030-03-20" } })).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_INVALID },
    });
  } finally {
    await test.close();
  }
});

it("reports a missing historical date property without filling it from today's CRM", async () => {
  const test = await setupMapping();
  try {
    expect(
      await resolve(test, { read: { id: test.deal.id, title: "Historical receipt" } }),
    ).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_BINDING_MISSING },
    });
  } finally {
    await test.close();
  }
});

it("keeps explicit null distinct from omission for an optional but nonnullable canonical date", async () => {
  const test = await setupMapping();
  try {
    expect(await resolve(test, { read: { expectedCloseDate: null } })).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.WORKFLOW_INVALID },
    });
    test.task.config.customFields = {};
    expect(await resolve(test, {})).toStrictEqual({ ok: true, value: {} });
  } finally {
    await test.close();
  }
});

it("rejects an invalid actual output without echoing its payload in the structured error", async () => {
  const test = await setupMapping();
  const privatePayload = "private CRM payload; not a civil date";
  try {
    const result = await resolve(test, { read: { expectedCloseDate: privatePayload } });
    expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_INVALID } });
    expect(JSON.stringify(result)).not.toContain(privatePayload);
  } finally {
    await test.close();
  }
});
