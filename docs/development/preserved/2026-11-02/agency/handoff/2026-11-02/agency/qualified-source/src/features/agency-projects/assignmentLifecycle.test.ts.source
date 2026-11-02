import { describe, expect, it } from "vitest";
import {
  acceptance,
  command,
  freelancerContactId,
  snapshot,
  staffUserId,
} from "./assignmentFixtures";
import {
  type AssignmentAction,
  type AssignmentState,
  transitionAssignment,
} from "./assignmentLifecycle";

const states: AssignmentState[] = [
  "awaiting-acceptance",
  "working",
  "submitted",
  "internal-review",
  "changes-requested",
  "approved",
  "canceled",
];
const actions: AssignmentAction[] = [
  "record-acceptance",
  "submit",
  "begin-review",
  "request-changes",
  "resume-work",
  "approve",
  "cancel",
];
const allowed: Partial<
  Record<AssignmentState, Partial<Record<AssignmentAction, AssignmentState>>>
> = {
  "awaiting-acceptance": { "record-acceptance": "working", cancel: "canceled" },
  working: { submit: "submitted", cancel: "canceled" },
  submitted: { "begin-review": "internal-review", cancel: "canceled" },
  "internal-review": {
    "request-changes": "changes-requested",
    approve: "approved",
    cancel: "canceled",
  },
  "changes-requested": { "resume-work": "working", cancel: "canceled" },
};

describe("assignment lifecycle policy v1", () => {
  it("rejects a stale command before evaluating its current meaning", () => {
    expect(
      transitionAssignment(
        snapshot("approved"),
        { ...command("submit"), expectedRevision: 1 },
        "archived",
      ),
    ).toEqual({ ok: false, error: "revision_conflict" });
  });

  for (const state of states) {
    for (const action of actions) {
      const to = allowed[state]?.[action];
      it(`${state} ${action}: ${to ?? "forbidden"}`, () => {
        const current = Object.freeze(snapshot(state));
        const result = transitionAssignment(current, command(action), "active");
        if (to === undefined) {
          expect(result).toEqual({ ok: false, error: "invalid_transition" });
        } else {
          expect(result).toMatchObject({
            ok: true,
            value: {
              next: {
                state: to,
                revision: 3,
                freelancerContactId,
                internalOwnerUserId: staffUserId,
              },
              receipt: {
                policyVersion: 1,
                action,
                from: state,
                to,
                previousRevision: 2,
                revision: 3,
                recordedByUserId: staffUserId,
              },
            },
          });
          expect(current).toEqual(snapshot(state));
        }
      });
    }
  }

  it("records externally received acceptance as staff evidence, without external authentication", () => {
    const result = transitionAssignment(snapshot(), command("record-acceptance"), "active");
    expect(result).toMatchObject({
      ok: true,
      value: {
        next: { acceptance },
        receipt: {
          provenance: {
            source: "staff-recorded",
            recordedByUserId: staffUserId,
            freelancerContactId,
            evidenceReference: "call-note-42",
          },
        },
      },
    });
    if (!result.ok) return;
    expect(result.value.next).not.toHaveProperty("userId");
    expect(result.value.receipt).not.toHaveProperty("authenticatedFreelancer");
  });

  it("rejects evidence about a different freelancer contact", () => {
    expect(
      transitionAssignment(
        snapshot(),
        {
          ...command("record-acceptance"),
          action: "record-acceptance",
          freelancerContactId: "different-person",
          evidenceReference: "note",
        },
        "active",
      ),
    ).toEqual({ ok: false, error: "acceptance_contact_mismatch" });
  });

  it("requires acceptance evidence and a recording staff actor", () => {
    expect(
      transitionAssignment(
        snapshot(),
        {
          action: "record-acceptance",
          expectedRevision: 2,
          recordedByUserId: staffUserId,
          freelancerContactId,
          evidenceReference: "  ",
        },
        "active",
      ),
    ).toEqual({ ok: false, error: "acceptance_evidence_required" });
    expect(
      transitionAssignment(
        snapshot(),
        { ...command("record-acceptance"), recordedByUserId: " " },
        "active",
      ),
    ).toEqual({ ok: false, error: "actor_required" });
  });

  it.each(["planned", "on-hold", "completed", "canceled", "archived"] as const)(
    "fences progress while the project is %s, preserving cancellation cleanup",
    (projectState) => {
      expect(transitionAssignment(snapshot("working"), command("submit"), projectState)).toEqual({
        ok: false,
        error: "project_not_active",
      });
      expect(
        transitionAssignment(snapshot("working"), command("cancel"), projectState),
      ).toMatchObject({ ok: true, value: { next: { state: "canceled" } } });
    },
  );

  it.each(["request-changes", "cancel"] as const)("requires a reason for %s", (action) => {
    expect(
      transitionAssignment(
        snapshot("internal-review"),
        { ...command(action), action, reason: " " },
        "active",
      ),
    ).toEqual({ ok: false, error: "reason_required" });
  });

  it("binds internal approval to the reviewed version exactly", () => {
    const current = snapshot("internal-review");
    expect(
      transitionAssignment(
        current,
        {
          ...command("approve"),
          action: "approve",
          reviewedVersionReference: "model-v0",
        },
        "active",
      ),
    ).toEqual({ ok: false, error: "review_version_conflict" });
    expect(transitionAssignment(current, command("approve"), "active")).toMatchObject({
      ok: true,
      value: {
        next: {
          approval: {
            kind: "internal",
            recordedByUserId: staffUserId,
            versionReference: "model-v1",
          },
        },
      },
    });
  });

  it("preserves acceptance provenance through review changes and another submission", () => {
    const current = Object.freeze(snapshot("internal-review"));
    const requested = transitionAssignment(current, command("request-changes"), "active");
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const previousReceipt = structuredClone(requested.value.receipt);
    const resumed = transitionAssignment(
      requested.value.next,
      { ...command("resume-work"), expectedRevision: 3 },
      "active",
    );
    expect(resumed).toMatchObject({
      ok: true,
      value: { next: { state: "working", revision: 4, acceptance, approval: null } },
    });
    expect(requested.value.receipt).toEqual(previousReceipt);
    expect(current).toEqual(snapshot("internal-review"));
  });

  it("rejects replay instead of incrementing a second time", () => {
    const first = transitionAssignment(snapshot(), command("record-acceptance"), "active");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(transitionAssignment(first.value.next, command("record-acceptance"), "active")).toEqual({
      ok: false,
      error: "revision_conflict",
    });
  });

  it("does not overflow the representable revision range", () => {
    expect(
      transitionAssignment(
        { ...snapshot(), revision: Number.MAX_SAFE_INTEGER },
        {
          ...command("record-acceptance"),
          expectedRevision: Number.MAX_SAFE_INTEGER,
        },
        "active",
      ),
    ).toEqual({ ok: false, error: "revision_exhausted" });
  });
});
