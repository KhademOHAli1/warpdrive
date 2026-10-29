import { describe, expect, it } from "vitest";
import { filterDefinition } from "@/features/saved-filters/schemas";
import { buildSavedFilterSeeds } from "./seed-demo-collab";

// Guards the silent-no-op class: a seeded saved filter whose stored definition uses keys the
// FilterDefinition schema strips parses to a degenerate/empty filter and narrows nothing. Every
// seeded definition must be valid, retain every stored key, and narrow the result set.
describe("buildSavedFilterSeeds", () => {
  const userIds = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];

  it("emits only deal-target filters (activities do not consume saved_filters)", () => {
    for (const s of buildSavedFilterSeeds(userIds)) {
      expect(s.target).toBe("deal");
    }
  });

  it("every seeded definition conforms to the filter schema (no lossy/invalid/degenerate)", () => {
    for (const s of buildSavedFilterSeeds(userIds)) {
      const parsed = filterDefinition.parse(s.def);
      expect(parsed, `filter "${s.name}" must preserve its stored fields`).toMatchObject(s.def);
      expect(parsed.conditions.length > 0 || parsed.rotting === true).toBe(true);
    }
  });

  it('"My open deals" narrows to the owner\'s open deals', () => {
    const seeds = buildSavedFilterSeeds(userIds);
    const mine = seeds.find((s) => s.name === "My open deals");
    expect(mine).toBeDefined();
    expect(mine?.def).toEqual({
      conditions: [
        { field: "status", op: "eq", value: "open" },
        { field: "ownerId", op: "eq", value: userIds[0] },
      ],
    });
    expect(mine?.ownerId).toBe(userIds[0]);
  });

  it("returns no rows when there are no users", () => {
    expect(buildSavedFilterSeeds([])).toEqual([]);
  });
});
