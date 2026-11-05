import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { customFieldDefs, organizations, pipelines, users, visibilityGroups } from "@/db/schema";
import type { WorkItem, WorkType } from "./contracts";
import type { WorkActor } from "./policy";
import { emptyPreferences } from "./read";
import { workInstallations, workItems, workTypes } from "./schema";
import { WorkService } from "./service";
import { type WorkFixture, workFixture } from "./work.test-helpers";

let f: WorkFixture;
beforeEach(async () => {
  f = await workFixture();
});
afterEach(async () => {
  await f.close();
});
describe("real PostgreSQL installer concurrency and configuration preservation", () => {
  it("rejects a preview after native configuration edits without partial installs", async () => {
    const preview = await f.preview();
    await f.db.insert(pipelines).values({ name: "A different team pipeline" });
    expect(await f.run({ action: "apply", requestId: randomUUID(), preview })).toMatchObject({
      ok: false,
      error: { code: "preview_stale" },
    });
    expect(await f.db.select().from(workTypes)).toHaveLength(0);
    expect(await f.db.select().from(workInstallations)).toHaveLength(0);
  });
  it("rejects stale preference revision and immutable request UUID reuse", async () => {
    const preview = await f.preview();
    const command = {
      action: "save_preferences" as const,
      requestId: randomUUID(),
      expectedRevision: 0,
      preferences: {
        ...emptyPreferences,
        workTypes: ["design" as const],
        primaryWorkType: "design" as const,
      },
    };
    expect((await f.run(command)).ok).toBe(true);
    expect(await f.run({ ...command, preferences: emptyPreferences })).toMatchObject({
      ok: false,
      error: { code: "replay_conflict" },
    });
    expect(await f.run({ action: "apply", requestId: randomUUID(), preview })).toMatchObject({
      ok: false,
      error: { code: "preview_stale" },
    });
  });
  it("serializes simultaneous same UUID applies and rejects a second UUID with stale preview", async () => {
    const command = {
      action: "apply" as const,
      requestId: randomUUID(),
      preview: await f.preview(),
    };
    const [a, b] = await Promise.all([f.run(command), f.run(command)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(await f.db.select().from(workTypes)).toHaveLength(1);
    expect(await f.db.select().from(pipelines)).toHaveLength(1);
    expect(await f.run({ ...command, requestId: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: "preview_stale" },
    });
    const fresh = await f.preview("vehicle_repair", "en", 1);
    expect(fresh.operations.every((v) => v.disposition === "reuse")).toBe(true);
    const reuse = await f.run({ ...command, requestId: randomUUID(), preview: fresh });
    expect(reuse.ok).toBe(true);
    expect(await f.db.select().from(workTypes)).toHaveLength(1);
  });
  it("installs all three localized presets as independent real delivery models", async () => {
    await f.install("vehicle_repair", "de", 0);
    await f.install("design", "fa", 1);
    await f.install("it_consulting", "en", 2);
    const types = await f.db.select().from(workTypes);
    expect(types).toHaveLength(3);
    expect(types.map((v) => v.kind).sort()).toEqual(["design", "it_consulting", "vehicle_repair"]);
    expect(await f.db.select().from(pipelines)).toHaveLength(3);
    expect(await f.db.select().from(customFieldDefs)).toHaveLength(3);
  });
  it("reports incompatible field collisions and never restores or overwrites the field", async () => {
    const preview = await f.preview();
    const field = preview.operations.find((v) => v.kind === "deal_field")!;
    await f.db.insert(customFieldDefs).values({
      targetEntity: "deal",
      key: field.key,
      name: "Existing protected field",
      type: "numeric",
      isRequired: true,
    });
    const collision = await f.preview();
    expect(collision.conflicts).toContain(field.key);
    expect(
      await f.run({ action: "apply", requestId: randomUUID(), preview: collision }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await f.db.select().from(pipelines)).toHaveLength(0);
    expect(await f.db.select().from(workTypes)).toHaveLength(0);
    expect((await f.db.select().from(customFieldDefs))[0]!.name).toBe("Existing protected field");
  });
  it("preserves edited additions and used stage/field configuration", async () => {
    const data = await f.install();
    const type = data.workTypes[0]!;
    const result = await f.run({
      action: "create_item",
      requestId: randomUUID(),
      item: { ...f.draft(type), values: { mileage: 12 } },
    });
    expect(result.ok).toBe(true);
    const base = {
      action: "configure_type" as const,
      requestId: randomUUID(),
      id: type.id,
      expectedRevision: type.revision,
      name: type.name,
      kind: type.kind,
      fields: type.fields,
      stages: type.stages.map(({ key, name, bucket }) => ({ key, name, bucket })),
    };
    expect(
      await f.run({ ...base, fields: type.fields.filter((v) => v.key !== "mileage") }),
    ).toMatchObject({ ok: false, error: { code: "in_use" } });
    expect(
      await f.run({ ...base, requestId: randomUUID(), stages: base.stages.slice(1) }),
    ).toMatchObject({ ok: false, error: { code: "in_use" } });
    expect(
      await f.run({
        action: "archive_type",
        requestId: randomUUID(),
        id: type.id,
        expectedRevision: type.revision,
        archived: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "in_use" } });
    await f.db.update(pipelines).set({ name: "Changed by an administrator" });
    expect(
      await f.run({
        action: "undo",
        requestId: randomUUID(),
        installationId: data.installation.id,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await f.db.select().from(workItems)).toHaveLength(1);
  });
});
describe("current operational permissions and references", () => {
  it("supports custom workflows, typed edits, board stage move, archive and recovery", async () => {
    const custom = await f.run({
      action: "configure_type",
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "Custom delivery",
      kind: "custom",
      fields: [
        { key: "approved", label: "Approved", type: "boolean", required: false, options: [] },
      ],
      stages: [
        { key: "new", name: "New", bucket: "open" },
        { key: "complete", name: "Complete", bucket: "complete" },
      ],
    });
    if (!custom.ok) throw Error(custom.error.code);
    const type = custom.value as WorkType;
    const create = {
      action: "create_item" as const,
      requestId: randomUUID(),
      item: { ...f.draft(type), values: { approved: false } },
    };
    const made = await f.run(create);
    if (!made.ok) throw Error(made.error.code);
    const item = made.value as WorkItem;
    const moved = await f.run({
      action: "update_item",
      requestId: randomUUID(),
      id: item.id,
      expectedRevision: 1,
      item: { ...create.item, stageId: type.stages[1]!.id, values: { approved: true } },
    });
    expect(moved).toMatchObject({ ok: true, value: { revision: 2, values: { approved: true } } });
    expect(
      await new WorkService(f.db, f.admin, f.signal()).operation(create.requestId),
    ).toMatchObject({ ok: true, value: { status: "complete", data: { id: item.id } } });
    expect(
      await f.run({
        action: "archive_item",
        requestId: randomUUID(),
        id: item.id,
        expectedRevision: 2,
        archived: true,
      }),
    ).toMatchObject({ ok: true, value: { isArchived: true, revision: 3 } });
    expect(
      await new WorkService(f.db, f.admin, f.signal()).items({ archived: false }),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });
  it("applies owner/group/all visibility and rejects hidden CRM references and inactive owners", async () => {
    const installed = await f.install();
    const type = installed.workTypes[0]!;
    const [member] = await f.db
      .insert(users)
      .values({ name: "Member", email: `${randomUUID()}@example.test` })
      .returning();
    const [inactive] = await f.db
      .insert(users)
      .values({ name: "Inactive", email: `${randomUUID()}@example.test`, isActive: false })
      .returning();
    const [group] = await f.db
      .insert(visibilityGroups)
      .values({ name: "Service team" })
      .returning();
    const actor: WorkActor = {
      id: member!.id,
      type: "regular",
      isActive: true,
      flags: new Set(["work.view", "work.create", "work.change"]),
      groupIds: new Set([group!.id]),
    };
    for (const visibility of ["owner", "group", "all"] as const)
      expect(
        (
          await f.run({
            action: "create_item",
            requestId: randomUUID(),
            item: {
              ...f.draft(type),
              visibility,
              visibilityGroupId: visibility === "group" ? group!.id : null,
            },
          })
        ).ok,
      ).toBe(true);
    const list = await new WorkService(f.db, actor, f.signal()).items({ archived: false });
    expect(list.ok && list.value.items.length).toBe(2);
    const [hidden] = await f.db
      .insert(organizations)
      .values({ name: "Private customer", ownerId: f.admin.id, visibilityLevel: "owner" })
      .returning();
    expect(
      await f.run(
        {
          action: "create_item",
          requestId: randomUUID(),
          item: { ...f.draft(type), ownerId: member!.id, organizationId: hidden!.id },
        },
        actor,
      ),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      await f.run({
        action: "create_item",
        requestId: randomUUID(),
        item: { ...f.draft(type), ownerId: inactive!.id },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(
      await f.run(
        { action: "create_item", requestId: randomUUID(), item: f.draft(type) },
        { ...actor, isActive: false },
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await new WorkService(f.db, { ...actor, groupIds: new Set() }, f.signal()).items({
        archived: false,
      }),
    ).toMatchObject({ ok: true, value: { items: expect.any(Array) } });
  });
});
