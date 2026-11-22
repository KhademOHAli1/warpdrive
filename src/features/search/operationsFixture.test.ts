import { describe, expect, it } from "vitest";
import { searchOperationsFixture } from "./operationsFilter";
import { projectOperationsSearchFixture } from "./operationsFixture";

const actor = { id: "f84464e9-a088-415b-b0d1-2601dc574d46", name: "Demo operator" };

describe("workspace operations search fixture", () => {
  it("finds exact directory and booking IDs for an overlapping site term", () => {
    const entries = projectOperationsSearchFixture({ ...actor, canManage: true });
    const matches = searchOperationsFixture(entries, "automation WORKS");
    expect(matches.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "8d94b6eb-80b1-4004-8143-97f2a9ff788f", kind: "location" },
      { id: "3eb14261-429a-456b-bca3-8aaba9d0e74e", kind: "location" },
      { id: "34022ee2-32f1-426d-9c4d-ff3d78493610", kind: "location" },
      { id: "265e02cf-1208-480a-88a4-5931477f5273", kind: "booking" },
    ]);
  });

  it("projects the same exact own-booking link for a signed-in demo non-manager", () => {
    const entries = projectOperationsSearchFixture({ ...actor, canManage: false });
    expect(searchOperationsFixture(entries, "cabinet verification")).toEqual([
      {
        id: "265e02cf-1208-480a-88a4-5931477f5273",
        kind: "booking",
        primary: "Bench meter for control cabinet verification",
        secondary: "Automation Works",
      },
    ]);
    expect(searchOperationsFixture(entries, "Mara Keller")).toEqual([]);
    expect(searchOperationsFixture(undefined, "Warehouse")).toEqual([]);
  });
});
