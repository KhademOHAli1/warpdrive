import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { workflowV2RuntimeSettings } from "@/db/schema/workflowV2Functions";
import { seedUser } from "@/db/testing/factories";
import { toActor } from "@/features/stats/statsTestHelpers";
import { makeTestDb } from "@/test/db";
import { executeExternalAction } from "./externalActions";
import { readWorkflowRuntime, saveWorkflowLogicFunction, saveWorkflowRuntime } from "./runtime";

it("keeps the workspace AI key encrypted and never carries it to a changed endpoint", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const admin = toActor(await seedUser(h.db, { isAdmin: true }));
    const ordinary = toActor(await seedUser(h.db));
    const config = {
      aiBaseUrl: "https://provider.example.test/v1",
      aiDefaultModel: "fixture-model",
      aiModels: ["fixture-model"],
    };
    expect(
      await saveWorkflowRuntime(h.db, ordinary, { ...config, aiApiKey: "fixture-secret" }, signal),
    ).toEqual({ ok: false, error: "E_PERM_001" });
    expect(
      await saveWorkflowRuntime(h.db, admin, { ...config, aiApiKey: "fixture-secret" }, signal),
    ).toMatchObject({ ok: true, value: { hasAiKey: true } });
    const [stored] = await h.db
      .select({ key: workflowV2RuntimeSettings.aiApiKey })
      .from(workflowV2RuntimeSettings);
    expect(stored?.key).toBeInstanceOf(Buffer);
    expect(stored?.key?.includes("fixture-secret")).toBe(false);
    const unchanged = await saveWorkflowRuntime(h.db, admin, config, signal);
    expect(unchanged).toMatchObject({ ok: true, value: { hasAiKey: true } });
    expect(JSON.stringify(unchanged)).not.toContain("fixture-secret");
    expect(
      await saveWorkflowRuntime(
        h.db,
        admin,
        { ...config, aiBaseUrl: "https://another.example.test/v1" },
        signal,
      ),
    ).toMatchObject({ ok: true, value: { hasAiKey: false } });
  } finally {
    await h.close();
  }
});
it("executes a pinned named function revision and enforces its stored input schema", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const actor = toActor(await seedUser(h.db, { isAdmin: true }));
    const authored = {
      name: "Twice",
      description: "",
      sourceCode: "export function main({value}:{value:number}) { return {result:2*value}; }",
      inputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
      },
      outputSchema: {
        type: "object",
        properties: { result: { type: "number" } },
        required: ["result"],
      },
    };
    const created = await saveWorkflowLogicFunction(h.db, actor, authored, signal);
    const runtime = await readWorkflowRuntime(h.db, actor, signal);
    if (!created.ok || !runtime.ok || runtime.value.functions[0] === undefined)
      throw new TypeError("Missing saved logic function");
    const revised = await saveWorkflowLogicFunction(
      h.db,
      actor,
      {
        ...authored,
        familyId: runtime.value.functions[0].familyId,
        sourceCode: "function main(){return {result:99};}",
      },
      signal,
    );
    expect(revised).toMatchObject({ ok: true, value: { revision: 2 } });
    const id = randomUUID();
    const context = {
      db: h.db,
      actor,
      workflowId: id,
      runId: id,
      executionId: id,
      effectKey: id,
      mode: "test" as const,
      signal,
      nextPickIndex: () => Promise.resolve(0),
    };
    const node = {
      id: "math",
      version: 1 as const,
      type: "LOGIC_FUNCTION" as const,
      name: "Twice",
      config: {},
    };
    expect(
      await executeExternalAction(context, node, {
        functionId: created.value.id,
        inputs: { value: 5 },
      }),
    ).toEqual({ ok: true, value: { result: 10 } });
    expect(
      await executeExternalAction(context, node, {
        functionId: created.value.id,
        inputs: { value: "5" },
      }),
    ).toEqual({ ok: false, error: { id: "E_WORKFLOW_FUNCTION_INPUT" } });
  } finally {
    await h.close();
  }
});
