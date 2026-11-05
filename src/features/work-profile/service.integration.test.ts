import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pipelines, stages, users } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { makeTestDb, type TestDb } from "@/test/db";
import { applyAckSchema, previewSchema, type WorkCommand, workItemSchema } from "./contracts";
import type { WorkActor } from "./policy";
import { workInstallations, workItems, workTypes } from "./schema";
import { WorkService } from "./service";

let test: TestDb;
let admin: WorkActor;
const signal = () => AbortSignal.timeout(20000);
beforeEach(async () => {
  test = await makeTestDb();
  const [u] = await test.db
    .insert(users)
    .values({ name: "Admin", email: `${randomUUID()}@example.test`, isAdmin: true })
    .returning();
  admin = { id: u!.id, type: "admin", isActive: true, flags: new Set(), groupIds: new Set() };
});
afterEach(async () => {
  await test.close();
});
async function run(input: WorkCommand, actor = admin) {
  return withCurrentAuthority(test.db, "read", signal(), async (db) =>
    new WorkService(db, actor, signal()).command(input),
  );
}
async function install() {
  const input = {
    action: "preview" as const,
    requestId: randomUUID(),
    presetId: "vehicle_repair" as const,
    locale: "en" as const,
    expectedRevision: 0,
    selection: { sales: true, delivery: true, dealFields: true, activityTypes: true },
  };
  const preview = await run(input);
  expect(preview.ok).toBe(true);
  if (!preview.ok) throw Error("preview");
  const command = {
    action: "apply" as const,
    requestId: randomUUID(),
    preview: previewSchema.parse(preview.value),
  };
  const applied = await run(command);
  expect(applied.ok).toBe(true);
  if (!applied.ok) throw Error("apply");
  return {
    command,
    data: applyAckSchema.parse(applied.value),
  };
}
describe("work profile atomic installer and real operational records", () => {
  it("installs actual sales and delivery resources once and undoes only unused owned additions", async () => {
    const { command, data } = await install();
    expect(data.workTypes).toHaveLength(1);
    expect(await run(command)).toEqual({ ok: true, value: data });
    expect(await test.db.select().from(pipelines)).toHaveLength(1);
    expect(await test.db.select().from(stages)).toHaveLength(4);
    const undone = await run({
      action: "undo",
      requestId: randomUUID(),
      installationId: data.installation.id,
    });
    expect(undone.ok).toBe(true);
    expect(await test.db.select().from(workTypes)).toHaveLength(0);
    expect(await test.db.select().from(pipelines)).toHaveLength(0);
  });
  it("preserves referenced delivery configurations, typed values and CAS, and denies invisible reads", async () => {
    const { data } = await install();
    const type = data.workTypes[0]!;
    const item = {
      typeId: type.id,
      stageId: type.stages[0]!.id,
      title: "Repair customer vehicle",
      description: "Inspect first",
      ownerId: admin.id,
      organizationId: null,
      personId: null,
      dealId: null,
      dueDate: "2026-11-06",
      visibility: "owner" as const,
      visibilityGroupId: null,
      values: { mileage: 12000 },
    };
    const created = await run({ action: "create_item", requestId: randomUUID(), item });
    expect(created.ok).toBe(true);
    if (!created.ok) throw Error("create");
    const record = workItemSchema.parse(created.value);
    expect(
      await run({
        action: "update_item",
        requestId: randomUUID(),
        id: record.id,
        expectedRevision: 0,
        item,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      await run({ action: "undo", requestId: randomUUID(), installationId: data.installation.id }),
    ).toMatchObject({ ok: false, error: { code: "in_use" } });
    expect(await test.db.select().from(pipelines)).toHaveLength(1);
    expect(await test.db.select().from(workItems)).toHaveLength(1);
    const [other] = await test.db
      .insert(users)
      .values({ name: "Member", email: `${randomUUID()}@example.test` })
      .returning();
    const actor: WorkActor = {
      id: other!.id,
      type: "regular",
      isActive: true,
      flags: new Set(["work.view"]),
      groupIds: new Set(),
    };
    const page = await new WorkService(test.db, actor, signal()).items({ archived: false });
    expect(page).toEqual({ ok: true, value: { items: [], nextCursor: null } });
  });
  it("rolls all additions back when audit recording fails", async () => {
    const p = await run({
      action: "preview",
      requestId: randomUUID(),
      presetId: "design",
      locale: "en",
      expectedRevision: 0,
      selection: { sales: true, delivery: true, dealFields: true, activityTypes: true },
    });
    if (!p.ok) throw Error("preview");
    // A real PostgreSQL constraint forces failure after all installer inserts.
    await test.db.execute(
      sql`ALTER TABLE audit_events ADD CONSTRAINT reject_work_apply CHECK (action <> 'work.apply')`,
    );
    const result = await run({
      action: "apply",
      requestId: randomUUID(),
      preview: p.value as never,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await test.db.select().from(pipelines)).toHaveLength(0);
    expect(await test.db.select().from(workTypes)).toHaveLength(0);
    expect(await test.db.select().from(workInstallations)).toHaveLength(0);
  });
});
