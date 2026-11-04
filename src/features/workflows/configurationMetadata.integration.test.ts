import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  customFieldDefs,
  organizations,
  permissionSets,
  persons,
  users,
  workflows,
} from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import {
  readWorkflowConfigurationOptions,
  readWorkflowConfigurationReferences,
} from "./configurationLookups";
import { readWorkflowConfiguration } from "./configurationMetadata";
import { workflowsRouter } from "./router";
import { retryFlags, setupRetryActor } from "./runRetry.test-helpers";

const signal = new AbortController().signal;
type Fixture = Awaited<ReturnType<typeof setupRetryActor>>;
const input = (test: Fixture) => ({
  workflowId: test.workflow.id,
  type: "activity.create" as const,
  version: 1 as const,
});
async function page(test: Fixture, raw: unknown = input(test), actor = test.actor) {
  const result = await readWorkflowConfiguration(test.db, actor, signal, raw);
  assert(result.ok, JSON.stringify(result));
  assert(result.value.state === "page");
  return result.value;
}
async function field(test: Fixture, overrides: Partial<typeof customFieldDefs.$inferInsert> = {}) {
  const [row] = await test.db
    .insert(customFieldDefs)
    .values({
      targetEntity: "activity",
      type: "text",
      name: "Workflow field",
      key: `workflow_${crypto.randomUUID().replaceAll("-", "")}`,
      ...overrides,
    })
    .returning();
  assert(row !== undefined);
  return row;
}
async function expectDenied(test: Fixture, actor = test.actor) {
  const result = await readWorkflowConfiguration(test.db, actor, signal, input(test));
  expect(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_DENIED } });
  const refs = await readWorkflowConfigurationReferences(test.db, actor, signal, {
    ...input(test),
    field: { kind: "builtin", name: "dealId" },
    mode: "search",
  });
  expect(refs).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_DENIED } });
  const options = await readWorkflowConfigurationOptions(test.db, actor, signal, {
    ...input(test),
    fieldId: crypto.randomUUID(),
    fingerprint: "0".repeat(64),
  });
  expect(options).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_DENIED } });
}

it("returns only current activity descriptors and independent authoring/execution capability metadata", async () => {
  const test = await setupRetryActor();
  try {
    const active = await field(test, { isRequired: true, isImportant: false });
    await field(test, { archivedAt: new Date(), name: "Archived private field" });
    await field(test, { targetEntity: "deal", name: "Other entity field" });
    const result = await page(test);
    expect(result).toMatchObject({
      workflowId: test.workflow.id,
      type: "activity.create",
      version: 1,
      totalFields: 1,
      nextCursor: null,
      capabilities: { edit: true },
      executionReasons: [],
    });
    expect(result.items).toEqual([
      {
        id: active.id,
        key: active.key,
        type: active.type,
        name: active.name,
        order: active.order,
        isRequired: true,
        isImportant: false,
        optionCount: 0,
      },
    ]);
    expect(Object.keys(result).sort()).toEqual(
      [
        "state",
        "workflowId",
        "type",
        "version",
        "fingerprint",
        "items",
        "nextCursor",
        "totalFields",
        "capabilities",
        "executionReasons",
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /Archived private|Other entity|permissionSetId|definition|emails|connectionId/u,
    );
  } finally {
    await test.close();
  }
});

it("permits view-only metadata and warns about activity create without granting draft edit", async () => {
  const test = await setupRetryActor();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    const result = await page(test);
    expect(result.capabilities.edit).toBe(false);
    expect(result.executionReasons).toContain("activity-create-required");
  } finally {
    await test.close();
  }
});

it("allows a current administrator and denies the retained administrator after demotion", async () => {
  const test = await setupRetryActor();
  try {
    const user = await seedUser(test.db, { isAdmin: true });
    const admin = await hydrateActor(test.db, user.id, signal);
    assert(admin !== null);
    expect((await page(test, input(test), admin)).capabilities.edit).toBe(true);
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: test.permissions.id })
      .where(eq(users.id, user.id));
    await expectDenied(test, admin);
  } finally {
    await test.close();
  }
});

it("rehydrates retained actors after view revocation and deactivation on every read", async () => {
  const test = await setupRetryActor();
  try {
    await test.db
      .update(permissionSets)
      .set({ flags: { ...retryFlags, "workflow.view": false } })
      .where(eq(permissionSets.id, test.permissions.id));
    await expectDenied(test);
    await test.db
      .update(permissionSets)
      .set({ flags: retryFlags })
      .where(eq(permissionSets.id, test.permissions.id));
    await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
    await expectDenied(test);
  } finally {
    await test.close();
  }
});

it("withholds identical metadata for an outsider and a missing workflow", async () => {
  const test = await setupRetryActor();
  try {
    const user = await seedUser(test.db, { permissionSetId: test.permissions.id });
    const outsider = await hydrateActor(test.db, user.id, signal);
    assert(outsider !== null);
    await expectDenied(test, outsider);
    const missing = await readWorkflowConfiguration(test.db, test.actor, signal, {
      ...input(test),
      workflowId: crypto.randomUUID(),
    });
    expect(missing).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_DENIED } });
  } finally {
    await test.close();
  }
});

it("retains authorized archived metadata with authoring disabled", async () => {
  const test = await setupRetryActor();
  try {
    await field(test);
    await test.db
      .update(workflows)
      .set({ active: false, archivedAt: new Date() })
      .where(eq(workflows.id, test.workflow.id));
    const result = await page(test);
    expect(result.items).toHaveLength(1);
    expect(result.capabilities.edit).toBe(false);
  } finally {
    await test.close();
  }
});

it("continues beyond one hundred fields including a required field on the final page without claiming a partial schema is complete", async () => {
  const test = await setupRetryActor();
  try {
    await test.db.insert(customFieldDefs).values(
      Array.from({ length: 121 }, (_, order) => ({
        targetEntity: "activity" as const,
        type: "text" as const,
        key: `many_${order}`,
        name: `Field ${order}`,
        order,
        isRequired: order === 120,
      })),
    );
    let result = await page(test);
    const fingerprint = result.fingerprint;
    const seen = [...result.items];
    expect(result.items).toHaveLength(50);
    expect(result.totalFields).toBe(121);
    expect(result.nextCursor).not.toBeNull();
    for (let index = 0; index < 5 && result.nextCursor !== null; index++) {
      result = await page(test, { ...input(test), fingerprint, cursor: result.nextCursor });
      expect(result.fingerprint).toBe(fingerprint);
      seen.push(...result.items);
    }
    expect(result.nextCursor).toBeNull();
    expect(seen).toHaveLength(121);
    expect(new Set(seen.map((row) => row.id)).size).toBe(121);
    expect(seen.at(-1)?.isRequired).toBe(true);
  } finally {
    await test.close();
  }
});

it("pages every active option by stable ordinal beyond one hundred without truncating the universe", async () => {
  const test = await setupRetryActor();
  try {
    const options = Array.from({ length: 121 }, (_, index) => ({
      id: `option-${index}`,
      label: `Option ${index}`,
    }));
    const selected = await field(test, {
      type: "single_option",
      options: [...options, { id: "archived", label: "Archived", archived: true }],
    });
    const metadata = await page(test);
    expect(metadata.items[0]?.optionCount).toBe(121);
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await readWorkflowConfigurationOptions(test.db, test.actor, signal, {
        ...input(test),
        fieldId: selected.id,
        fingerprint: metadata.fingerprint,
        cursor,
      });
      assert(result.ok && result.value.state === "page");
      expect(result.value.totalOptions).toBe(121);
      seen.push(...result.value.items.map((option) => option.id));
      cursor = result.value.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }
    expect(cursor).toBeUndefined();
    expect(seen).toEqual(options.map((option) => option.id));
  } finally {
    await test.close();
  }
});

it("keeps filtered option search distinct from complete unfiltered metadata and matches literal search text", async () => {
  const test = await setupRetryActor();
  try {
    const selected = await field(test, {
      type: "autocomplete",
      options: [
        { id: "literal", label: "پیگیری %_\\ Rückruf" },
        { id: "other", label: "Other" },
      ],
    });
    const metadata = await page(test);
    const result = await readWorkflowConfigurationOptions(test.db, test.actor, signal, {
      ...input(test),
      fieldId: selected.id,
      fingerprint: metadata.fingerprint,
      query: " %_\\ ",
    });
    assert(result.ok && result.value.state === "page");
    expect(result.value.query).toBe("%_\\");
    expect(result.value.items).toEqual([{ id: "literal", label: "پیگیری %_\\ Rückruf" }]);
    expect(metadata.items[0]?.optionCount).toBe(2);
  } finally {
    await test.close();
  }
});

it("returns stale with no mixed items after a definition or option fingerprint changes", async () => {
  const test = await setupRetryActor();
  try {
    const selected = await field(test, {
      type: "single_option",
      options: [{ id: "one", label: "One" }],
    });
    await field(test, { order: 1 });
    const first = await page(test, { ...input(test), limit: 1 });
    assert(first.nextCursor !== null);
    await test.db
      .update(customFieldDefs)
      .set({ name: "Renamed", isRequired: true, options: [{ id: "two", label: "Two" }] })
      .where(eq(customFieldDefs.id, selected.id));
    const next = await readWorkflowConfiguration(test.db, test.actor, signal, {
      ...input(test),
      limit: 1,
      fingerprint: first.fingerprint,
      cursor: first.nextCursor,
    });
    expect(next).toMatchObject({ ok: true, value: { state: "stale", restart: true } });
    if (next.ok) expect(next.value).not.toHaveProperty("items");
    const options = await readWorkflowConfigurationOptions(test.db, test.actor, signal, {
      ...input(test),
      fieldId: selected.id,
      fingerprint: first.fingerprint,
    });
    expect(options).toMatchObject({ ok: true, value: { state: "stale" } });
  } finally {
    await test.close();
  }
});

it("does not alias a removed UUID to a recreated same-key field and preserves rename identity", async () => {
  const test = await setupRetryActor();
  try {
    const original = await field(test);
    const first = await page(test);
    await test.db
      .update(customFieldDefs)
      .set({ name: "Rename keeps identity" })
      .where(eq(customFieldDefs.id, original.id));
    const renamed = await page(test);
    expect(renamed.items[0]?.id).toBe(original.id);
    expect(renamed.fingerprint).not.toBe(first.fingerprint);
    await test.db.delete(customFieldDefs).where(eq(customFieldDefs.id, original.id));
    const replacement = await field(test, { key: original.key, name: "Recreated" });
    expect(replacement.id).not.toBe(original.id);
    const current = await page(test);
    const old = await readWorkflowConfigurationOptions(test.db, test.actor, signal, {
      ...input(test),
      fieldId: original.id,
      fingerprint: current.fingerprint,
    });
    expect(old).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_DENIED } });
  } finally {
    await test.close();
  }
});

it("rejects strict malformed inputs, cross-filter cursors and invalid protected router requests", async () => {
  const test = await setupRetryActor();
  try {
    for (const raw of [
      { ...input(test), extra: true },
      { ...input(test), version: 2 },
      { ...input(test), workflowId: "invalid" },
      { ...input(test), cursor: "forged" },
      { ...input(test), cursor: "x".repeat(4097) },
    ])
      expect(await readWorkflowConfiguration(test.db, test.actor, signal, raw)).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.WORKFLOW_INVALID },
      });
    await field(test);
    await field(test);
    const first = await page(test, { ...input(test), limit: 1 });
    assert(first.nextCursor !== null);
    expect(
      await readWorkflowConfiguration(test.db, test.actor, signal, {
        ...input(test),
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_INVALID } });
    const caller = workflowsRouter.createCaller({
      db: test.db,
      actor: test.actor,
      session: test.who,
    });
    const invalid = { ...input(test), extra: true };
    await expect(caller.configuration(invalid)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const anonymous = workflowsRouter.createCaller({ db: test.db, actor: null, session: null });
    await expect(anonymous.configuration(input(test))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  } finally {
    await test.close();
  }
});

it("returns only current visible selected person/org and active user labels for server-derived custom targets", async () => {
  const test = await setupRetryActor();
  try {
    const other = await seedUser(test.db);
    const inactive = await seedUser(test.db, { isActive: false });
    const [visible] = await test.db
      .insert(persons)
      .values({
        name: "Visible selected person",
        primaryEmail: "private@example.com",
        ownerId: test.actor.id,
        visibilityLevel: "owner",
      })
      .returning();
    const [hidden] = await test.db
      .insert(persons)
      .values({ name: "Hidden selected person", ownerId: other.id, visibilityLevel: "owner" })
      .returning();
    const [org] = await test.db
      .insert(organizations)
      .values({
        name: "Visible selected organization",
        ownerId: test.actor.id,
        visibilityLevel: "owner",
      })
      .returning();
    assert(visible !== undefined && hidden !== undefined && org !== undefined);
    const personField = await field(test, { type: "person" });
    const orgField = await field(test, { type: "org" });
    const userField = await field(test, { type: "user" });
    const metadata = await page(test);
    for (const [selected, ids, expected] of [
      [personField, [visible.id, hidden.id], [{ id: visible.id, label: visible.name }]],
      [orgField, [org.id], [{ id: org.id, label: org.name }]],
      [userField, [test.actor.id, inactive.id], [{ id: test.actor.id, label: test.user.name }]],
    ] as const) {
      const result = await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
        ...input(test),
        field: { kind: "custom", fieldId: selected.id },
        fingerprint: metadata.fingerprint,
        mode: "selected",
        ids: [...ids],
      });
      assert(result.ok && result.value.state === "page");
      expect(result.value.items).toEqual(expected);
      expect(JSON.stringify(result)).not.toMatch(
        /private@example|Hidden selected|email|permissionSetId/u,
      );
    }
  } finally {
    await test.close();
  }
});

it("applies visibility before reference limits and continues UUID order without duplicates", async () => {
  const test = await setupRetryActor();
  try {
    const other = await seedUser(test.db);
    await test.db.insert(persons).values(
      Array.from({ length: 50 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: "Lookup hidden",
        ownerId: other.id,
        visibilityLevel: "owner" as const,
      })),
    );
    const visible = await test.db
      .insert(persons)
      .values(
        Array.from({ length: 31 }, (_, index) => ({
          name: `Lookup visible ${index}`,
          ownerId: test.actor.id,
          visibilityLevel: "owner" as const,
        })),
      )
      .returning({ id: persons.id });
    const selected = await field(test, { type: "person" });
    const metadata = await page(test);
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let index = 0; index < 6; index++) {
      const result = await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
        ...input(test),
        field: { kind: "custom", fieldId: selected.id },
        fingerprint: metadata.fingerprint,
        mode: "search",
        query: "Lookup",
        limit: 10,
        cursor,
      });
      assert(result.ok && result.value.state === "page");
      expect(result.value.items.length).toBeGreaterThan(0);
      expect(result.value.items.length).toBeLessThanOrEqual(10);
      seen.push(...result.value.items.map((item) => item.id));
      cursor = result.value.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }
    expect(cursor).toBeUndefined();
    expect(seen).toEqual(visible.map((row) => row.id).sort());
    expect(new Set(seen).size).toBe(31);
  } finally {
    await test.close();
  }
});

it("invalidates custom reference labels on stale metadata and rejects a caller-supplied entity kind", async () => {
  const test = await setupRetryActor();
  try {
    const selected = await field(test, { type: "person" });
    const metadata = await page(test);
    await test.db
      .update(customFieldDefs)
      .set({ type: "user" })
      .where(eq(customFieldDefs.id, selected.id));
    const raw = {
      ...input(test),
      field: { kind: "custom", fieldId: selected.id },
      fingerprint: metadata.fingerprint,
      mode: "search",
    };
    expect(
      await readWorkflowConfigurationReferences(test.db, test.actor, signal, raw),
    ).toMatchObject({ ok: true, value: { state: "stale", restart: true } });
    expect(
      await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
        ...raw,
        kind: "user",
      }),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_INVALID } });
  } finally {
    await test.close();
  }
});

it("derives builtin deal targets from the actual profile and returns no unrelated CRM directory", async () => {
  const test = await setupRetryActor();
  try {
    const result = await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
      ...input(test),
      field: { kind: "builtin", name: "dealId" },
      mode: "selected",
      ids: [test.deal.id],
    });
    assert(result.ok && result.value.state === "page");
    expect(result.value.items).toEqual([{ id: test.deal.id, label: test.deal.title }]);
    expect(
      await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
        ...input(test),
        type: "delay",
        field: { kind: "builtin", name: "dealId" },
        mode: "search",
      }),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_INVALID } });
    expect(
      await readWorkflowConfigurationReferences(test.db, test.actor, signal, {
        ...input(test),
        field: { kind: "builtin", name: "recordId" },
        mode: "search",
      }),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.WORKFLOW_INVALID } });
  } finally {
    await test.close();
  }
});
