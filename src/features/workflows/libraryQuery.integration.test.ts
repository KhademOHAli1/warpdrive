import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { permissionSets, users, workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { listWorkflows } from "./queries";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
// Compatible with the existing three-argument service; the fourth argument is the
// forthcoming raw options, never a replacement or adapter for its required signal.
const list: (db: Db, actor: PermSetUser, signal: AbortSignal, raw?: unknown) => Promise<unknown> =
  listWorkflows;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };
const runStatuses = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"] as const;
const itemSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string(),
  revision: z.number().int(),
  publishedNumber: z.number().int().nullable(),
  active: z.boolean(),
  archivedAt: z.date().nullable(),
  lifecycle: z.enum(["draft", "active", "paused", "archived"]),
  updatedAt: z.date(),
  owner: z.strictObject({ id: z.string().uuid(), name: z.string() }),
  latestLiveRun: z
    .strictObject({ id: z.string().uuid(), status: z.enum(runStatuses), createdAt: z.date() })
    .nullable(),
  capabilities: z.strictObject({
    archive: z.boolean(),
    unarchive: z.boolean(),
    duplicate: z.boolean(),
  }),
});
const pageSchema = z.strictObject({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
  scopeHasItems: z.boolean(),
  capabilities: z.strictObject({ create: z.boolean(), filterOwners: z.boolean() }),
});
type Page = z.infer<typeof pageSchema>;
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "trigger.manual",
      version: 1,
      name: "private-definition-sentinel",
      config: {},
    },
  ],
  edges: [],
};
const flags = {
  "workflow.view": true,
  "workflow.create": true,
  "workflow.edit": true,
  "workflow.cancel": true,
};

async function setupLibrary() {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({ name: "Library permissions", flags })
      .returning();
    assert(permissions !== undefined);
    const owner = await seedUser(test.db, {
      name: "Visible owner",
      permissionSetId: permissions.id,
    });
    const other = await seedUser(test.db, {
      name: "Hidden owner",
      permissionSetId: permissions.id,
    });
    const admin = await seedUser(test.db, { name: "Library administrator", isAdmin: true });
    const actor = await hydrateActor(test.db, owner.id, signal);
    const outsider = await hydrateActor(test.db, other.id, signal);
    const administrator = await hydrateActor(test.db, admin.id, signal);
    assert(actor !== null && outsider !== null && administrator !== null);
    return { ...test, owner, other, admin, actor, outsider, administrator, permissions };
  } catch (error) {
    await test.close();
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof setupLibrary>>;
type State = "draft" | "active" | "paused" | "archived";

async function seedWorkflow(
  test: Fixture,
  name: string,
  state: State = "draft",
  ownerId = test.owner.id,
) {
  const [workflow] = await test.db
    .insert(workflows)
    .values({ ownerId, name, draft: definition })
    .returning();
  assert(workflow !== undefined);
  let version: typeof workflowVersions.$inferSelect | undefined;
  if (state !== "draft") {
    [version] = await test.db
      .insert(workflowVersions)
      .values({ workflowId: workflow.id, number: 1, name, definition, publishedBy: ownerId })
      .returning();
    assert(version !== undefined);
    await test.db
      .update(workflows)
      .set({
        publishedNumber: 1,
        active: state === "active",
        archivedAt: state === "archived" ? new Date("2026-11-01T00:00:00Z") : null,
      })
      .where(eq(workflows.id, workflow.id));
  }
  return { ...workflow, version };
}

async function seedRun(
  test: Fixture,
  workflow: Awaited<ReturnType<typeof seedWorkflow>>,
  status: (typeof runStatuses)[number],
  options: { mode?: "live" | "simulation"; at?: string; id?: string; actorId?: string } = {},
) {
  assert(workflow.version !== undefined);
  const [run] = await test.db
    .insert(workflowRuns)
    .values({
      ...(options.id === undefined ? {} : { id: options.id }),
      workflowId: workflow.id,
      versionId: workflow.version.id,
      actorId: options.actorId ?? test.owner.id,
      requestKey: crypto.randomUUID(),
      mode: options.mode ?? "live",
      status,
      trigger: { recordId: crypto.randomUUID() },
      outputs: { start: { private: "private-run-output-sentinel" } },
      createdAt: new Date(options.at ?? "2026-11-02T10:00:00.000Z"),
      nextNodeId: status === "waiting" ? "start" : null,
      resumeAt: status === "waiting" ? new Date("2099-01-01T00:00:00Z") : null,
    })
    .returning();
  assert(run !== undefined);
  return run;
}

async function page(test: Fixture, raw: unknown = {}, actor = test.actor): Promise<Page> {
  const result = await list(test.db, actor, signal, raw);
  expect(result).toMatchObject({ ok: true });
  return z.strictObject({ ok: z.literal(true), value: pageSchema }).parse(result).value;
}

async function collect(test: Fixture, raw: Record<string, unknown>, actor = test.actor) {
  const items: Page["items"] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let pages = 0; pages < 150; pages++) {
    const current = await page(test, { ...raw, ...(cursor === null ? {} : { cursor }) }, actor);
    items.push(...current.items);
    if (current.nextCursor === null) return items;
    expect(cursors.has(current.nextCursor)).toBe(false);
    cursors.add(current.nextCursor);
    cursor = current.nextCursor;
  }
  throw new Error("Library pagination did not terminate");
}

it("LC20 distinguishes lifecycle from draft edits and applies current versus archived status", async () => {
  const test = await setupLibrary();
  try {
    const draft = await seedWorkflow(test, "Draft", "draft");
    const active = await seedWorkflow(test, "Active", "active");
    const paused = await seedWorkflow(test, "Paused", "paused");
    const archived = await seedWorkflow(test, "Archived", "archived");
    await test.db
      .update(workflows)
      .set({ revision: 2, draft: { ...definition, layout: { start: { x: 10, y: 20 } } } })
      .where(eq(workflows.id, active.id));
    for (const [status, expected] of [
      ["draft", draft],
      ["active", active],
      ["paused", paused],
    ] as const) {
      const result = await page(test, { status });
      expect(result.items.map((item) => item.id)).toEqual([expected.id]);
      expect(result.items[0]?.lifecycle).toBe(status);
      expect(result.scopeHasItems).toBe(true);
    }
    expect((await page(test, { status: "active" })).items[0]?.revision).toBe(2);
    const current = await page(test);
    expect(current.items.map((item) => item.id).sort()).toEqual(
      [draft.id, active.id, paused.id].sort(),
    );
    const old = await page(test, { archive: "archived" });
    expect(old.items.map((item) => item.id)).toEqual([archived.id]);
    expect(old.items[0]).toMatchObject({
      lifecycle: "archived",
      active: false,
      capabilities: { archive: false, unarchive: true, duplicate: true },
    });
    expect(
      current.items.every((item) => item.capabilities.archive && !item.capabilities.unarchive),
    ).toBe(true);
  } finally {
    await test.close();
  }
});

it("LC20 scopes existence before optional filters and never uses hidden owners for first-use state", async () => {
  const test = await setupLibrary();
  try {
    await seedWorkflow(test, "Hidden matching failure", "active", test.other.id);
    const empty = await page(test, { query: "Hidden" });
    expect(empty).toMatchObject({
      items: [],
      nextCursor: null,
      scopeHasItems: false,
      capabilities: { create: true, filterOwners: false },
    });
    const own = await seedWorkflow(test, "Visible unrelated", "draft");
    expect(await page(test, { query: "no matching name" })).toMatchObject({
      items: [],
      scopeHasItems: true,
    });
    expect(await page(test, { status: "active" })).toMatchObject({
      items: [],
      scopeHasItems: true,
    });
    expect(await page(test, { archive: "archived" })).toMatchObject({
      items: [],
      scopeHasItems: false,
    });
    expect(JSON.stringify(await page(test))).not.toContain(test.other.name);
    expect((await page(test)).items[0]?.id).toBe(own.id);
  } finally {
    await test.close();
  }
});

it("LC20 applies owner authority before lookup, filters, labels and scope counts", async () => {
  const test = await setupLibrary();
  try {
    const own = await seedWorkflow(test, "Visible owner work");
    const hidden = await seedWorkflow(test, "Hidden owner work", "draft", test.other.id);
    expect((await page(test, { ownerId: test.owner.id })).items.map((item) => item.id)).toEqual([
      own.id,
    ]);
    expect(
      (await page(test, { ownerId: test.owner.id.toUpperCase() })).items.map((item) => item.id),
    ).toEqual([own.id]);
    for (const ownerId of [test.other.id, test.other.id.toUpperCase(), crypto.randomUUID()]) {
      expect(await list(test.db, test.actor, signal, { ownerId })).toEqual(denied);
    }
    const all = await page(test, {}, test.administrator);
    expect(all.capabilities).toEqual({ create: true, filterOwners: true });
    expect(all.items.map((item) => item.id).sort()).toEqual([own.id, hidden.id].sort());
    expect(
      (await page(test, { ownerId: test.other.id }, test.administrator)).items.map(
        (item) => item.id,
      ),
    ).toEqual([hidden.id]);
    expect(await page(test, { ownerId: crypto.randomUUID() }, test.administrator)).toMatchObject({
      items: [],
      scopeHasItems: true,
    });
    expect(JSON.stringify(await page(test))).not.toContain(hidden.id);
    expect(JSON.stringify(await page(test))).not.toContain(test.other.name);
  } finally {
    await test.close();
  }
});

it("LC20 exposes workflow ownership independently of the run initiator and withholds all payloads", async () => {
  const test = await setupLibrary();
  try {
    const workflow = await seedWorkflow(test, "Owned definition", "active");
    const run = await seedRun(test, workflow, "failed", { actorId: test.admin.id });
    const result = await page(test);
    expect(result.items[0]?.owner).toEqual({ id: test.owner.id, name: test.owner.name });
    expect(result.items[0]?.latestLiveRun).toEqual({
      id: run.id,
      status: "failed",
      createdAt: run.createdAt,
    });
    const serialized = JSON.stringify(result);
    for (const hidden of [
      "private-definition-sentinel",
      "private-run-output-sentinel",
      run.requestKey,
      run.trigger.recordId,
      test.admin.name,
      "trigger",
      "outputs",
      "actorId",
      "publishedBy",
      "ownerId",
    ]) {
      expect(serialized).not.toContain(hidden);
    }
  } finally {
    await test.close();
  }
});

it.each(runStatuses)(
  "LC20 latest live %s determines health independently of lifecycle",
  async (status) => {
    const test = await setupLibrary();
    try {
      const workflow = await seedWorkflow(test, "Health independent from active", "paused");
      const run = await seedRun(test, workflow, status);
      const plain = await page(test);
      expect(plain.items[0]).toMatchObject({
        lifecycle: "paused",
        latestLiveRun: { id: run.id, status },
      });
      const failed = await page(test, { health: "latest-live-failed" });
      expect(failed.items.map((item) => item.id)).toEqual(status === "failed" ? [workflow.id] : []);
      expect(failed.scopeHasItems).toBe(true);
    } finally {
      await test.close();
    }
  },
);

it("LC20 ignores newer simulation, clears health for newer live success and resolves live ties by ID", async () => {
  const test = await setupLibrary();
  try {
    const workflow = await seedWorkflow(test, "Deterministic live health", "active");
    const failure = await seedRun(test, workflow, "failed", { at: "2026-11-01T00:00:00Z" });
    await seedRun(test, workflow, "succeeded", { mode: "simulation", at: "2026-11-03T00:00:00Z" });
    expect((await page(test, { health: "latest-live-failed" })).items[0]?.latestLiveRun?.id).toBe(
      failure.id,
    );
    const success = await seedRun(test, workflow, "succeeded", {
      at: "2026-11-02T00:00:00Z",
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect((await page(test)).items[0]?.latestLiveRun?.id).toBe(success.id);
    expect((await page(test, { health: "latest-live-failed" })).items).toEqual([]);
    const higher = await seedRun(test, workflow, "failed", {
      at: "2026-11-02T00:00:00Z",
      id: "00000000-0000-4000-8000-000000000002",
    });
    expect((await page(test, { health: "latest-live-failed" })).items[0]?.latestLiveRun?.id).toBe(
      higher.id,
    );
  } finally {
    await test.close();
  }
});

it("LC20 never lets hidden live failures or simulated-only failures supply visible health", async () => {
  const test = await setupLibrary();
  try {
    const own = await seedWorkflow(test, "Simulation only", "active");
    const hidden = await seedWorkflow(test, "Hidden failed workflow", "active", test.other.id);
    await seedRun(test, own, "failed", { mode: "simulation" });
    await seedRun(test, hidden, "failed", { actorId: test.other.id });
    const all = await page(test);
    expect(all.items).toHaveLength(1);
    expect(all.items[0]).toMatchObject({ id: own.id, latestLiveRun: null });
    expect(await page(test, { health: "latest-live-failed" })).toMatchObject({
      items: [],
      scopeHasItems: true,
    });
    expect(JSON.stringify(all)).not.toContain(hidden.id);
    expect(JSON.stringify(all)).not.toContain(test.other.name);
  } finally {
    await test.close();
  }
});

it.each(["inactive", "view-revoked"] as const)(
  "LC20 denies retained actor snapshots after current %s",
  async (reason) => {
    const test = await setupLibrary();
    try {
      await seedWorkflow(test, "No stale metadata");
      expect(test.actor.flags.has("workflow.view")).toBe(true);
      if (reason === "inactive")
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.actor.id));
      else
        await test.db
          .update(permissionSets)
          .set({ flags: { "workflow.create": true } })
          .where(eq(permissionSets.id, test.permissions.id));
      expect(await list(test.db, test.actor, signal)).toEqual(denied);
    } finally {
      await test.close();
    }
  },
);

it("LC20 rehydrates a downgraded administrator before deriving rows, owner labels and capabilities", async () => {
  const test = await setupLibrary();
  try {
    const own = await seedWorkflow(test, "Former administrator's own work", "draft", test.admin.id);
    const hidden = await seedWorkflow(test, "Other owner hidden after downgrade");
    expect((await page(test, {}, test.administrator)).items).toHaveLength(2);
    await test.db
      .update(users)
      .set({ isAdmin: false, permissionSetId: test.permissions.id })
      .where(eq(users.id, test.admin.id));
    const result = await page(test, {}, test.administrator);
    expect(result.items.map((item) => item.id)).toEqual([own.id]);
    expect(result.capabilities).toEqual({ create: true, filterOwners: false });
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain(test.owner.name);
  } finally {
    await test.close();
  }
});

it("LC20 derives row and page actions from current permissions without granting authority", async () => {
  const test = await setupLibrary();
  try {
    const current = await seedWorkflow(test, "Read-only current");
    const archived = await seedWorkflow(test, "Read-only archive", "archived");
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.view": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    const plain = await page(test);
    expect(plain.capabilities).toEqual({ create: false, filterOwners: false });
    expect(plain.items[0]).toMatchObject({
      id: current.id,
      capabilities: { archive: false, unarchive: false, duplicate: false },
    });
    const old = await page(test, { archive: "archived" });
    expect(old.items[0]).toMatchObject({
      id: archived.id,
      capabilities: { archive: false, unarchive: false, duplicate: false },
    });
  } finally {
    await test.close();
  }
});

for (const sort of ["updated-desc", "name-asc", "name-desc"] as const) {
  it(`LC21 paginates 121 equal-key visible rows in ${sort} without duplication or omission`, async () => {
    const test = await setupLibrary();
    try {
      const ids = Array.from({ length: 121 }, () => crypto.randomUUID());
      await test.db.insert(workflows).values(
        ids.map((id) => ({
          id,
          ownerId: test.owner.id,
          name: "Equal name",
          draft: definition,
          updatedAt: new Date("2026-11-02T00:00:00.123Z"),
        })),
      );
      await seedWorkflow(test, "Equal name", "draft", test.other.id);
      const expected = ids.slice().sort();
      if (sort !== "name-asc") expected.reverse();
      const result = await collect(test, { sort, limit: 17 });
      expect(result.map((item) => item.id)).toEqual(expected);
      expect(new Set(result.map((item) => item.id)).size).toBe(121);
      expect(result.every((item) => item.owner.id === test.owner.id)).toBe(true);
      const maximum = await page(test, { sort, limit: 100 });
      expect(maximum.items).toHaveLength(100);
      expect(maximum.nextCursor).not.toBeNull();
      const final = await page(test, { sort, limit: 100, cursor: maximum.nextCursor });
      expect(final.items).toHaveLength(21);
      expect(final.nextCursor).toBeNull();
    } finally {
      await test.close();
    }
  }, 15_000);
}

it("LC21 uses actual name order in both directions before the ID tie-breaker", async () => {
  const test = await setupLibrary();
  try {
    for (const name of ["Charlie", "Alpha", "Bravo"]) await seedWorkflow(test, name);
    expect((await collect(test, { sort: "name-asc", limit: 1 })).map((item) => item.name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
    expect((await collect(test, { sort: "name-desc", limit: 1 })).map((item) => item.name)).toEqual(
      ["Charlie", "Bravo", "Alpha"],
    );
  } finally {
    await test.close();
  }
});

it("LC21 preserves sub-millisecond database timestamps in updated-order continuation", async () => {
  const test = await setupLibrary();
  try {
    const rows = [];
    for (const name of [
      "Microsecond first",
      "Microsecond second",
      "Microsecond third",
      "Older millisecond",
    ])
      rows.push(await seedWorkflow(test, name));
    const stamps = [
      "2026-11-02T00:00:00.123900Z",
      "2026-11-02T00:00:00.123800Z",
      "2026-11-02T00:00:00.123700Z",
      "2026-11-02T00:00:00.122999Z",
    ];
    for (const [index, row] of rows.entries())
      await test.pool.query("UPDATE workflows SET updated_at = $2::timestamptz WHERE id = $1", [
        row.id,
        stamps[index],
      ]);
    const result = await collect(test, { sort: "updated-desc", limit: 1 });
    expect(result.map((item) => item.id)).toEqual(rows.map((row) => row.id));
  } finally {
    await test.close();
  }
});

it("LC21 binds cursors to normalized filters, sort and page size, and rejects malformed schemas", async () => {
  const test = await setupLibrary();
  try {
    for (const name of ["Match alpha", "Match beta", "Match gamma"]) await seedWorkflow(test, name);
    const first = await page(test, { query: "  Match  ", limit: 1 });
    assert(first.nextCursor !== null);
    expect(await page(test, { query: "Match", limit: 1, cursor: "" })).toEqual(first);
    // Equivalent normalization is usable, without changing stored names.
    expect(
      (await page(test, { query: "Match", limit: 1, cursor: first.nextCursor })).items,
    ).toHaveLength(1);
    const mismatches = [
      { query: "Different", limit: 1 },
      { query: "Match", limit: 2 },
      { query: "Match", limit: 1, sort: "name-asc" },
      { query: "Match", limit: 1, status: "active" },
      { query: "Match", limit: 1, health: "latest-live-failed" },
      { query: "Match", limit: 1, archive: "archived" },
    ];
    for (const raw of mismatches)
      expect(await list(test.db, test.actor, signal, { ...raw, cursor: first.nextCursor })).toEqual(
        invalid,
      );
    const ownerPage = await page(test, { query: "Match", ownerId: test.owner.id, limit: 1 });
    assert(ownerPage.nextCursor !== null);
    expect(
      (
        await page(test, {
          query: "Match",
          ownerId: test.owner.id.toUpperCase(),
          limit: 1,
          cursor: ownerPage.nextCursor,
        })
      ).items,
    ).toHaveLength(1);
    const adminPage = await page(test, { query: "Match", limit: 1 }, test.administrator);
    assert(adminPage.nextCursor !== null);
    expect(
      await list(test.db, test.administrator, signal, {
        query: "Match",
        ownerId: test.other.id,
        limit: 1,
        cursor: adminPage.nextCursor,
      }),
    ).toEqual(invalid);
    expect(
      await list(test.db, test.actor, signal, {
        query: "Match",
        limit: 1,
        cursor: adminPage.nextCursor,
      }),
    ).toEqual(invalid);
    for (const cursor of [
      "not-a-cursor",
      `!${first.nextCursor}`,
      Buffer.from(JSON.stringify({ version: 999, unknown: true })).toString("base64url"),
      "x".repeat(10_000),
    ]) {
      expect(await list(test.db, test.actor, signal, { query: "Match", limit: 1, cursor })).toEqual(
        invalid,
      );
    }
  } finally {
    await test.close();
  }
});

it("LC21 rechecks current view permission between pages instead of exposing cached scope", async () => {
  const test = await setupLibrary();
  try {
    await seedWorkflow(test, "First");
    await seedWorkflow(test, "Second");
    const first = await page(test, { limit: 1 });
    assert(first.nextCursor !== null);
    await test.db
      .update(permissionSets)
      .set({ flags: { "workflow.create": true } })
      .where(eq(permissionSets.id, test.permissions.id));
    expect(await list(test.db, test.actor, signal, { limit: 1, cursor: first.nextCursor })).toEqual(
      denied,
    );
  } finally {
    await test.close();
  }
});

it("LC22 matches EN/FA/DE and mixed names literally without changing their stored text", async () => {
  const test = await setupLibrary();
  try {
    const names = [
      "Kunden nachfassen",
      "پیگیری مشتری",
      "Customer follow up",
      "مشتری Kunde Customer",
    ];
    for (const name of names) await seedWorkflow(test, name);
    for (const [query, expected] of [
      ["kunden", [names[0]]],
      ["پیگیری", [names[1]]],
      ["FOLLOW", [names[2]]],
      ["  مشتری  ", [names[1], names[3]]],
    ] as const) {
      expect((await page(test, { query })).items.map((item) => item.name).sort()).toEqual(
        [...expected].sort(),
      );
    }
    expect(
      (await test.db.select({ name: workflows.name }).from(workflows))
        .map((row) => row.name)
        .sort(),
    ).toEqual(names.slice().sort());
  } finally {
    await test.close();
  }
});

it.each(["%", "_", "\\"])(
  "LC22 treats %s as a literal substring rather than a wildcard or escape",
  async (literal) => {
    const test = await setupLibrary();
    try {
      const target = await seedWorkflow(test, `Literal ${literal} marker`);
      await seedWorkflow(test, "Literal X marker");
      await seedWorkflow(test, "Unrelated");
      expect((await page(test, { query: literal })).items.map((item) => item.id)).toEqual([
        target.id,
      ]);
    } finally {
      await test.close();
    }
  },
);

it("LC22 rejects malformed list options without broadening the authorized query", async () => {
  const test = await setupLibrary();
  try {
    await seedWorkflow(test, "Unchanged visible row");
    const before = await test.db.select().from(workflows);
    const inputs: unknown[] = [
      null,
      [],
      "query",
      { extra: true },
      { query: "x".repeat(201) },
      { query: "\0" },
      { query: 1 },
      { archive: "all" },
      { status: "failed" },
      { archive: "archived", status: "active" },
      { ownerId: "not-a-uuid" },
      { ownerId: null },
      { health: "failed" },
      { sort: "random" },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: "25" },
      { limit: Number.NaN },
      { cursor: null },
      { cursor: {} },
    ];
    for (const raw of inputs) expect(await list(test.db, test.actor, signal, raw)).toEqual(invalid);
    expect(await test.db.select().from(workflows)).toEqual(before);
  } finally {
    await test.close();
  }
});

it("LC20 combines literal search, lifecycle, owner and latest-live health within archive scope", async () => {
  const test = await setupLibrary();
  try {
    const target = await seedWorkflow(test, "Target active failure", "active");
    const paused = await seedWorkflow(test, "Target paused failure", "paused");
    const foreign = await seedWorkflow(test, "Target foreign failure", "active", test.other.id);
    const otherName = await seedWorkflow(test, "Unrelated active failure", "active");
    const success = await seedWorkflow(test, "Target active success", "active");
    const archived = await seedWorkflow(test, "Target archived failure", "archived");
    for (const workflow of [target, paused, foreign, otherName, archived])
      await seedRun(test, workflow, "failed");
    await seedRun(test, success, "succeeded");
    const raw = {
      query: "Target",
      status: "active",
      ownerId: test.owner.id,
      health: "latest-live-failed",
    };
    expect((await page(test, raw, test.administrator)).items.map((item) => item.id)).toEqual([
      target.id,
    ]);
    expect((await page(test, raw)).items.map((item) => item.id)).toEqual([target.id]);
    expect(
      (
        await page(
          test,
          {
            query: "Target",
            archive: "archived",
            ownerId: test.owner.id,
            health: "latest-live-failed",
          },
          test.administrator,
        )
      ).items.map((item) => item.id),
    ).toEqual([archived.id]);
  } finally {
    await test.close();
  }
});
