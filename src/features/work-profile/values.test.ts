import { describe, expect, it } from "vitest";
import type { WorkFieldDefinition } from "./contracts";
import { validateWorkValues } from "./values";

const fields: WorkFieldDefinition[] = [
  { key: "mileage", label: "Mileage", type: "number", options: [], required: false },
  { key: "completion", label: "Completion", type: "date", options: [], required: false },
  {
    key: "approval",
    label: "Approval",
    type: "select",
    options: ["pending", "approved"],
    required: true,
  },
];
describe("operational work values", () => {
  it("keeps typed optional domain fields separate from sales custom fields", () => {
    expect(
      validateWorkValues(fields, {
        mileage: 120000,
        completion: "2026-11-05",
        approval: "approved",
      }),
    ).toMatchObject({ ok: true });
  });
  it.each<Record<string, string | number | boolean | null>>([
    { mileage: "120000", approval: "approved" },
    { mileage: Number.NaN, approval: "approved" },
    { completion: "2026-02-31", approval: "approved" },
    { approval: "authorized-by-browser" },
    { approval: "approved", credentials: "secret" },
    { mileage: 120000 },
  ])("rejects undeclared, invalid or missing required values", (values) => {
    expect(validateWorkValues(fields, values)).toEqual({ ok: false, error: "invalid_input" });
  });
});
it("does not read inherited properties as custom values", () => {
  expect(
    validateWorkValues(
      [{ key: "constructor", label: "Constructor", type: "text", options: [], required: false }],
      {},
    ),
  ).toEqual({ ok: true });
});
it("rejects whitespace-only required text but preserves false and zero", () => {
  expect(
    validateWorkValues(
      [{ key: "notes", label: "Notes", type: "text", options: [], required: true }],
      { notes: "  " },
    ),
  ).toEqual({ ok: false, error: "invalid_input" });
  expect(
    validateWorkValues(
      [
        { key: "confirmed", label: "Confirmed", type: "boolean", options: [], required: true },
        { key: "effort", label: "Effort", type: "number", options: [], required: true },
      ],
      { confirmed: false, effort: 0 },
    ),
  ).toEqual({ ok: true });
});
