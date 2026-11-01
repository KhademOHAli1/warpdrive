import { describe, expect, it } from "vitest";
import { parseFeedbackCommand, parseFeedbackDeclaration } from "./feedbackRecord";
import {
  browserShortcuts,
  command,
  declaration,
  ids,
  invalidAuthors,
  invalidSources,
  nestedExtraDeclarations,
} from "./feedbackRecord.test-support";

const invalidDeclaration = { ok: false, error: "invalid_feedback_declaration" };
const invalidCommand = { ok: false, error: "invalid_feedback_command" };

describe("feedback declaration boundary", () => {
  it.each([null, undefined, [], {}, "feedback"])("rejects malformed declarations: %s", (input) => {
    expect(parseFeedbackDeclaration(input)).toEqual(invalidDeclaration);
  });

  it("preserves multilingual text and exact references while canonicalizing scope and author IDs", () => {
    expect(parseFeedbackDeclaration(declaration())).toEqual({ ok: true, value: declaration() });
    const input = {
      ...declaration(),
      projectId: ids.projectId.toUpperCase(),
      deliverableId: ids.deliverableId.toUpperCase(),
      author: { kind: "internal-user", userId: ids.authorUserId.toUpperCase() },
    };
    expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: declaration() });
  });

  it("requires canonical scope IDs and one exact identified work-version reference", () => {
    for (const field of ["projectId", "deliverableId"]) {
      for (const value of [undefined, null, "same-title"]) {
        expect(parseFeedbackDeclaration({ ...declaration(), [field]: value })).toEqual(invalidDeclaration);
      }
    }
    for (const value of [undefined, "", " version/1", "javascript:alert(1)", "v".repeat(2049)]) {
      expect(parseFeedbackDeclaration({ ...declaration(), workVersionReference: value })).toEqual(invalidDeclaration);
    }
  });

  it("keeps contact authors distinct from internal users and the native recorder", () => {
    const input = { ...declaration(), author: { kind: "external-contact", personId: ids.personId.toUpperCase() } };
    expect(parseFeedbackDeclaration(input)).toEqual({
      ok: true,
      value: { ...input, author: { kind: "external-contact", personId: ids.personId } },
    });
    for (const author of invalidAuthors()) {
      expect(parseFeedbackDeclaration({ ...declaration(), author })).toEqual(invalidDeclaration);
    }
  });

  it("requires an explicit source channel without inventing missing evidence", () => {
    const source = { channel: { kind: "other", label: "  نظر فایل / Dateikommentar  " } };
    expect(parseFeedbackDeclaration({ ...declaration(), source })).toEqual({ ok: true, value: { ...declaration(), source } });
    for (const source of invalidSources()) {
      expect(parseFeedbackDeclaration({ ...declaration(), source })).toEqual(invalidDeclaration);
    }
  });

  it("requires substantive other-channel labels while preserving embedded selectors", () => {
    for (const label of ["\u034f", "\uFE0F", "\u115F", " \u034f\uFE0F "]) {
      const input = { ...declaration(), source: { channel: { kind: "other", label } } };
      expect(parseFeedbackDeclaration(input)).toEqual(invalidDeclaration);
      expect(parseFeedbackCommand({ ...command(), declaration: input })).toEqual(invalidCommand);
    }
    const input = { ...declaration(), source: { channel: { kind: "other", label: "نظر\u200c / A\u034f" } } };
    expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: input });
  });

  it("rejects unsafe or oversized evidence without rewriting accepted references", () => {
    for (const evidenceReference of [
      "", "javascript:alert(1)", "https://user:pass@example.invalid/source",
      "https://source.example.invalid/<script>", "source\u0085ref", "r".repeat(2049),
    ]) {
      expect(parseFeedbackDeclaration({
        ...declaration(), source: { channel: { kind: "email" }, evidenceReference },
      })).toEqual(invalidDeclaration);
    }
  });

  it.each(["workVersionReference", "evidenceReference"] as const)(
    "requires substantive %s without removing embedded Persian joiners",
    (field) => {
      const withReference = (value: string) => field === "workVersionReference"
        ? { ...declaration(), workVersionReference: value }
        : { ...declaration(), source: { ...declaration().source, evidenceReference: value } };
      for (const value of ["\u200c", "\u2066\u2069", " \u200c "]) {
        expect(parseFeedbackDeclaration(withReference(value))).toEqual(invalidDeclaration);
      }
      const input = withReference("review/نسخه\u200c۱");
      expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: input });
    },
  );

  it("requires substantive bounded text without stripping embedded Persian joiners", () => {
    for (const text of ["", " \n\t", "\u200c", "\u2066\u2069", "text\u0000", "text\u0085", "x".repeat(2001)]) {
      expect(parseFeedbackDeclaration({ ...declaration(), text })).toEqual(invalidDeclaration);
    }
    const input = { ...declaration(), text: "x".repeat(2000) };
    expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: input });
  });

  it.each(["workVersionReference", "evidenceReference", "text"] as const)(
    "rejects default-ignorable-only %s while preserving embedded characters",
    (field) => {
      const withValue = (value: string) => field === "evidenceReference"
        ? { ...declaration(), source: { ...declaration().source, evidenceReference: value } }
        : { ...declaration(), [field]: value };
      for (const value of ["\u034f", "\uFE0F", "\u115F", " \u034f\uFE0F "]) {
        expect(parseFeedbackDeclaration(withValue(value))).toEqual(invalidDeclaration);
        expect(parseFeedbackCommand({ ...command(), declaration: withValue(value) })).toEqual(invalidCommand);
      }
      const input = withValue("review/A\u034f1\uFE0F");
      expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: input });
    },
  );

  it("keeps markup-looking text literal without claiming safe rendered output", () => {
    const input = { ...declaration(), text: '<img src=x onerror="alert(1)"> & <script>literal</script>' };
    expect(parseFeedbackDeclaration(input)).toEqual({ ok: true, value: input });
  });

  it("rejects native, approval, commercial and collection shortcuts", () => {
    for (const extra of browserShortcuts()) {
      expect(parseFeedbackDeclaration({ ...declaration(), ...extra })).toEqual(invalidDeclaration);
    }
  });

  it.each(nestedExtraDeclarations())("rejects extra keys at $boundary in both boundaries", ({ value }) => {
    expect(parseFeedbackDeclaration(value)).toEqual(invalidDeclaration);
    expect(parseFeedbackCommand({ ...command(), declaration: value })).toEqual(invalidCommand);
  });
});

describe("native feedback recording command boundary", () => {
  it("requires separate server-owned identity, label and exact recording time", () => {
    expect(parseFeedbackCommand(command())).toEqual({ ok: true, value: command() });
    const input = { ...command(), feedbackId: ids.feedbackId.toUpperCase(), recordedByUserId: ids.recorderId.toUpperCase() };
    expect(parseFeedbackCommand(input)).toEqual({ ok: true, value: command() });
    for (const field of ["feedbackId", "recordedByUserId", "recordedAt", "provenance", "declaration"]) {
      const input = command();
      Reflect.deleteProperty(input, field);
      expect(parseFeedbackCommand(input)).toEqual(invalidCommand);
    }
    expect(command().recordedByUserId).not.toBe(command().declaration.author.userId);
  });

  it("rejects malformed native provenance without inferring an authenticated author", () => {
    for (const input of [
      null, undefined,
      { ...command(), feedbackId: "record-1" },
      { ...command(), recordedByUserId: "staff-name" },
      { ...command(), recordedByUserId: ids.personId, provenance: "client-signed" },
      { ...command(), recordedAt: "2026-11-01T09:30:00" },
      { ...command(), recordedAt: "2026-02-30T09:30:00Z" },
      { ...command(), recordedAt: "2026-11-01T06:00:00.0000000001Z" },
      { ...command(), deliveryStatus: "confirmed" },
    ]) {
      expect(parseFeedbackCommand(input)).toEqual(invalidCommand);
    }
  });

  it("propagates malformed or invalid nested declarations through the native command", () => {
    for (const value of [
      null, [], {},
      { ...declaration(), text: "" },
      { ...declaration(), projectId: "same-title" },
      { ...declaration(), workVersionReference: "\u200c" },
      { ...declaration(), source: { ...declaration().source, evidenceReference: "\u2066\u2069" } },
    ]) {
      expect(parseFeedbackCommand({ ...command(), declaration: value })).toEqual(invalidCommand);
    }
  });

  it("retains contradictory reviewers as separate declarations without merging or approval inference", () => {
    const first = command();
    const second = {
      ...command(),
      feedbackId: "babcdefa-6789-4bcd-9efa-678901234abc",
      declaration: {
        ...declaration(),
        author: { kind: "external-contact", personId: ids.personId },
        text: "Bitte dunkle Farben verwenden.",
      },
    };
    expect(parseFeedbackCommand(first)).toEqual({ ok: true, value: first });
    expect(parseFeedbackCommand(second)).toEqual({ ok: true, value: second });
    expect(first.declaration.author).not.toEqual(second.declaration.author);
    expect(first.declaration.workVersionReference).toBe(second.declaration.workVersionReference);
    expect(first.declaration.text).not.toBe(second.declaration.text);
  });
});
