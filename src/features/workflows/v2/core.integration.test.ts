import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { organizations, permissionSets, persons, users } from "@/db/schema";
import {
  workflowV2Effects,
  workflowV2Executions,
  workflowV2Runs,
  workflowV2Waits,
} from "@/db/schema/workflowV2";
import { workflowV2RecordEvents } from "@/db/schema/workflowV2Events";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type {
  WorkflowV2Adapters,
  WorkflowV2Definition,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { startWorkflowV2 } from "./admission";
import { executeNativeAction, nativeActionReadiness } from "./nativeActions";
import { createWorkflowV2, publishWorkflowV2, saveWorkflowV2 } from "./persistence";
import { readWorkflowV2Run } from "./queries";
import { drainWorkflowV2RecordOutbox } from "./recordOutbox";
import { advanceWorkflowV2Run } from "./runner";
import { resumeDueWorkflowV2Waits, resumeWorkflowV2Form } from "./waits";
import { admitWorkflowV2Webhook, rotateWorkflowV2Webhook } from "./webhook";

const signal = () => AbortSignal.timeout(15_000);
const actor = (id: string): PermSetUser => ({
  id,
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
});
const node = (
  id: string,
  type: WorkflowV2Node["type"],
  config: WorkflowV2Node["config"],
): WorkflowV2Node => ({ id, type, version: 1, name: id, config });
const definition = (
  nodes: WorkflowV2Node[],
  edges: WorkflowV2Definition["edges"],
): WorkflowV2Definition => ({
  schemaVersion: 2,
  trigger: { type: "manual", config: { availability: "global" } },
  nodes,
  edges,
  entryNodeIds: [nodes[0]?.id ?? ""],
});
const adapters: WorkflowV2Adapters = {
  native: executeNativeAction,
  external: () => Promise.resolve(ok({ transportFixture: true })),
  readiness: (db, who, node, abort) =>
    [
      "CREATE_RECORD",
      "UPDATE_RECORD",
      "DELETE_RECORD",
      "UPSERT_RECORD",
      "FIND_RECORDS",
      "PICK_RECORD",
    ].includes(node.type)
      ? nativeActionReadiness(db, who, node, abort)
      : Promise.resolve({ state: "ready" }),
};
async function published(
  db: Db,
  who: PermSetUser,
  draft: WorkflowV2Definition,
  handlers = adapters,
) {
  const created = await createWorkflowV2(
    db,
    who,
    { name: "Core regression", definition: draft },
    signal(),
  );
  if (!created.ok) throw new Error(created.error);
  const publish = await publishWorkflowV2(
    db,
    who,
    { id: created.value.id, expectedRevision: created.value.revision },
    handlers,
    signal(),
  );
  if (!publish.ok) throw new Error(publish.error);
  return publish.value.document;
}
async function start(db: Db, who: PermSetUser, id: string, handlers = adapters) {
  const admitted = await startWorkflowV2(
    db,
    who,
    { id, requestKey: randomUUID(), trigger: {} },
    handlers,
    signal(),
  );
  if (!admitted.ok) throw new Error(admitted.error);
  return admitted.value;
}

it("pins immutable versions and commits each native loop effect with one receipt under competing workers", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const draft = definition(
      [
        node("loop", "ITERATOR", { items: ["First", "Second"] }),
        node("create", "CREATE_RECORD", {
          objectName: "person",
          fields: { name: { kind: "reference", nodeId: "loop", path: ["currentItem"] } },
        }),
        node("done", "FILTER", { condition: { left: true, operator: "eq", right: true } }),
      ],
      [
        { id: "body", source: "loop", target: "create", sourcePort: "loop" },
        { id: "done", source: "loop", target: "done", sourcePort: "done" },
      ],
    );
    const workflow = await published(db, who, draft);
    const request = { id: workflow.id, requestKey: randomUUID(), trigger: {} };
    const starts = await Promise.all([
      startWorkflowV2(db, who, request, adapters, signal()),
      startWorkflowV2(db, who, request, adapters, signal()),
    ]);
    expect(starts.every((result) => result.ok)).toBe(true);
    const [run] = await db.select().from(workflowV2Runs);
    if (run === undefined) throw new Error("run missing");
    const changed = await saveWorkflowV2(
      db,
      who,
      {
        id: workflow.id,
        expectedRevision: workflow.revision,
        name: "Changed",
        definition: {
          ...draft,
          nodes: draft.nodes.map((row) =>
            row.id === "loop" ? { ...row, config: { items: ["Wrong"] } } : row,
          ),
        },
      },
      signal(),
    );
    if (!changed.ok) throw new Error(changed.error);
    expect(
      (
        await publishWorkflowV2(
          db,
          who,
          { id: workflow.id, expectedRevision: changed.value.revision },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(true);
    for (let step = 0; step < 6; step++)
      await Promise.all([
        advanceWorkflowV2Run(db, run.id, adapters, signal()),
        advanceWorkflowV2Run(db, run.id, adapters, signal()),
      ]);
    expect((await db.select().from(persons)).map((row) => row.name).sort()).toEqual([
      "First",
      "Second",
    ]);
    const executions = await db.select().from(workflowV2Executions);
    expect(executions).toHaveLength(4);
    expect(new Set(executions.map((row) => row.visitKey)).size).toBe(4);
    expect((await db.select().from(workflowV2Runs))[0]?.versionId).toBe(run.versionId);
    expect((await db.select().from(workflowV2Runs))[0]?.status).toBe("succeeded");
    const detail = await readWorkflowV2Run(db, who, run.id, signal());
    expect(detail.ok && detail.value.run.state.outputs).toEqual({});
    expect(detail.ok && detail.value.executions.every((row) => row.output?.redacted === true)).toBe(
      true,
    );
  });
});
it("rolls back partial native writes on operational failure and rechecks actor revocation before effects", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const faulty: WorkflowV2Adapters = {
      ...adapters,
      native: async (tx, args) => {
        await tx
          .insert(organizations)
          .values({ name: "Must roll back", ownerId: args.actor.id, visibilityLevel: "all" });
        return err("E_FIXTURE_PARTIAL_FAILURE");
      },
    };
    const draft = definition(
      [node("create", "CREATE_RECORD", { objectName: "organization", fields: { name: "A" } })],
      [],
    );
    const workflow = await published(db, who, draft, faulty);
    const run = await start(db, who, workflow.id, faulty);
    expect((await advanceWorkflowV2Run(db, run.id, faulty, signal())).status).toBe("failed");
    expect(await db.select().from(organizations)).toEqual([]);
    expect((await db.select().from(workflowV2Executions))[0]?.errorId).toBe(
      "E_FIXTURE_PARTIAL_FAILURE",
    );
    const next = await start(db, who, workflow.id);
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect((await advanceWorkflowV2Run(db, next.id, adapters, signal())).status).toBe("cancelled");
    expect(await db.select().from(organizations)).toEqual([]);
  });
});
it("persists forms across advances, authenticates a single-use callback and treats event timeout as success", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true }),
      stranger = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const draft = definition(
      [
        node("form", "FORM", {
          fields: [{ id: "answer", name: "answer", label: "Answer", type: "TEXT", required: true }],
        }),
        node("wait", "WAIT_FOR_EVENT", { eventName: "person.updated", timeoutSeconds: 1 }),
      ],
      [{ id: "next", source: "form", target: "wait", sourcePort: "next" }],
    );
    const workflow = await published(db, who, draft);
    const run = await start(db, who, workflow.id);
    expect((await advanceWorkflowV2Run(db, run.id, adapters, signal())).status).toBe("waiting");
    const [form] = await db.select().from(workflowV2Waits);
    if (form === undefined) throw new Error("wait missing");
    expect(
      (
        await resumeWorkflowV2Form(
          db,
          actor(stranger.id),
          { waitId: form.id, response: { answer: "stolen" } },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (await resumeWorkflowV2Form(db, who, { waitId: form.id, response: {} }, adapters, signal()))
        .ok,
    ).toBe(false);
    const response = { waitId: form.id, response: { answer: "yes" }, requestKey: randomUUID() };
    expect((await resumeWorkflowV2Form(db, who, response, adapters, signal())).ok).toBe(true);
    expect(
      (
        await resumeWorkflowV2Form(
          db,
          who,
          { ...response, requestKey: randomUUID() },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect((await advanceWorkflowV2Run(db, run.id, adapters, signal())).status).toBe("waiting");
    expect(
      await resumeDueWorkflowV2Waits(db, adapters, signal(), new Date(Date.now() + 2000)),
    ).toEqual([run.id]);
    const waits = await db.select().from(workflowV2Waits);
    expect(waits.find((row) => row.kind === "event")?.output).toEqual({ hasTimedOut: true });
    expect((await db.select().from(workflowV2Runs))[0]?.status).toBe("succeeded");
  });
});
it("persists unknown external outcomes and never resends a claimed expired intent", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    let calls = 0;
    const external: WorkflowV2Adapters = {
      ...adapters,
      external: () => {
        calls++;
        return Promise.resolve(err({ id: "E_FIXTURE_TIMEOUT", outcome: "unknown" as const }));
      },
    };
    const draft = definition(
      [
        node("http", "HTTP_REQUEST", {
          url: "https://fixture.example",
          method: "POST",
          body: { message: "test" },
        }),
      ],
      [],
    );
    const workflow = await published(db, who, draft, external);
    const run = await start(db, who, workflow.id, external);
    expect((await advanceWorkflowV2Run(db, run.id, external, signal())).status).toBe("failed");
    await advanceWorkflowV2Run(db, run.id, external, signal());
    expect(calls).toBe(1);
    expect((await db.select().from(workflowV2Effects))[0]?.status).toBe("unknown");
    const next = await start(db, who, workflow.id, external);
    await db
      .insert(workflowV2Executions)
      .values({
        id: randomUUID(),
        runId: next.id,
        nodeId: "http",
        visitKey: "|http",
        framePath: [],
        status: "running",
      })
      .returning()
      .then(async ([execution]) => {
        if (execution === undefined) throw new Error("execution missing");
        await db.insert(workflowV2Effects).values({
          runId: next.id,
          executionId: execution.id,
          request: { url: "https://fixture.example", method: "POST" },
          status: "claimed",
          leaseUntil: new Date(Date.now() - 1000),
        });
      });
    expect((await advanceWorkflowV2Run(db, next.id, external, signal())).status).toBe("failed");
    expect(calls).toBe(1);
  });
});
it("authenticates published webhooks and rejects idempotency key reuse for different payload or version", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const draft = {
      ...definition(
        [node("filter", "FILTER", { condition: { left: true, operator: "eq", right: true } })],
        [],
      ),
      trigger: { type: "webhook" as const, config: { authentication: "api_key" } },
    };
    const created = await createWorkflowV2(
      db,
      who,
      { name: "Webhook", definition: draft },
      signal(),
    );
    if (!created.ok) throw new Error(created.error);
    const rotated = await rotateWorkflowV2Webhook(
      db,
      who,
      { id: created.value.id, expectedRevision: created.value.revision },
      signal(),
    );
    if (!rotated.ok) throw new Error(rotated.error);
    expect(JSON.stringify(rotated.value.document)).not.toContain(rotated.value.apiKey);
    expect(
      (
        await publishWorkflowV2(
          db,
          who,
          { id: created.value.id, expectedRevision: rotated.value.document.revision },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(true);
    const request = {
      requestKey: randomUUID(),
      apiKey: rotated.value.apiKey,
      payload: { a: 1, b: 2 },
    };
    expect(
      (
        await admitWorkflowV2Webhook(
          db,
          created.value.id,
          { ...request, apiKey: "wrong" },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(false);
    const first = await admitWorkflowV2Webhook(db, created.value.id, request, adapters, signal());
    expect(first.ok).toBe(true);
    expect(
      await admitWorkflowV2Webhook(
        db,
        created.value.id,
        { ...request, payload: { b: 2, a: 1 } },
        adapters,
        signal(),
      ),
    ).toEqual(first);
    expect(
      (
        await admitWorkflowV2Webhook(
          db,
          created.value.id,
          { ...request, payload: { a: 2 } },
          adapters,
          signal(),
        )
      ).ok,
    ).toBe(false);
  });
});

async function regularWorkflowActor(db: Db) {
  const [set] = await db
    .insert(permissionSets)
    .values({
      name: `Workflow test ${randomUUID()}`,
      flags: {
        "workflow.view": true,
        "workflow.create": true,
        "workflow.edit": true,
        "workflow.publish": true,
        "workflow.run": true,
      },
    })
    .returning();
  if (set === undefined) throw new Error("permission set fixture missing");
  const user = await seedUser(db, { permissionSetId: set.id });
  return { ...actor(user.id), type: "regular" as const };
}

it("denies an outbound binding when its CRM source becomes hidden during a delay", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const who = await regularWorkflowActor(db);
    const [person] = await db
      .insert(persons)
      .values({ name: "Restricted after wait", ownerId: owner.id, visibilityLevel: "all" })
      .returning();
    if (person === undefined) throw new Error("person fixture missing");
    let calls = 0;
    const handlers: WorkflowV2Adapters = {
      ...adapters,
      external: () => {
        calls++;
        return Promise.resolve(ok({ sent: true }));
      },
    };
    const draft = definition(
      [
        node("find", "FIND_RECORDS", {
          objectName: "person",
          filters: [{ field: "id", operator: "eq", value: person.id }],
        }),
        node("delay", "DELAY", { mode: "duration", seconds: 30 }),
        node("post", "HTTP_REQUEST", {
          url: "https://fixture.example",
          method: "POST",
          body: { name: { kind: "reference", nodeId: "find", path: ["records", 0, "name"] } },
        }),
      ],
      [
        { id: "a", source: "find", target: "delay", sourcePort: "next" },
        { id: "b", source: "delay", target: "post", sourcePort: "next" },
      ],
    );
    const workflow = await published(db, who, draft, handlers);
    const run = await start(db, who, workflow.id, handlers);
    expect((await advanceWorkflowV2Run(db, run.id, handlers, signal())).status).toBe("running");
    expect((await advanceWorkflowV2Run(db, run.id, handlers, signal())).status).toBe("waiting");
    await db.update(persons).set({ visibilityLevel: "owner" }).where(eq(persons.id, person.id));
    expect(
      await resumeDueWorkflowV2Waits(db, handlers, signal(), new Date(Date.now() + 31_000)),
    ).toEqual([run.id]);
    expect((await advanceWorkflowV2Run(db, run.id, handlers, signal())).status).toBe("failed");
    expect(
      (await db.select().from(workflowV2Runs).where(eq(workflowV2Runs.id, run.id)))[0]?.errorId,
    ).toBe("E_WORKFLOW_V2_SOURCE_REVOKED");
    expect(calls).toBe(0);
    expect(await db.select().from(workflowV2Effects)).toEqual([]);
  });
});

it("matches canonical watched fields and wipes raw outbox snapshots after durable admission", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true }),
      next = await seedUser(db);
    const who = actor(user.id);
    const [person] = await db
      .insert(persons)
      .values({ name: "Watched", ownerId: user.id, visibilityLevel: "all" })
      .returning();
    if (person === undefined) throw new Error("person fixture missing");
    const draft = {
      ...definition(
        [node("filter", "FILTER", { condition: { left: true, operator: "eq", right: true } })],
        [],
      ),
      trigger: {
        type: "record.updated" as const,
        config: { objectName: "person", updatedFields: ["ownerId"] },
      },
    };
    await published(db, who, draft);
    await db.update(persons).set({ name: "Name only" }).where(eq(persons.id, person.id));
    expect(await drainWorkflowV2RecordOutbox(db, adapters, signal())).toEqual([]);
    await db.update(persons).set({ ownerId: next.id }).where(eq(persons.id, person.id));
    const ids = await drainWorkflowV2RecordOutbox(db, adapters, signal());
    expect(ids).toHaveLength(1);
    expect((await db.select().from(workflowV2Runs))[0]?.trigger.changedFields).toContain("ownerId");
    expect(
      (await db.select().from(workflowV2RecordEvents)).every(
        (row) => row.status === "delivered" && row.before === null && row.after === null,
      ),
    ).toBe(true);
    expect(await drainWorkflowV2RecordOutbox(db, adapters, signal())).toEqual([]);
  });
});

it("never wakes a recipient on a hidden record event, then resumes for a visible event", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const who = await regularWorkflowActor(db);
    const [hidden, visible] = await db
      .insert(persons)
      .values([
        { name: "Hidden", ownerId: owner.id, visibilityLevel: "owner" },
        { name: "Visible", ownerId: owner.id, visibilityLevel: "all" },
      ])
      .returning();
    if (hidden === undefined || visible === undefined) throw new Error("person fixtures missing");
    const workflow = await published(
      db,
      who,
      definition(
        [node("wait", "WAIT_FOR_EVENT", { eventName: "person.updated", updatedFields: ["name"] })],
        [],
      ),
    );
    const run = await start(db, who, workflow.id);
    expect((await advanceWorkflowV2Run(db, run.id, adapters, signal())).status).toBe("waiting");
    await db.update(persons).set({ name: "Still hidden" }).where(eq(persons.id, hidden.id));
    expect(await drainWorkflowV2RecordOutbox(db, adapters, signal())).toEqual([]);
    expect((await db.select().from(workflowV2Waits))[0]?.status).toBe("open");
    await db.update(persons).set({ name: "Still visible" }).where(eq(persons.id, visible.id));
    expect(await drainWorkflowV2RecordOutbox(db, adapters, signal())).toEqual([run.id]);
    expect((await db.select().from(workflowV2Waits))[0]?.output).toMatchObject({
      hasTimedOut: false,
      recordId: visible.id,
    });
  });
});
