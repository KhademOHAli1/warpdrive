import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { users, workflows, workflowVersions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { createWorkflow, publishWorkflow, saveWorkflowDraft } from "./persistence";

const signal = new AbortController().signal;
const definition = {
  schemaVersion: 1,
  nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "شروع", config: {} }],
  edges: [],
};

it("rejects non-JSON draft input before it reaches the database", async () => {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    if (actor === null) throw new Error("missing actor");
    const invalid = { ...definition, nodes: [{ ...definition.nodes[0], config: { value: 1n } }] };
    expect(
      await createWorkflow(test.db, actor, { name: "Invalid", definition: invalid }, signal),
    ).toEqual({ ok: false, error: "E_WORKFLOW_002" });
    expect(await test.db.select().from(workflows)).toHaveLength(0);
  } finally {
    await test.close();
  }
});

it("retains incomplete drafts but refuses publication until configuration is valid", async () => {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    if (actor === null) throw new Error("missing actor");
    const unfinished = {
      schemaVersion: 1,
      nodes: [
        ...definition.nodes,
        { id: "read", type: "record.read", version: 1, name: "Read", config: {} },
      ],
      edges: [{ from: "start", to: "read", port: "next" }],
    };
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "Unfinished", definition: unfinished },
      signal,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(await publishWorkflow(test.db, actor, created.value.id, 1, signal)).toEqual({
      ok: false,
      error: "E_WORKFLOW_002",
    });
    expect(await test.db.select().from(workflowVersions)).toHaveLength(0);
    expect((await test.db.select().from(workflows))[0]?.active).toBe(false);
  } finally {
    await test.close();
  }
});

it("makes publication retries idempotent and rejects an invalid active-version pointer", async () => {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    if (actor === null) throw new Error("missing actor");
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "Publish once", definition },
      signal,
    );
    if (!created.ok) throw new Error(created.error);
    const outcomes = await Promise.all([
      publishWorkflow(test.db, actor, created.value.id, 1, signal),
      publishWorkflow(test.db, actor, created.value.id, 1, signal),
    ]);
    expect(outcomes.every((result) => result.ok)).toBe(true);
    expect(await test.db.select().from(workflowVersions)).toHaveLength(1);
    await test.db
      .update(workflows)
      .set({ active: false })
      .where(eq(workflows.id, created.value.id));
    expect((await publishWorkflow(test.db, actor, created.value.id, 1, signal)).ok).toBe(true);
    expect((await test.db.select().from(workflows))[0]?.active).toBe(true);
    await expect(
      test.db
        .update(workflows)
        .set({ publishedNumber: 500, active: true })
        .where(eq(workflows.id, created.value.id)),
    ).rejects.toThrow();
  } finally {
    await test.close();
  }
});

it("saves drafts with optimistic concurrency and freezes published versions", async () => {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const actor = await hydrateActor(test.db, user.id, signal);
    if (actor === null) throw new Error("missing actor");
    const created = await createWorkflow(
      test.db,
      actor,
      { name: "پیگیری مشتری", definition },
      signal,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const first = await publishWorkflow(test.db, actor, created.value.id, 1, signal);
    expect(first.ok).toBe(true);
    const saved = await saveWorkflowDraft(
      test.db,
      actor,
      { id: created.value.id, revision: 1, name: "Kunden nachfassen", definition },
      signal,
    );
    expect(saved.ok).toBe(true);
    const stale = await saveWorkflowDraft(
      test.db,
      actor,
      { id: created.value.id, revision: 1, name: "Stale replacement", definition },
      signal,
    );
    expect(stale).toEqual({ ok: false, error: "E_WORKFLOW_003" });
    const versions = await test.db.select().from(workflowVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.name).toBe("پیگیری مشتری");
    await expect(test.db.update(workflowVersions).set({ name: "tampered" })).rejects.toThrow();
    const rows = await test.db.select().from(workflows);
    expect(rows[0]?.name).toBe("Kunden nachfassen");
    expect(rows[0]?.active).toBe(true);
  } finally {
    await test.close();
  }
});

it("denies another owner and inactive administrators without exposing definitions", async () => {
  const test = await makeTestDb();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const other = await seedUser(test.db);
    const actor = await hydrateActor(test.db, user.id, signal);
    const outsider = await hydrateActor(test.db, other.id, signal);
    if (actor === null || outsider === null) throw new Error("missing actor");
    const created = await createWorkflow(test.db, actor, { name: "Private", definition }, signal);
    if (!created.ok) throw new Error(created.error);
    expect((await publishWorkflow(test.db, outsider, created.value.id, 1, signal)).ok).toBe(false);
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, actor.id));
    expect(await hydrateActor(test.db, actor.id, signal)).toBeNull();
    expect(
      (
        await createWorkflow(
          test.db,
          { ...actor, isActive: false },
          { name: "Disabled", definition },
          signal,
        )
      ).ok,
    ).toBe(false);
  } finally {
    await test.close();
  }
});
