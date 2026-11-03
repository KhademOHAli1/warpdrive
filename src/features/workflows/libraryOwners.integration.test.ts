import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { permissionSets, users, workflows } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { listWorkflowOwners } from "./library";
import type { WorkflowDefinition } from "./schemas";

const signal = new AbortController().signal;
const owners: (db: Db, actor: PermSetUser, signal: AbortSignal, raw?: unknown) => Promise<unknown> =
  listWorkflowOwners;
const denied = { ok: false, error: ERROR_IDS.WORKFLOW_DENIED };
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };
const ownerPageSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.string().uuid(), name: z.string() })),
  nextCursor: z.string().nullable(),
});
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "trigger.manual",
      version: 1,
      name: "private-owner-definition",
      config: {},
    },
  ],
  edges: [],
};

async function setupOwners() {
  const test = await makeTestDb();
  try {
    const [permissions] = await test.db
      .insert(permissionSets)
      .values({
        name: "Owner picker viewer",
        flags: { "workflow.view": true, "workflow.create": true },
      })
      .returning();
    assert(permissions !== undefined);
    const admin = await seedUser(test.db, { isAdmin: true, name: "Owner picker administrator" });
    const regular = await seedUser(test.db, {
      permissionSetId: permissions.id,
      name: "Regular own-scope viewer",
    });
    const actor = await hydrateActor(test.db, admin.id, signal);
    const viewer = await hydrateActor(test.db, regular.id, signal);
    assert(actor !== null && viewer !== null);
    return { ...test, admin, regular, actor, viewer, permissions };
  } catch (error) {
    await test.close();
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof setupOwners>>;

async function seedOwner(test: Fixture, name: string, archive = false, count = 1) {
  const owner = await seedUser(test.db, { name });
  await test.db.insert(workflows).values(
    Array.from({ length: count }, (_, index) => ({
      ownerId: owner.id,
      name: `Workflow ${index + 1}`,
      draft: definition,
      archivedAt: archive ? new Date("2026-11-01T00:00:00Z") : null,
    })),
  );
  return owner;
}

async function page(test: Fixture, raw: unknown = {}, actor = test.actor) {
  const result = await owners(test.db, actor, signal, raw);
  expect(result).toMatchObject({ ok: true });
  return z.strictObject({ ok: z.literal(true), value: ownerPageSchema }).parse(result).value;
}

it("LC20 derives distinct current and archived owner options from workflows, never the directory", async () => {
  const test = await setupOwners();
  try {
    const first = await seedOwner(test, "First workflow owner", false, 3);
    const second = await seedOwner(test, "Second workflow owner");
    const archived = await seedOwner(test, "Archived-only workflow owner", true);
    const directoryOnly = await seedUser(test.db, { name: "Directory-only no-workflow user" });
    await test.db.insert(workflows).values({
      ownerId: first.id,
      name: "Also archived",
      draft: definition,
      archivedAt: new Date(),
    });
    const current = await page(test);
    expect(current.items).toEqual(
      [first, second]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, name }) => ({ id, name })),
    );
    expect(current.nextCursor).toBeNull();
    const old = await page(test, { archive: "archived" });
    expect(old.items).toEqual(
      [first, archived]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, name }) => ({ id, name })),
    );
    for (const result of [current, old]) {
      const serialized = JSON.stringify(result);
      for (const hidden of [
        directoryOnly.id,
        directoryOnly.name,
        directoryOnly.email,
        "private-owner-definition",
        "ownerId",
        "email",
        "isAdmin",
        "permissionSetId",
        "workflowCount",
        "totalCount",
      ])
        expect(serialized).not.toContain(hidden);
    }
  } finally {
    await test.close();
  }
});

it("LC20 denies regular viewers instead of offering a broader owner directory", async () => {
  const test = await setupOwners();
  try {
    await seedOwner(test, "Hidden directory option");
    await test.db
      .insert(workflows)
      .values({ ownerId: test.regular.id, name: "Own visible work", draft: definition });
    expect(await owners(test.db, test.viewer, signal)).toEqual(denied);
    expect(await owners(test.db, test.viewer, signal, { archive: "archived" })).toEqual(denied);
    // Cursor state is not a way to discover owner scope under denied authority.
    expect(await owners(test.db, test.viewer, signal, { cursor: "not-a-cursor" })).toEqual(denied);
  } finally {
    await test.close();
  }
});

it.each(["inactive", "downgraded"] as const)(
  "LC20 denies stale administrator owner options after current %s",
  async (reason) => {
    const test = await setupOwners();
    try {
      await seedOwner(test, "First");
      await seedOwner(test, "Second");
      const first = await page(test, { limit: 1 });
      assert(first.nextCursor !== null);
      expect(test.actor.type).toBe("admin");
      if (reason === "inactive")
        await test.db.update(users).set({ isActive: false }).where(eq(users.id, test.admin.id));
      else
        await test.db
          .update(users)
          .set({ isAdmin: false, permissionSetId: test.permissions.id })
          .where(eq(users.id, test.admin.id));
      const current = await hydrateActor(test.db, test.admin.id, signal);
      if (reason === "downgraded") {
        expect(current?.type).toBe("regular");
        expect(current?.flags.has("workflow.view")).toBe(true);
      } else expect(current).toBeNull();
      expect(
        await owners(test.db, test.actor, signal, { limit: 1, cursor: first.nextCursor }),
      ).toEqual(denied);
      expect(await owners(test.db, test.actor, signal, { cursor: "not-a-cursor" })).toEqual(denied);
    } finally {
      await test.close();
    }
  },
);

it("LC20 returns authorized empty owner pages without global counts or unrelated directory options", async () => {
  const test = await setupOwners();
  try {
    await seedUser(test.db, { name: "Directory only" });
    expect(await page(test)).toEqual({ items: [], nextCursor: null });
    await seedOwner(test, "Current only");
    expect(await page(test, { archive: "archived" })).toEqual({ items: [], nextCursor: null });
    expect(await page(test, { query: "No matching owner" })).toEqual({
      items: [],
      nextCursor: null,
    });
  } finally {
    await test.close();
  }
});

it("LC21 bounds distinct owner pages at default25/max100 with stable UUID continuation", async () => {
  const test = await setupOwners();
  try {
    const seeded = [];
    for (let index = 0; index < 121; index++)
      seeded.push(await seedOwner(test, `Owner ${index + 1}`, false, index === 0 ? 3 : 1));
    const expected = seeded
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name }) => ({ id, name }));
    const first = await page(test);
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    const seen = [];
    let cursor: string | null = null;
    const cursors = new Set<string>();
    for (let count = 0; count < 10; count++) {
      const current = await page(test, { limit: 17, ...(cursor === null ? {} : { cursor }) });
      seen.push(...current.items);
      if (current.nextCursor === null) break;
      expect(cursors.has(current.nextCursor)).toBe(false);
      cursors.add(current.nextCursor);
      cursor = current.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen.map((owner) => owner.id)).size).toBe(121);
    const maximum = await page(test, { limit: 100 });
    expect(maximum.items).toHaveLength(100);
    assert(maximum.nextCursor !== null);
    const final = await page(test, { limit: 100, cursor: maximum.nextCursor });
    expect(final.items).toHaveLength(21);
    expect(final.nextCursor).toBeNull();
  } finally {
    await test.close();
  }
}, 15_000);

it("LC21 binds owner cursors to normalized archive, label search, page size and actor", async () => {
  const test = await setupOwners();
  try {
    await seedOwner(test, "Match owner one");
    await seedOwner(test, "Match owner two");
    const first = await page(test, { query: "  Match  ", limit: 1 });
    assert(first.nextCursor !== null);
    expect(await page(test, { query: "Match", limit: 1, cursor: "" })).toEqual(first);
    expect(
      (await page(test, { query: "Match", limit: 1, cursor: first.nextCursor })).items,
    ).toHaveLength(1);
    for (const raw of [
      { query: "Other", limit: 1 },
      { query: "Match", limit: 2 },
      { query: "Match", limit: 1, archive: "archived" },
    ]) {
      expect(
        await owners(test.db, test.actor, signal, { ...raw, cursor: first.nextCursor }),
      ).toEqual(invalid);
    }
    const otherAdmin = await seedUser(test.db, { isAdmin: true });
    const otherActor = await hydrateActor(test.db, otherAdmin.id, signal);
    assert(otherActor !== null);
    expect(
      await owners(test.db, otherActor, signal, {
        query: "Match",
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).toEqual(invalid);
    for (const cursor of [
      "not-a-cursor",
      `!${first.nextCursor}`,
      Buffer.from(JSON.stringify({ version: 999, unknown: true })).toString("base64url"),
      "x".repeat(10_000),
    ]) {
      expect(
        await owners(test.db, test.actor, signal, { query: "Match", limit: 1, cursor }),
      ).toEqual(invalid);
    }
  } finally {
    await test.close();
  }
});

it("LC22 searches EN/FA/DE owner labels, not workflow titles or unrelated directory entries", async () => {
  const test = await setupOwners();
  try {
    const names = ["Kunden Team", "تیم فروش", "Customer team", "مشتری Kunde Customer"];
    for (const name of names) await seedOwner(test, name);
    await seedUser(test.db, { name: "Customer directory only" });
    for (const [query, expected] of [
      ["kunden", [names[0]]],
      ["فروش", [names[1]]],
      ["  CUSTOMER  ", [names[2], names[3]]],
    ] as const) {
      expect((await page(test, { query })).items.map((owner) => owner.name).sort()).toEqual(
        [...expected].sort(),
      );
    }
    expect((await page(test, { query: "Workflow" })).items).toEqual([]);
  } finally {
    await test.close();
  }
});

it.each(["%", "_", "\\"])("LC22 owner search treats %s literally", async (literal) => {
  const test = await setupOwners();
  try {
    const target = await seedOwner(test, `Owner ${literal} marker`);
    await seedOwner(test, "Owner X marker");
    expect((await page(test, { query: literal })).items).toEqual([
      { id: target.id, name: target.name },
    ]);
  } finally {
    await test.close();
  }
});

it("LC22 rejects malformed owner filters without exposing global directory data", async () => {
  const test = await setupOwners();
  try {
    await seedOwner(test, "Unchanged owner");
    for (const raw of [
      null,
      [],
      "query",
      { ownerId: test.regular.id },
      { status: "all" },
      { query: "x".repeat(201) },
      { query: "\0" },
      { query: 1 },
      { archive: "all" },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: "25" },
      { cursor: null },
      { cursor: {} },
    ]) {
      expect(await owners(test.db, test.actor, signal, raw)).toEqual(invalid);
    }
  } finally {
    await test.close();
  }
});
