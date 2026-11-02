import { describe, expect, it } from "vitest";
import { transitionProject } from "./projectLifecycle";
import {
  checkProjectLocalAction,
  hasProjectAssignmentCoordinateEligibility,
  transitionProjectForLocalActor,
} from "./projectLocalAccess";
import {
  actions,
  actorTypes,
  contentDenied,
  context,
  denied,
  deniedContexts,
  editableRows,
  editingRows,
  expectedAccess,
  expectedCoordinate,
  expectedStartResult,
  forgedCommandFields,
  formerOwnerRows,
  granted,
  graphRows,
  inactiveOwnerId,
  otherUserId,
  reasonRows,
  relationRows,
  reopenRows,
  restoreRows,
  snapshot,
  states,
  wrongScopeRows,
} from "./projectLocalAccess.test-support";
import { projectCommandSchema, projectSnapshotSchema } from "./projectSchemas";

describe("project-local eligibility from trusted server facts", () => {
  it.each(relationRows)("%s %s: complete local action table", (type, relation) => {
    const current = context(type, relation);
    for (const action of actions) {
      expect({
        action,
        result: checkProjectLocalAction(current, snapshot("active"), action),
      }).toEqual({
        action,
        result: expectedAccess(relation, action),
      });
    }
  });

  it.each(relationRows)("%s %s: independent assignment-coordinate grant", (type, relation) => {
    expect(hasProjectAssignmentCoordinateEligibility(context(type, relation))).toBe(
      expectedCoordinate(relation),
    );
  });

  it.each(wrongScopeRows)("%s mismatched member row %s grants nothing", (type, _index, row) => {
    const current = { ...context(type, "both"), membership: row };
    for (const action of actions) {
      expect(checkProjectLocalAction(current, snapshot("active"), action)).toEqual(denied);
    }
    expect(hasProjectAssignmentCoordinateEligibility(current)).toBe(false);
  });

  it.each(relationRows)("inactive %s %s has no local eligibility", (type, relation) => {
    const current = context(type, relation);
    current.actor.isActive = false;
    for (const action of actions) {
      expect(checkProjectLocalAction(current, snapshot("active"), action)).toEqual(denied);
    }
    expect(hasProjectAssignmentCoordinateEligibility(current)).toBe(false);
  });

  it.each(editableRows)("%s %s content edits respect every lifecycle state", (type, relation) => {
    for (const state of states) {
      const expected = ["planned", "active", "on-hold"].includes(state) ? granted : contentDenied;
      expect({
        state,
        result: checkProjectLocalAction(context(type, relation), snapshot(state), "edit-content"),
      }).toEqual({ state, result: expected });
    }
  });

  it.each(actorTypes)("%s owner can maintain access in every state", (type) => {
    for (const state of states) {
      for (const action of ["manage-members", "transfer-owner"] as const) {
        expect(checkProjectLocalAction(context(type, "owner"), snapshot(state), action)).toEqual(
          granted,
        );
      }
    }
  });

  it.each(actorTypes)("%s without edit eligibility receives no terminal-state detail", (type) => {
    for (const relation of ["outsider", "read", "coordinate"] as const) {
      for (const state of ["completed", "canceled", "archived"] as const) {
        expect(
          checkProjectLocalAction(context(type, relation), snapshot(state), "edit-content"),
        ).toEqual(denied);
      }
    }
  });

  it.each(wrongScopeRows)("%s ownership does not depend on member row %s", (type, _index, row) => {
    const current = { ...context(type, "owner"), membership: row };
    for (const action of actions) {
      expect(checkProjectLocalAction(current, snapshot("active"), action)).toEqual(granted);
    }
    expect(hasProjectAssignmentCoordinateEligibility(current)).toBe(true);
  });

  it.each(formerOwnerRows)(
    "%s former owner retains only explicit %s membership",
    (type, relation) => {
      const after = context(type, relation);
      const before = { ...after, ownerUserId: after.actor.id };
      const membershipBefore = structuredClone(after.membership);
      expect(checkProjectLocalAction(before, snapshot("active"), "transfer-owner")).toEqual(
        granted,
      );
      for (const action of actions) {
        expect({
          action,
          result: checkProjectLocalAction(after, snapshot("active"), action),
        }).toEqual({
          action,
          result: expectedAccess(relation, action),
        });
      }
      expect(hasProjectAssignmentCoordinateEligibility(after)).toBe(expectedCoordinate(relation));
      expect(after.membership).toEqual(membershipBefore);
      expect(after.ownerUserId).toBe(otherUserId);
    },
  );

  it.each(actorTypes)("%s active member needs no owner-active context field", (type) => {
    const current = { ...context(type, "edit"), ownerUserId: inactiveOwnerId };
    expect(Object.keys(current).sort()).toEqual([
      "actor",
      "membership",
      "ownerUserId",
      "projectId",
    ]);
    expect(checkProjectLocalAction(current, snapshot(), "read")).toEqual(granted);
    expect(checkProjectLocalAction(current, snapshot(), "edit-content")).toEqual(granted);
    expect(
      transitionProjectForLocalActor(current, snapshot(), { action: "start", expectedRevision: 7 }),
    ).toMatchObject({ ok: true, value: { next: { state: "active", revision: 8 } } });
  });

  it.each(forgedCommandFields)("browser source schemas reject forged %s", (field) => {
    const forged = { [field]: context("admin", "owner") };
    expect(
      projectCommandSchema.safeParse({ action: "start", expectedRevision: 7, ...forged }).success,
    ).toBe(false);
    expect(projectSnapshotSchema.safeParse({ ...snapshot(), ...forged }).success).toBe(false);
  });
});

describe("local-first lifecycle delegation", () => {
  it.each(graphRows)("owner %s %s preserves the existing policy result", (state, action) => {
    const current = snapshot(state);
    const command = { action, expectedRevision: 7, reason: "تغییر برنامه / Änderung" };
    expect(checkProjectLocalAction(context("regular", "owner"), current, action)).toEqual(granted);
    expect(transitionProjectForLocalActor(context("regular", "owner"), current, command)).toEqual(
      transitionProject(current, command),
    );
  });

  it.each(deniedContexts)(
    "%s %s is denied before revision, graph or reason disclosure",
    (_type, _name, actor) => {
      for (const state of ["planned", "completed", "archived"] as const) {
        for (const revision of [7, Number.MAX_SAFE_INTEGER]) {
          const current = snapshot(state, revision);
          for (const expectedRevision of [0, revision]) {
            expect(
              transitionProjectForLocalActor(actor, current, {
                action: "cancel",
                expectedRevision,
              }),
            ).toEqual(denied);
          }
        }
      }
    },
  );

  it.each(editingRows)(
    "%s %s receives the real revision conflict after eligibility",
    (type, relation) => {
      expect(
        transitionProjectForLocalActor(context(type, relation), snapshot("completed"), {
          action: "start",
          expectedRevision: 6,
        }),
      ).toEqual({ ok: false, error: "revision_conflict" });
    },
  );

  it.each(reasonRows)("%s owner %s still requires a reason", (type, action) => {
    const state = action === "restore" ? "archived" : action === "reopen" ? "completed" : "active";
    expect(
      transitionProjectForLocalActor(context(type, "owner"), snapshot(state), {
        action,
        expectedRevision: 7,
        reason: " \t\n",
      }),
    ).toEqual({ ok: false, error: "reason_required" });
  });

  it.each(restoreRows)("%s restores archived %s without reopening it", (type, archivedFrom) => {
    const restored = transitionProjectForLocalActor(
      context(type, "owner"),
      snapshot("archived", 7, archivedFrom),
      {
        action: "restore",
        expectedRevision: 7,
        reason: "Wiederherstellen",
      },
    );
    expect(restored).toMatchObject({
      ok: true,
      value: { next: { state: archivedFrom, revision: 8, archivedFrom: null } },
    });
    if (restored.ok && (archivedFrom === "completed" || archivedFrom === "canceled")) {
      expect(
        checkProjectLocalAction(context(type, "owner"), restored.value.next, "edit-content"),
      ).toEqual(contentDenied);
    }
  });

  it.each(reopenRows)("%s explicitly reopens %s to planned", (type, state) => {
    expect(
      transitionProjectForLocalActor(context(type, "owner"), snapshot(state), {
        action: "reopen",
        expectedRevision: 7,
        reason: "Neue Produktion",
      }),
    ).toMatchObject({
      ok: true,
      value: { next: { state: "planned", revision: 8, archivedFrom: null } },
    });
    expect(
      transitionProjectForLocalActor(context(type, "owner"), snapshot("archived", 7, state), {
        action: "reopen",
        expectedRevision: 7,
        reason: "Kein direkter Neustart",
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it.each(editingRows)("%s %s cannot overflow revision", (type, relation) => {
    expect(
      transitionProjectForLocalActor(
        context(type, relation),
        snapshot("planned", Number.MAX_SAFE_INTEGER),
        {
          action: "start",
          expectedRevision: Number.MAX_SAFE_INTEGER,
        },
      ),
    ).toEqual({ ok: false, error: "revision_exhausted" });
  });

  it.each(actorTypes)("%s delegation preserves exact receipt and caller facts", (type) => {
    const current = context(type, "owner");
    const project = snapshot();
    const command = projectCommandSchema.parse({
      action: "start",
      expectedRevision: 7,
      reason: "  هماهنگی / Abstimmung  ",
    });
    const before = structuredClone({ current, project, command });
    Object.freeze(current.actor);
    Object.freeze(current);
    Object.freeze(project);
    Object.freeze(command);
    expect(transitionProjectForLocalActor(current, project, command)).toEqual(expectedStartResult);
    expect({ current, project, command }).toEqual(before);
  });
});
