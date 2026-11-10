import { describe, expect, it } from "vitest";
import { planProjectCreation } from "./projectCreationPlan";
import {
  creationIds,
  creationInput,
  expectedCreationPlan,
  globalCreateCases,
  ineligibleStaffCases,
} from "./projectCreationPlan.test-support";

const unavailable = { ok: false, error: "project_creation_unavailable" };

describe("project creation plan from native staff facts", () => {
  it.each(globalCreateCases())("preserves global create semantics: $name", ({ input, allowed }) => {
    const result = planProjectCreation(input);
    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toEqual(unavailable);
  });

  it.each(ineligibleStaffCases())("denies unaccepted or inactive staff: $name", ({ input }) => {
    expect(planProjectCreation(input)).toEqual(unavailable);
  });

  it.each(["regular", "admin"] as const)(
    "rejects a creator record belonging to another user for %s actors",
    (type) => {
      const input = creationInput(type);
      input.creator.id = creationIds.other;
      expect(planProjectCreation(input)).toEqual(unavailable);
    },
  );

  it("uses ownership without an additional creator member row when both users are equal", () => {
    const input = creationInput();
    input.selectedOwner = { ...input.creator };
    expect(planProjectCreation(input)).toEqual({
      ok: true,
      value: {
        ownerUserId: creationIds.creator,
        initial: { state: "planned", revision: 0, archivedFrom: null },
        creatorMembership: null,
      },
    });
  });

  it("accepts an eligible selected owner without requiring that owner's global create grant", () => {
    const input = creationInput();
    expect(Object.keys(input.selectedOwner).sort()).toEqual(["id", "invitedAt", "isActive"]);
    expect(planProjectCreation(input)).toEqual({ ok: true, value: expectedCreationPlan() });
  });

  it("plans only the fixed initial state and one creator read/edit row without copied workspace grants", () => {
    const input = creationInput("admin");
    input.actor.flags = new Set(["project.create", "permissions.manage", "deal.create"]);
    const result = planProjectCreation(input);
    expect(result).toEqual({ ok: true, value: expectedCreationPlan() });
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "creatorMembership",
      "initial",
      "ownerUserId",
    ]);
    expect(Object.keys(result.value.initial).sort()).toEqual(["archivedFrom", "revision", "state"]);
    expect(Object.keys(result.value.creatorMembership ?? {}).sort()).toEqual([
      "assignmentCoordinate",
      "projectEdit",
      "userId",
    ]);
  });

  it("does not mutate or freeze caller-owned actor and staff facts", () => {
    const input = creationInput();
    const before = structuredClone(input);
    expect(planProjectCreation(input)).toEqual({ ok: true, value: expectedCreationPlan() });
    expect(input).toEqual(before);
    for (const value of [
      input,
      input.actor,
      input.actor.flags,
      input.actor.groupIds,
      input.creator,
      input.selectedOwner,
    ]) {
      expect(Object.isFrozen(value)).toBe(false);
    }
  });

  it("does not let edits to one output alter input facts or another creation plan", () => {
    const input = creationInput();
    const before = structuredClone(input);
    const first = planProjectCreation(input);
    const second = planProjectCreation(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.creatorMembership).not.toBeNull();
    if (first.value.creatorMembership === null) return;
    Reflect.set(first.value.initial, "state", "active");
    Reflect.set(first.value.initial, "revision", 99);
    Reflect.set(first.value.creatorMembership, "userId", creationIds.owner);
    Reflect.set(first.value.creatorMembership, "projectEdit", false);
    Reflect.set(first.value.creatorMembership, "assignmentCoordinate", true);
    expect(input).toEqual(before);
    expect(second).toEqual({ ok: true, value: expectedCreationPlan() });
    expect(planProjectCreation(input)).toEqual({ ok: true, value: expectedCreationPlan() });
  });

  it("does not alias an earlier result to subsequently changed caller identities", () => {
    const input = creationInput();
    const result = planProjectCreation(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input.selectedOwner.id = creationIds.other;
    input.creator.id = creationIds.owner;
    input.actor.id = creationIds.owner;
    expect(result).toEqual({ ok: true, value: expectedCreationPlan() });
    expect(planProjectCreation(input)).toEqual({
      ok: true,
      value: {
        ownerUserId: creationIds.other,
        initial: { state: "planned", revision: 0, archivedFrom: null },
        creatorMembership: {
          userId: creationIds.owner,
          projectEdit: true,
          assignmentCoordinate: false,
        },
      },
    });
  });
});
