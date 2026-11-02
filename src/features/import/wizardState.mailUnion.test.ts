import { expect, it } from "vitest";
import { initialWizardState, type WizardAction, wizardReducer } from "./wizardState";

it.each<WizardAction>([
  { type: "setPhoneCountry", phoneCountry: "DE" },
  { type: "setDateCalendar", dateCalendar: "persian" },
  { type: "setDateTimeZone", dateTimeZone: "Asia/Tehran" },
])("requires revalidation after a regional import change: $type", (action) => {
  const state = {
    ...initialWizardState(),
    step: "preview" as const,
    batchId: "synthetic-batch",
    validation: { valid: 1, invalid: 0 },
    rows: [{ Name: "Jane", Phone: "030 1234567" }],
    columns: { Name: { entity: "person" as const, field: "name", isCustom: false, key: "" } },
  };
  const changed = wizardReducer(state, action);
  expect(changed.validation).toBeNull();
  expect(wizardReducer(changed, { type: "goto", step: "commit" }).step).not.toBe("commit");
  expect(changed.rows).toEqual(state.rows);
  expect(changed.columns).toEqual(state.columns);
  expect(changed.batchId).toBe(state.batchId);
});
