import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { pipelines, savedFilters, stages } from "@/db/schema";
import { workItemSchema } from "./contracts";
import { WorkService } from "./service";
import { type WorkFixture, workFixture } from "./work.test-helpers";

let f: WorkFixture;
beforeEach(async () => {
  f = await workFixture();
});
afterEach(async () => {
  await f.close();
});
it("preserves complete installation when a saved filter references an installed sales stage", async () => {
  const installed = await f.install();
  const stage = (await f.db.select().from(stages))[0]!;
  await f.db.insert(savedFilters).values({
    name: "Stage filter",
    ownerId: f.admin.id,
    targetEntity: "deal",
    definition: { stageId: stage.id },
  });
  expect(
    await f.run({
      action: "undo",
      requestId: randomUUID(),
      installationId: installed.installation.id,
    }),
  ).toMatchObject({ ok: false, error: { code: "in_use" } });
  expect(await f.db.select().from(pipelines)).toHaveLength(1);
});
it("does not restore an archived item into an archived work type", async () => {
  const type = (await f.install()).workTypes[0]!;
  const made = await f.run({ action: "create_item", requestId: randomUUID(), item: f.draft(type) });
  if (!made.ok) throw Error(made.error.code);
  const item = workItemSchema.parse(made.value);
  expect(
    (
      await f.run({
        action: "archive_item",
        requestId: randomUUID(),
        id: item.id,
        expectedRevision: item.revision,
        archived: true,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await f.run({
        action: "archive_type",
        requestId: randomUUID(),
        id: type.id,
        expectedRevision: type.revision,
        archived: true,
      })
    ).ok,
  ).toBe(true);
  expect(
    await f.run({
      action: "archive_item",
      requestId: randomUUID(),
      id: item.id,
      expectedRevision: item.revision + 1,
      archived: false,
    }),
  ).toMatchObject({ ok: false, error: { code: "in_use" } });
  expect(await new WorkService(f.db, f.admin, f.signal()).items({ archived: false })).toMatchObject(
    { ok: true, value: { items: [] } },
  );
});
