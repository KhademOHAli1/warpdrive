import { describe, expect, it } from "vitest";
import { projectCommandSchema, projectSnapshotSchema } from "./projectSchemas";

describe("project policy boundary", () => {
  it("preserves a staff reason in Persian and German", () => {
    expect(
      projectCommandSchema.parse({
        action: "cancel",
        expectedRevision: 8,
        reason: "  تغییر برنامه / Änderung  ",
      }),
    ).toEqual({ action: "cancel", expectedRevision: 8, reason: "تغییر برنامه / Änderung" });
  });

  it.each([
    {},
    { action: "start" },
    { action: "send", expectedRevision: 1 },
    { action: "start", expectedRevision: 1, authorized: true },
    { action: "start", expectedRevision: 1, actorId: "external-person" },
  ])("denies unsupported command data: %j", (input) => {
    expect(projectCommandSchema.safeParse(input).success).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "7", null])(
    "rejects invalid expected revision %s",
    (expectedRevision) => {
      expect(projectCommandSchema.safeParse({ action: "start", expectedRevision }).success).toBe(
        false,
      );
    },
  );

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid stored revision %s",
    (revision) => {
      expect(
        projectSnapshotSchema.safeParse({ state: "planned", revision, archivedFrom: null }).success,
      ).toBe(false);
    },
  );

  it("accepts zero and the largest exact stored revision for the exhaustion policy", () => {
    for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
      expect(
        projectSnapshotSchema.safeParse({ state: "planned", revision, archivedFrom: null }).success,
      ).toBe(true);
    }
  });

  it.each([
    { state: "archived", revision: 1, archivedFrom: null },
    { state: "archived", revision: 1, archivedFrom: "archived" },
    { state: "active", revision: 1, archivedFrom: "completed" },
    { state: "deleted", revision: 1, archivedFrom: null },
    { state: "planned", revision: 1 },
  ])("rejects incoherent archive history: %j", (input) => {
    expect(projectSnapshotSchema.safeParse(input).success).toBe(false);
  });

  it("accepts a coherent archived snapshot", () => {
    expect(
      projectSnapshotSchema.parse({ state: "archived", revision: 2, archivedFrom: "completed" }),
    ).toEqual({ state: "archived", revision: 2, archivedFrom: "completed" });
  });

  it.each(["x".repeat(2001), "reason\u0000hidden"])(
    "rejects unbounded or control-containing reasons",
    (reason) => {
      expect(
        projectCommandSchema.safeParse({ action: "cancel", expectedRevision: 1, reason }).success,
      ).toBe(false);
    },
  );
});
