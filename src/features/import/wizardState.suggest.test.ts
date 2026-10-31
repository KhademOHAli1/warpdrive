import { expect, it } from "vitest";
import { eligibleFields } from "./eligibleFields";
import { columnMappingSchema } from "./schemas";
import {
  buildColumnMapping,
  initialWizardState,
  type WizardState,
  wizardReducer,
} from "./wizardState";

const HEADERS = ["Deal - Title", "Deal - ID", "Mystery"];

function pipedriveDeal(): WizardState {
  let s = wizardReducer(initialWizardState(), { type: "setSource", source: "pipedrive" });
  s = wizardReducer(s, { type: "setTarget", target: "deal" });
  return s;
}

it("starts with the csv source and the stage checkbox off", () => {
  const s = initialWizardState();
  expect(s.source).toBe("csv");
  expect(s.createMissingStages).toBe(false);
});

it("loadFile seeds columns from the suggestions for the state's source and target", () => {
  const s = wizardReducer(pipedriveDeal(), {
    type: "loadFile",
    filename: "d.csv",
    headers: HEADERS,
    rows: [],
    suggest: { eligible: eligibleFields("deal", "pipedrive"), defs: [] },
  });
  expect(s.columns["Deal - Title"]).toMatchObject({ entity: "deal", field: "title" });
  expect(s.columns["Deal - ID"]).toMatchObject({ field: "pipedriveId" });
  expect(s.columns.Mystery).toMatchObject({ field: "", isCustom: false });
});

it("prepared seeds columns from the suggestions", () => {
  const s = wizardReducer(pipedriveDeal(), {
    type: "prepared",
    headers: HEADERS,
    totalRows: 3,
    previewRows: [],
    suggest: { eligible: eligibleFields("deal", "pipedrive"), defs: [] },
  });
  expect(s.columns["Deal - Title"]).toMatchObject({ field: "title" });
});

it("seeds every column unmapped when no suggestion context is given", () => {
  const s = wizardReducer(pipedriveDeal(), {
    type: "prepared",
    headers: HEADERS,
    totalRows: 3,
    previewRows: [],
  });
  expect(s.columns["Deal - Title"]).toMatchObject({ field: "" });
});

it("changing source or target re-seeds the existing headers", () => {
  const loaded = wizardReducer(initialWizardState(), {
    type: "loadFile",
    filename: "d.csv",
    headers: ["Title"],
    rows: [],
  });
  const retargeted = wizardReducer(loaded, {
    type: "setTarget",
    target: "deal",
    suggest: { eligible: eligibleFields("deal", "csv"), defs: [] },
  });
  expect(retargeted.columns.Title).toMatchObject({ entity: "deal", field: "title" });
  const resourced = wizardReducer(retargeted, {
    type: "setSource",
    source: "pipedrive",
    suggest: { eligible: eligibleFields("deal", "pipedrive"), defs: [] },
  });
  expect(resourced.columns.Title).toMatchObject({ entity: "deal", field: "title" });
});

it("setSource back to csv moves a note target to a csv target and clears columns", () => {
  let s = wizardReducer(initialWizardState(), { type: "setSource", source: "pipedrive" });
  s = wizardReducer(s, { type: "setTarget", target: "note" });
  s = wizardReducer(s, { type: "setSource", source: "csv" });
  expect(s.target).toBe("person");
  expect(s.columns).toEqual({});
});

it("sends createMissingStages only for a pipedrive deal import", () => {
  let s = pipedriveDeal();
  s = wizardReducer(s, { type: "setCreateMissingStages", createMissingStages: true });
  const mapping = buildColumnMapping(s);
  expect(mapping.options).toMatchObject({ createMissingStages: true });
  expect(columnMappingSchema.parse(mapping).options.createMissingStages).toBe(true);
  const person = wizardReducer(s, { type: "setTarget", target: "person" });
  expect(buildColumnMapping(person).options.createMissingStages).toBe(false);
});
