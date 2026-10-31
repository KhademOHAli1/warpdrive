import { expect, it } from "vitest";
import { initialWizardState, isMappingComplete, type WizardState } from "./wizardState";

function stateWith(target: WizardState["target"], columns: WizardState["columns"]): WizardState {
  return { ...initialWizardState(), target, columns };
}

const choice = (entity: WizardState["columns"][string]["entity"], field: string) => ({
  entity,
  field,
  isCustom: false,
  key: "",
});

it("needs only the title for a csv deal", () => {
  const s = stateWith("deal", { T: choice("deal", "title") });
  expect(isMappingComplete(s)).toBe(true);
  expect(isMappingComplete(s, "csv")).toBe(true);
});

it("also needs the primary Pipedrive ID for a pipedrive deal", () => {
  const titleOnly = stateWith("deal", { T: choice("deal", "title") });
  expect(isMappingComplete(titleOnly, "pipedrive")).toBe(false);
  const both = stateWith("deal", { T: choice("deal", "title"), I: choice("deal", "pipedriveId") });
  expect(isMappingComplete(both, "pipedrive")).toBe(true);
});

it("does not accept a related entity's Pipedrive ID as the primary one", () => {
  const s = stateWith("deal", { T: choice("deal", "title"), I: choice("person", "pipedriveId") });
  expect(isMappingComplete(s, "pipedrive")).toBe(false);
});

it("needs the body and the Pipedrive ID for a note target", () => {
  expect(isMappingComplete(stateWith("note", { N: choice("note", "body") }), "pipedrive")).toBe(
    false,
  );
  const s = stateWith("note", { N: choice("note", "body"), I: choice("note", "pipedriveId") });
  expect(isMappingComplete(s, "pipedrive")).toBe(true);
});

it("adopts the persisted batch source and target when the upload completes", async () => {
  const { initialWizardState, wizardReducer } = await import("./wizardState");
  const changed = wizardReducer(initialWizardState(), { type: "setSource", source: "pipedrive" });
  const s = wizardReducer(changed, {
    type: "uploaded",
    batchId: "b1",
    source: "csv",
    target: "deal",
  });
  expect(s).toMatchObject({ source: "csv", target: "deal", batchId: "b1", step: "preparing" });
});
