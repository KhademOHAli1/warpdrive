import { describe, expect, it } from "vitest";
import {
  acceptance,
  command,
  freelancerContactId,
  snapshot,
  staffUserId,
} from "./assignmentFixtures";
import {
  assignmentActionSchema,
  assignmentCommandSchema,
  assignmentSnapshotSchema,
} from "./assignmentSchemas";

describe("assignment boundary and recorded provenance", () => {
  it.each([
    "record-acceptance",
    "submit",
    "begin-review",
    "request-changes",
    "resume-work",
    "approve",
    "cancel",
  ] as const)("separates %s input from the server recording actor", (action) => {
    const assembled = command(action);
    const input = Object.fromEntries(
      Object.entries(assembled).filter(([key]) => key !== "recordedByUserId"),
    );
    expect(assignmentActionSchema.safeParse(input).success).toBe(true);
    expect(assignmentActionSchema.safeParse(assembled).success).toBe(false);
    expect(assignmentCommandSchema.parse(assembled)).toEqual(assembled);
    expect(assignmentCommandSchema.safeParse(input).success).toBe(false);
  });

  it.each(["authorized", "actorId", "authenticatedFreelancer", "membership", "rate"])(
    "rejects unsupported action data %s",
    (key) => {
      expect(
        assignmentActionSchema.safeParse({
          action: "begin-review",
          expectedRevision: 2,
          [key]: true,
        }).success,
      ).toBe(false);
    },
  );

  it("requires a version on explicit submission", () => {
    expect(
      assignmentActionSchema.safeParse({ action: "submit", expectedRevision: 2 }).success,
    ).toBe(false);
    expect(
      assignmentActionSchema.parse({
        action: "submit",
        expectedRevision: 2,
        submittedVersionReference: "مدل-۱-Änderung",
      }),
    ).toEqual({
      action: "submit",
      expectedRevision: 2,
      submittedVersionReference: "مدل-۱-Änderung",
    });
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "2", null])(
    "rejects inexact revision %s",
    (revision) => {
      expect(assignmentSnapshotSchema.safeParse({ ...snapshot(), revision }).success).toBe(false);
      expect(
        assignmentActionSchema.safeParse({ action: "begin-review", expectedRevision: revision })
          .success,
      ).toBe(false);
    },
  );

  it.each(["freelancerContactId", "internalOwnerUserId"])("requires UUID identity in %s", (key) => {
    expect(assignmentSnapshotSchema.safeParse({ ...snapshot(), [key]: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("keeps user and person identity domains separate without inferring from UUID equality", () => {
    expect(
      assignmentSnapshotSchema.safeParse({ ...snapshot(), freelancerContactId: staffUserId })
        .success,
    ).toBe(true);
    expect(
      assignmentCommandSchema.safeParse({
        ...command("begin-review"),
        recordedByUserId: "not-a-user-uuid",
      }).success,
    ).toBe(false);
  });

  it.each([
    "awaiting-acceptance",
    "working",
    "submitted",
    "internal-review",
    "changes-requested",
    "approved",
    "canceled",
  ] as const)("accepts coherent %s evidence", (state) => {
    expect(assignmentSnapshotSchema.parse(snapshot(state))).toEqual(snapshot(state));
  });

  it("allows unsent work and cancellation before any artifact or acceptance exists", () => {
    expect(
      assignmentSnapshotSchema.safeParse({ ...snapshot("working"), versionReference: null })
        .success,
    ).toBe(true);
    expect(
      assignmentSnapshotSchema.safeParse({
        ...snapshot("canceled"),
        acceptance: null,
        versionReference: null,
      }).success,
    ).toBe(true);
    expect(
      assignmentSnapshotSchema.safeParse({ ...snapshot("canceled"), versionReference: null })
        .success,
    ).toBe(true);
  });

  it.each([
    { ...snapshot(), acceptance },
    { ...snapshot(), versionReference: "model-v1" },
    { ...snapshot("working"), acceptance: null },
    { ...snapshot("submitted"), versionReference: null },
    { ...snapshot("internal-review"), versionReference: null },
    { ...snapshot("changes-requested"), versionReference: null },
    { ...snapshot("approved"), approval: null },
    {
      ...snapshot("approved"),
      approval: { kind: "internal", recordedByUserId: staffUserId, versionReference: "model-v0" },
    },
    { ...snapshot("working"), approval: snapshot("approved").approval },
    { ...snapshot("canceled"), acceptance: null },
    { ...snapshot("working"), acceptance: { ...acceptance, freelancerContactId: staffUserId } },
    { ...snapshot("working"), acceptance: { ...acceptance, source: "freelancer-authenticated" } },
    { ...snapshot("working"), acceptance: { ...acceptance, authenticated: true } },
    { ...snapshot("working"), rate: 100 },
    { ...snapshot("working"), state: "unknown" },
  ])("rejects incoherent or excessive stored evidence %j", (input) => {
    expect(assignmentSnapshotSchema.safeParse(input).success).toBe(false);
  });

  it("requires an explicit nullable version field", () => {
    const missing = Object.fromEntries(
      Object.entries(snapshot()).filter(([key]) => key !== "versionReference"),
    );
    expect(assignmentSnapshotSchema.safeParse(missing).success).toBe(false);
  });

  it("allows different legitimate staff recorders while preserving evidence exactly", () => {
    const current = snapshot("approved");
    const record = {
      ...current,
      acceptance: { ...acceptance, recordedByUserId: freelancerContactId },
    };
    expect(assignmentSnapshotSchema.parse(record)).toEqual(record);
  });

  it("normalizes UUID spellings without changing external reference identity", () => {
    const contact = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const input = {
      ...snapshot("working"),
      freelancerContactId: contact,
      acceptance: {
        ...acceptance,
        freelancerContactId: contact.toUpperCase(),
        evidenceReference: "Note-ÄA",
      },
    };
    expect(assignmentSnapshotSchema.parse(input)).toEqual({
      ...input,
      acceptance: { ...input.acceptance, freelancerContactId: contact },
    });
  });

  it.each([
    "",
    " ",
    "x".repeat(2049),
    "ref\nline",
    "ref\u0085line",
    "ref\u2028line",
    "ref\u2029line",
    "<script>bad</script>",
    "javascript:alert(1)",
    "data:text/plain,test",
    "file:///tmp/fixture",
    "ftp://example.invalid/model",
    "https://user:pw@example.invalid/model",
    "https://",
    " model-v1",
  ])("rejects an unsafe or ambiguous reference %s", (submittedVersionReference) => {
    expect(
      assignmentActionSchema.safeParse({
        action: "submit",
        expectedRevision: 2,
        submittedVersionReference,
      }).success,
    ).toBe(false);
    expect(
      assignmentCommandSchema.safeParse({
        ...command("record-acceptance"),
        evidenceReference: submittedVersionReference,
      }).success,
    ).toBe(false);
  });

  it("preserves an allowed external reference without fetching or normalizing its identity", () => {
    const submittedVersionReference = "https://example.invalid/مدل-۱?version=Änderung#review";
    expect(
      assignmentActionSchema.parse({
        action: "submit",
        expectedRevision: 2,
        submittedVersionReference,
      }),
    ).toEqual({ action: "submit", expectedRevision: 2, submittedVersionReference });
  });

  it.each(["", " ", "x".repeat(2001), "reason\u0000hidden", "reason\u0085hidden"])(
    "requires bounded nonempty control-safe reasons",
    (reason) => {
      expect(
        assignmentActionSchema.safeParse({ action: "request-changes", expectedRevision: 2, reason })
          .success,
      ).toBe(false);
    },
  );
});
