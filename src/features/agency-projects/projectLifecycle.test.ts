import { describe, expect, it } from "vitest";
import {
  type ProjectAction,
  type ProjectSnapshot,
  type ProjectState,
  transitionProject,
} from "./projectLifecycle";

const states: ProjectState[] = [
  "planned",
  "active",
  "on-hold",
  "completed",
  "canceled",
  "archived",
];
const actions: ProjectAction[] = [
  "start",
  "hold",
  "resume",
  "complete",
  "cancel",
  "archive",
  "restore",
  "reopen",
];
// This is the proposed production policy, independently specified from the implementation.
const allowed: Partial<Record<ProjectState, Partial<Record<ProjectAction, ProjectState>>>> = {
  planned: { start: "active", cancel: "canceled", archive: "archived" },
  active: { hold: "on-hold", complete: "completed", cancel: "canceled", archive: "archived" },
  "on-hold": { resume: "active", cancel: "canceled", archive: "archived" },
  completed: { reopen: "planned", archive: "archived" },
  canceled: { reopen: "planned", archive: "archived" },
  archived: { restore: "completed" },
};

describe("project lifecycle policy v1", () => {
  it("rejects a stale producer command without advancing the project", () => {
    expect(
      transitionProject(
        { state: "planned", revision: 7, archivedFrom: null },
        { action: "start", expectedRevision: 6 },
      ),
    ).toEqual({ ok: false, error: "revision_conflict" });
  });

  it("starts a planned project with exactly one revision advance", () => {
    expect(
      transitionProject(
        { state: "planned", revision: 7, archivedFrom: null },
        { action: "start", expectedRevision: 7 },
      ),
    ).toEqual({
      ok: true,
      value: {
        next: { state: "active", revision: 8, archivedFrom: null },
        receipt: {
          policyVersion: 1,
          action: "start",
          from: "planned",
          to: "active",
          previousRevision: 7,
          revision: 8,
          reason: null,
        },
      },
    });
  });

  for (const state of states) {
    for (const action of actions) {
      const to = allowed[state]?.[action];
      it(`${state} ${action}: ${to ?? "forbidden"}`, () => {
        const current =
          state === "archived"
            ? { state, revision: 9, archivedFrom: "completed" as const }
            : { state, revision: 9, archivedFrom: null };
        const result = transitionProject(current, {
          action,
          expectedRevision: 9,
          reason: "تغییر برنامه / Kundenwunsch",
        });
        if (to === undefined) {
          expect(result).toEqual({ ok: false, error: "invalid_transition" });
        } else {
          expect(result).toMatchObject({
            ok: true,
            value: {
              next: { state: to, revision: 10, archivedFrom: to === "archived" ? state : null },
              receipt: { policyVersion: 1, from: state, to, previousRevision: 9, revision: 10 },
            },
          });
        }
      });
    }
  }

  it.each(["hold", "cancel", "archive", "restore", "reopen"] as const)(
    "requires a recorded reason for %s",
    (action) => {
      const state =
        action === "reopen" ? "completed" : action === "restore" ? "archived" : "active";
      const current: ProjectSnapshot =
        state === "archived"
          ? { state, revision: 1, archivedFrom: "canceled" as const }
          : { state, revision: 1, archivedFrom: null };
      expect(transitionProject(current, { action, expectedRevision: 1, reason: "  " })).toEqual({
        ok: false,
        error: "reason_required",
      });
    },
  );

  it.each(["planned", "active", "on-hold", "completed", "canceled"] as const)(
    "restores archived %s without silently reopening terminal work",
    (state) => {
      const current = Object.freeze({ state, revision: 3, archivedFrom: null });
      const archived = transitionProject(current, {
        action: "archive",
        expectedRevision: 3,
        reason: "Pause",
      });
      expect(archived.ok).toBe(true);
      if (!archived.ok) return;
      const receipt = structuredClone(archived.value.receipt);
      const restored = transitionProject(archived.value.next, {
        action: "restore",
        expectedRevision: 4,
        reason: "Wiederherstellen",
      });
      expect(restored).toMatchObject({
        ok: true,
        value: { next: { state, revision: 5, archivedFrom: null } },
      });
      expect(current).toEqual({ state, revision: 3, archivedFrom: null });
      expect(archived.value.receipt).toEqual(receipt);
    },
  );

  it("gives revision conflict precedence over a now invalid action", () => {
    expect(
      transitionProject(
        { state: "completed", revision: 5, archivedFrom: null },
        { action: "start", expectedRevision: 4 },
      ),
    ).toEqual({ ok: false, error: "revision_conflict" });
  });

  it("fences replay of an already applied logical command", () => {
    const current = { state: "planned" as const, revision: 7, archivedFrom: null };
    const command = { action: "start" as const, expectedRevision: 7 };
    const first = transitionProject(current, command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(transitionProject(first.value.next, command)).toEqual({
      ok: false,
      error: "revision_conflict",
    });
  });

  it("does not exceed the representable revision range", () => {
    expect(
      transitionProject(
        { state: "planned", revision: Number.MAX_SAFE_INTEGER, archivedFrom: null },
        { action: "start", expectedRevision: Number.MAX_SAFE_INTEGER },
      ),
    ).toEqual({ ok: false, error: "revision_exhausted" });
  });
});
