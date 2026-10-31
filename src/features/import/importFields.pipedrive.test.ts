import { expect, it } from "vitest";
import {
  ENTITY_FIELDS,
  fieldsFor,
  requiredFieldsFor,
  STANDARD_IMPORT_FIELDS,
  TARGET_ENTITY_GROUPS,
  targetsFor,
} from "./importFields";

const keys = (entity: Parameters<typeof fieldsFor>[0], source: Parameters<typeof fieldsFor>[1]) =>
  fieldsFor(entity, source).map((f) => f.field);

it("offers pipedriveId on every entity group for pipedrive only", () => {
  for (const entity of ["person", "organization", "deal", "activity", "note"] as const) {
    expect(keys(entity, "pipedrive")).toContain("pipedriveId");
    expect(keys(entity, "csv")).not.toContain("pipedriveId");
  }
  expect(ENTITY_FIELDS.deal.find((f) => f.field === "pipedriveId")?.label).toBe("Pipedrive ID");
});

it("offers owner on person, organization and deal for pipedrive only", () => {
  for (const entity of ["person", "organization", "deal"] as const) {
    expect(keys(entity, "pipedrive")).toContain("owner");
    expect(keys(entity, "csv")).not.toContain("owner");
  }
});

it("offers the deal lifecycle fields with their labels", () => {
  const byField = Object.fromEntries(ENTITY_FIELDS.deal.map((f) => [f.field, f.label]));
  expect(byField.status).toBe("Status");
  expect(byField.wonTime).toBe("Won time");
  expect(byField.lostTime).toBe("Lost time");
  expect(byField.lostReason).toBe("Lost reason");
  expect(byField.labels).toBe("Labels");
  expect(byField.createdAt).toBe("Created");
  expect(keys("deal", "csv")).toEqual([
    "title",
    "value",
    "currency",
    "expectedCloseDate",
    "pipeline",
    "stage",
  ]);
});

it("offers the activity fields with their labels", () => {
  const byField = Object.fromEntries(ENTITY_FIELDS.activity.map((f) => [f.field, f.label]));
  expect(byField).toMatchObject({
    assignee: "Assigned to",
    done: "Done",
    doneAt: "Done time",
    dueTime: "Due time",
    dealPipedriveId: "Deal ID",
    personPipedriveId: "Person ID",
    orgPipedriveId: "Organization ID",
    dealTitle: "Deal title",
    personName: "Person name",
    orgName: "Organization name",
  });
  expect(keys("activity", "csv")).toEqual(["subject", "typeKey", "dueAt", "durationMinutes"]);
});

it("offers the note target fields, with the body-only side note unchanged for csv", () => {
  const byField = Object.fromEntries(ENTITY_FIELDS.note.map((f) => [f.field, f.label]));
  expect(byField).toMatchObject({
    body: "Note",
    createdAt: "Created",
    dealPipedriveId: "Deal ID",
    personPipedriveId: "Person ID",
    orgPipedriveId: "Organization ID",
    dealTitle: "Deal title",
    personName: "Person name",
    orgName: "Organization name",
  });
  expect(keys("note", "csv")).toEqual(["body"]);
});

it("keeps csv person, organization and lead field lists free of pipedrive fields", () => {
  expect(keys("person", "csv")).toEqual(["name", "firstName", "lastName", "emails", "phones"]);
  expect(keys("organization", "csv")).not.toContain("pipedriveId");
  expect(keys("lead", "csv")).not.toContain("pipedriveId");
});

it("offers the note target only for pipedrive", () => {
  expect(targetsFor("pipedrive")).toContain("note");
  expect(targetsFor("csv")).not.toContain("note");
  expect(targetsFor("csv")).toEqual(["person", "organization", "deal", "lead", "activity"]);
  expect(TARGET_ENTITY_GROUPS.note).toEqual(["note"]);
});

it("requires the note body on a note target", () => {
  expect(STANDARD_IMPORT_FIELDS.note.find((f) => f.field === "body")?.required).toBe(true);
});

it("requires the primary pipedriveId for pipedrive batches only", () => {
  const pipedrive = requiredFieldsFor("deal", "pipedrive").map((f) => f.field);
  expect(pipedrive).toEqual(["title", "pipedriveId"]);
  expect(requiredFieldsFor("deal", "csv").map((f) => f.field)).toEqual(["title"]);
  expect(requiredFieldsFor("note", "pipedrive").map((f) => f.field)).toEqual([
    "body",
    "pipedriveId",
  ]);
});

it("requires title and pipedriveId for pipedrive leads", () => {
  expect(requiredFieldsFor("lead", "pipedrive").map((f) => f.field)).toEqual([
    "title",
    "pipedriveId",
  ]);
  expect(targetsFor("pipedrive")).toEqual([
    "person",
    "organization",
    "deal",
    "lead",
    "activity",
    "note",
  ]);
});

it("offers the lead target and its Pipedrive fields for pipedrive", () => {
  expect(targetsFor("pipedrive")).toContain("lead");
  expect(TARGET_ENTITY_GROUPS.lead).toEqual(["lead", "organization", "person", "note"]);
  const byField = Object.fromEntries(ENTITY_FIELDS.lead.map((f) => [f.field, f.label]));
  expect(byField.pipedriveId).toBe("Pipedrive ID");
  expect(byField.owner).toBe("Owner");
  expect(byField.labels).toBe("Labels");
  expect(byField.createdAt).toBe("Created");
  expect(byField.archived).toBe("Archived");
  expect(requiredFieldsFor("lead", "pipedrive").map((f) => f.field)).toContain("pipedriveId");
  expect(requiredFieldsFor("lead", "csv").map((f) => f.field)).not.toContain("pipedriveId");
});

it("keeps the lead source channel fields CSV-only", () => {
  expect(keys("lead", "pipedrive")).not.toContain("sourceChannel");
  expect(keys("lead", "pipedrive")).not.toContain("sourceChannelId");
  expect(keys("lead", "csv")).toEqual([
    "title",
    "value",
    "currency",
    "expectedCloseDate",
    "sourceChannel",
    "sourceChannelId",
  ]);
});
