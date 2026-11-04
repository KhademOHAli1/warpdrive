import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { customFieldDefs } from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { prepareCurrentCustomFieldValidation } from "./currentValidation";
import { listDefs } from "./defsRepo";

const signal = new AbortController().signal;

it("prepares current definitions despite a previously warmed canonical cache", async () => {
  const test = await makeTestDb();
  try {
    expect(await listDefs(test.db, "activity", {}, signal)).toEqual([]);
    const [field] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: "numeric",
        key: "effort",
        name: "Effort",
        isRequired: true,
      })
      .returning();
    assert(field !== undefined);
    const prepared = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    expect(prepared.defs.map((def) => def.id)).toEqual([field.id]);
    expect(prepared.parseByKey({ effort: 0 })).toEqual({ success: true, data: { effort: 0 } });
    expect(prepared.parseByKey({}).success).toBe(false);
  } finally {
    await test.close();
  }
});

it("retains one prepared option snapshot while a later preparation sees changed options", async () => {
  const test = await makeTestDb();
  try {
    const [field] = await test.db
      .insert(customFieldDefs)
      .values({
        targetEntity: "activity",
        type: "single_option",
        key: "choice",
        name: "Choice",
        options: [{ id: "old", label: "Old" }],
      })
      .returning();
    assert(field !== undefined);
    const original = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    await test.db
      .update(customFieldDefs)
      .set({
        options: [
          { id: "old", label: "Old", archived: true },
          { id: "new", label: "New" },
        ],
      })
      .where(eq(customFieldDefs.id, field.id));
    expect(original.parseByKey({ choice: "old" }).success).toBe(true);
    const current = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    expect(current.parseByKey({ choice: "old" }).success).toBe(false);
    expect(current.parseByKey({ choice: "new" }).success).toBe(true);
  } finally {
    await test.close();
  }
});

it("rejects unknown canonical and nested rich keys instead of silently stripping them", async () => {
  const test = await makeTestDb();
  try {
    await test.db.insert(customFieldDefs).values([
      { targetEntity: "activity", type: "address", key: "place", name: "Place" },
      { targetEntity: "activity", type: "date_range", key: "window", name: "Window" },
    ]);
    const prepared = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    expect(prepared.parseByKey({ unknown: "must not disappear" }).success).toBe(false);
    expect(
      prepared.parseByKey({ place: { country: "DE", extra: "must not disappear" } }).success,
    ).toBe(false);
    expect(
      prepared.parseByKey({ window: { start: "2026-11-04", end: "2026-11-05", extra: true } })
        .success,
    ).toBe(false);
    expect(
      prepared.parseByKey({
        place: { country: "DE", lat: 0 },
        window: { start: "2026-11-04", end: "2026-11-05" },
      }).success,
    ).toBe(true);
  } finally {
    await test.close();
  }
});

it("uses isRequired rather than important and keeps omitted custom values distinct from null", async () => {
  const test = await makeTestDb();
  try {
    await test.db.insert(customFieldDefs).values([
      {
        targetEntity: "activity",
        type: "text",
        key: "important",
        name: "Important",
        isImportant: true,
      },
      { targetEntity: "activity", type: "numeric", key: "zero", name: "Zero", isRequired: true },
    ]);
    const prepared = await prepareCurrentCustomFieldValidation(test.db, "activity", signal);
    expect(prepared.parseByKey({ zero: 0 })).toEqual({ success: true, data: { zero: 0 } });
    expect(prepared.parseByKey({ zero: 0, important: null }).success).toBe(false);
    expect(prepared.parseByKey({ zero: "0" }).success).toBe(false);
    expect(prepared.parseByKey({ zero: null }).success).toBe(false);
    const controller = new AbortController();
    const reason = new Error("cancel preparation");
    controller.abort(reason);
    await expect(
      prepareCurrentCustomFieldValidation(test.db, "activity", controller.signal),
    ).rejects.toBe(reason);
  } finally {
    await test.close();
  }
});
