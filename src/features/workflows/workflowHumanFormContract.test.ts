import { expect, it } from "vitest";
import { err, ok } from "@/types/result";
import {
  boundedWorkflowHumanFormConfig,
  parseWorkflowHumanFormAnswers,
  workflowHumanFormConfig,
  workflowHumanFormDraftConfig,
  workflowHumanFormLimits,
  workflowHumanFormOutputDescriptors,
} from "./workflowHumanFormContract";

const text = {
  id: "65e0a586-701c-470f-9688-715a457ac5bd",
  label: "Summary",
  type: "text",
  required: true,
  placeholder: "Short summary",
} as const;
const number = {
  id: "dc821dbe-f9e3-4e68-a5f2-6c4e37a5f3ae",
  label: "Amount",
  type: "number",
  required: false,
} as const;
const date = {
  id: "a593f81b-1106-4155-b273-0fe54be17eef",
  label: "Day",
  type: "date",
  required: true,
} as const;
const config = workflowHumanFormConfig.parse({
  instructions: "Review before proceeding.",
  fields: [text, number, date],
});

it("allows an incomplete draft while requiring a nonempty named form for execution", () => {
  expect(workflowHumanFormDraftConfig.safeParse({ fields: [] }).success).toBe(true);
  expect(workflowHumanFormConfig.safeParse({ fields: [] }).success).toBe(false);
  const draft = { fields: [{ ...text, label: " " }] };
  expect(boundedWorkflowHumanFormConfig(draft)).toBe(true);
  expect(workflowHumanFormConfig.safeParse(draft).success).toBe(false);
});

it("rejects ambiguous identities, duplicate labels, unsupported fields, and answer storage in config", () => {
  for (const malformed of [
    { fields: [text, { ...number, id: text.id }] },
    { fields: [text, { ...number, label: "  ＳＵＭＭＡＲＹ " }] },
    { fields: [{ ...date, placeholder: "unsupported" }] },
    { fields: [{ ...text, type: "boolean" }] },
    { fields: [{ ...text, type: "select" }] },
    { fields: [{ ...text, value: "private answer" }] },
    { fields: [text], answers: { [text.id]: "private answer" } },
  ]) {
    expect(workflowHumanFormConfig.safeParse(malformed).success).toBe(false);
  }
});

it("enforces the pre-parse field count and text bounds", () => {
  expect(
    boundedWorkflowHumanFormConfig({ fields: Array(workflowHumanFormLimits.fields + 1) }),
  ).toBe(false);
  expect(
    boundedWorkflowHumanFormConfig({
      fields: [text],
      instructions: "a".repeat(workflowHumanFormLimits.instructions + 1),
    }),
  ).toBe(false);
  expect(
    boundedWorkflowHumanFormConfig({
      fields: [{ ...text, label: "a".repeat(workflowHumanFormLimits.label + 1) }],
    }),
  ).toBe(false);
});

it("derives typed dynamic paths from IDs rather than mutable labels or order", () => {
  const descriptors = workflowHumanFormOutputDescriptors(config);
  expect(descriptors).toEqual([
    { path: ["answers", text.id], label: "Summary", contract: { kind: "text", nullable: false } },
    { path: ["answers", number.id], label: "Amount", contract: { kind: "number", nullable: true } },
    { path: ["answers", date.id], label: "Day", contract: { kind: "date", nullable: false } },
  ]);
  expect(
    workflowHumanFormOutputDescriptors({
      fields: [date, { ...text, label: "عنوان جدید" }, number],
    })[1],
  ).toEqual({ ...descriptors[0], label: "عنوان جدید" });
  expect(workflowHumanFormOutputDescriptors({ fields: [{ ...text, label: "" }] })).toEqual([]);
});

it("projects only strictly typed values under their stable answer keys", () => {
  expect(
    parseWorkflowHumanFormAnswers(config, {
      [text.id]: "  Needs review  ",
      [number.id]: 0,
      [date.id]: "2028-02-29",
    }),
  ).toEqual(
    ok({
      [`answers.${text.id}`]: "  Needs review  ",
      [`answers.${number.id}`]: 0,
      [`answers.${date.id}`]: "2028-02-29",
    }),
  );
  expect(
    parseWorkflowHumanFormAnswers(config, { [text.id]: "Ready", [date.id]: "2026-06-01" }),
  ).toEqual(
    ok({
      [`answers.${text.id}`]: "Ready",
      [`answers.${number.id}`]: null,
      [`answers.${date.id}`]: "2026-06-01",
    }),
  );
});

it("rejects missing or malformed answers without echoing private values", () => {
  const values = { [text.id]: "Private note", [date.id]: "2026-06-01" };
  expect(parseWorkflowHumanFormAnswers(config, { ...values, [text.id]: " " })).toEqual(
    err({ code: "required", fieldId: text.id }),
  );
  for (const value of ["123", true, Infinity, {}]) {
    expect(parseWorkflowHumanFormAnswers(config, { ...values, [number.id]: value })).toEqual(
      err({ code: "invalid_value", fieldId: number.id }),
    );
  }
  expect(parseWorkflowHumanFormAnswers(config, { ...values, [date.id]: "2026-02-30" })).toEqual(
    err({ code: "invalid_value", fieldId: date.id }),
  );
  expect(
    parseWorkflowHumanFormAnswers(config, {
      ...values,
      [text.id]: " ".repeat(workflowHumanFormLimits.text + 1),
    }),
  ).toEqual(err({ code: "invalid_value", fieldId: text.id }));
  expect(
    parseWorkflowHumanFormAnswers(config, { ...values, "sensitive-unknown-key": "Sensitive data" }),
  ).toEqual(err({ code: "unknown_field" }));
  expect(parseWorkflowHumanFormAnswers(config, Object.create(values))).toEqual(
    err({ code: "invalid_submission" }),
  );
});
