import { describe, expect, it } from "vitest";
import { uiSchema } from "./preferencesSchema";

const VIEW_ID = "11111111-1111-4111-8111-111111111111";
const SELECTION_KEYS = [
  "peopleSavedViewSelection",
  "orgsSavedViewSelection",
  "leadsSavedViewSelection",
] as const;

describe("native selected-view preference read boundary", () => {
  it.each(SELECTION_KEYS)("round-trips %s independently of the personal baseline", (key) => {
    const selection = { version: 1, savedViewId: VIEW_ID };
    const result = uiSchema.parse({
      [key]: selection,
      peopleView: ["name", "phone"],
      orgsView: ["name", "address"],
      leadsView: { columns: ["title"], sort: { field: "createdAt", dir: "desc" } },
    });
    expect(result).toHaveProperty(key, selection);
    expect(result.peopleView).toEqual(["name", "phone"]);
    expect(result.orgsView).toEqual(["name", "address"]);
    expect(result.leadsView?.columns).toEqual(["title"]);
  });

  it.each(SELECTION_KEYS)("preserves an explicit Clear in %s", (key) => {
    expect(uiSchema.parse({ [key]: { version: 1, savedViewId: null } })).toHaveProperty(key, {
      version: 1,
      savedViewId: null,
    });
  });

  it.each(SELECTION_KEYS)("leaves an absent %s absent", (key) => {
    expect(uiSchema.parse({})).not.toHaveProperty(key);
  });

  for (const malformed of [
    null,
    "view-id",
    {},
    { version: 2, savedViewId: VIEW_ID },
    { version: 1, savedViewId: "not-a-uuid" },
    { version: 1 },
    { version: 1, savedViewId: VIEW_ID, definition: { conditions: [] } },
  ]) {
    it.each(SELECTION_KEYS)(
      `blocks malformed %s ${JSON.stringify(malformed)} without losing sibling preferences`,
      (key) => {
        const result = uiSchema.parse({
          [key]: malformed,
          winSound: true,
          peopleView: ["name", "phone"],
        });
        expect(result).toHaveProperty(key, expect.objectContaining({ status: "blocked" }));
        expect(result.winSound).toBe(true);
        expect(result.peopleView).toEqual(["name", "phone"]);
      },
    );
  }
});
