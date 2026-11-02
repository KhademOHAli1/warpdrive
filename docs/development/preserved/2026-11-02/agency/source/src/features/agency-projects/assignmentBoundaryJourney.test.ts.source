import { expect, it } from "vitest";
import { type AssignmentSnapshot, transitionAssignment } from "./assignmentLifecycle";
import {
  assignmentActionSchema,
  assignmentCommandSchema,
  assignmentSnapshotSchema,
} from "./assignmentSchemas";

it("keeps canonical CRM UUIDs through first submission, changes and exact-version approval", () => {
  const personId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let current: AssignmentSnapshot = assignmentSnapshotSchema.parse({
    state: "awaiting-acceptance",
    revision: 0,
    freelancerContactId: personId,
    internalOwnerUserId: userId,
    versionReference: null,
    acceptance: null,
    approval: null,
  });
  function apply(input: unknown) {
    const action = assignmentActionSchema.parse(input);
    const command = assignmentCommandSchema.parse({
      ...action,
      recordedByUserId: userId.toUpperCase(),
    });
    const result = transitionAssignment(current, command, "active");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    current = assignmentSnapshotSchema.parse(result.value.next);
  }
  apply({
    action: "record-acceptance",
    expectedRevision: 0,
    freelancerContactId: personId.toUpperCase(),
    evidenceReference: "call-note-42",
  });
  expect(current).toMatchObject({
    versionReference: null,
    acceptance: { recordedByUserId: userId, freelancerContactId: personId },
  });
  apply({ action: "submit", expectedRevision: 1, submittedVersionReference: "Model-V1" });
  apply({ action: "begin-review", expectedRevision: 2 });
  apply({
    action: "request-changes",
    expectedRevision: 3,
    reason: "اصلاح زاویه / Blickwinkel ändern",
  });
  apply({ action: "resume-work", expectedRevision: 4 });
  expect(current).toMatchObject({ state: "working", versionReference: "Model-V1", approval: null });
  const previous = structuredClone(current);
  apply({ action: "submit", expectedRevision: 5, submittedVersionReference: "Model-V2" });
  apply({ action: "begin-review", expectedRevision: 6 });
  expect(
    transitionAssignment(
      current,
      {
        action: "approve",
        expectedRevision: 7,
        recordedByUserId: userId,
        reviewedVersionReference: "Model-V1",
      },
      "active",
    ),
  ).toEqual({ ok: false, error: "review_version_conflict" });
  apply({ action: "approve", expectedRevision: 7, reviewedVersionReference: "Model-V2" });
  expect(current).toMatchObject({
    state: "approved",
    versionReference: "Model-V2",
    approval: { versionReference: "Model-V2" },
  });
  expect(previous.versionReference).toBe("Model-V1");
});
