import { describe, expect, it } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";
import { eligibleFields } from "./eligibleFields";
import { suggestColumns } from "./suggestColumns";

const def = (key: string, name: string): CustomFieldDef => ({
  id: key,
  targetEntity: "deal",
  type: "text",
  name,
  key,
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
});

const un = { entity: "deal", field: "", isCustom: false, key: "" };

describe("suggestColumns pipedrive", () => {
  const eligible = eligibleFields("deal", "pipedrive");

  it("maps synonyms and routes a prefix to its entity group", () => {
    const out = suggestColumns(
      ["Deal - Title", "Deal - ID", "Person - Name", "Organization - Name", "Deal - Won time"],
      "deal",
      "pipedrive",
      eligible,
    );
    expect(out["Deal - Title"]).toMatchObject({ entity: "deal", field: "title" });
    expect(out["Deal - ID"]).toMatchObject({ entity: "deal", field: "pipedriveId" });
    expect(out["Person - Name"]).toMatchObject({ entity: "person", field: "name" });
    expect(out["Organization - Name"]).toMatchObject({ entity: "organization", field: "name" });
    expect(out["Deal - Won time"]).toMatchObject({ entity: "deal", field: "wonTime" });
  });

  it("is case and whitespace insensitive", () => {
    const out = suggestColumns(["  deal  -   LOST   reason "], "deal", "pipedrive", eligible);
    expect(out["  deal  -   LOST   reason "]).toMatchObject({ field: "lostReason" });
  });

  it("maps unprefixed headers against the primary entity and cross synonyms", () => {
    const out = suggestColumns(
      ["Title", "Organization", "Contact person"],
      "deal",
      "pipedrive",
      eligible,
    );
    expect(out.Title).toMatchObject({ entity: "deal", field: "title" });
    expect(out.Organization).toMatchObject({ entity: "organization", field: "name" });
    expect(out["Contact person"]).toMatchObject({ entity: "person", field: "name" });
  });

  it("leaves an unsupported entity prefix unmapped", () => {
    const out = suggestColumns(["Lead - Title"], "deal", "pipedrive", eligible);
    expect(out["Lead - Title"]).toEqual(un);
  });

  it("leaves a prefix for an entity the target cannot write unmapped", () => {
    const out = suggestColumns(["Activity - Subject"], "deal", "pipedrive", eligible);
    expect(out["Activity - Subject"]).toEqual(un);
  });

  it("falls back to the standard label inside the prefixed entity", () => {
    const out = suggestColumns(
      ["Deal - Pipeline", "Deal - Expected close date"],
      "deal",
      "pipedrive",
      eligible,
    );
    expect(out["Deal - Pipeline"]).toMatchObject({ field: "pipeline" });
    expect(out["Deal - Expected close date"]).toMatchObject({ field: "expectedCloseDate" });
  });

  it("maps a primary custom field by label", () => {
    const out = suggestColumns(["Deal - Region"], "deal", "pipedrive", eligible, [
      def("region", "Region"),
    ]);
    expect(out["Deal - Region"]).toMatchObject({ isCustom: true, key: "region" });
  });

  it("maps activity and note headers", () => {
    const act = suggestColumns(
      [
        "Activity - Subject",
        "Activity - Type",
        "Activity - Due date",
        "Activity - Assigned to user",
        "Activity - Deal ID",
      ],
      "activity",
      "pipedrive",
      eligibleFields("activity", "pipedrive"),
    );
    expect(act["Activity - Subject"]).toMatchObject({ entity: "activity", field: "subject" });
    expect(act["Activity - Type"]).toMatchObject({ field: "typeKey" });
    expect(act["Activity - Due date"]).toMatchObject({ field: "dueAt" });
    expect(act["Activity - Assigned to user"]).toMatchObject({ field: "assignee" });
    expect(act["Activity - Deal ID"]).toMatchObject({ field: "dealPipedriveId" });
    const note = suggestColumns(
      ["Note - Content", "Note - Deal ID"],
      "note",
      "pipedrive",
      eligibleFields("note", "pipedrive"),
    );
    expect(note["Note - Content"]).toMatchObject({ entity: "note", field: "body" });
    expect(note["Note - Deal ID"]).toMatchObject({ field: "dealPipedriveId" });
  });

  it("maps a field at most once, first header wins", () => {
    const out = suggestColumns(["Deal - Label", "Deal - Labels"], "deal", "pipedrive", eligible);
    expect(out["Deal - Label"]).toMatchObject({ field: "labels" });
    expect(out["Deal - Labels"]).toEqual(un);
  });

  it("never suggests a hidden field", () => {
    const out = suggestColumns(
      ["Deal - Value"],
      "deal",
      "pipedrive",
      eligibleFields("deal", "pipedrive", { deal: new Set(["value"]) }),
    );
    expect(out["Deal - Value"]).toEqual(un);
  });

  it("never suggests a note-only field under a side note", () => {
    const out = suggestColumns(
      ["Note - Deal ID"],
      "deal",
      "pipedrive",
      eligibleFields("deal", "pipedrive"),
    );
    expect(out["Note - Deal ID"]).toEqual(un);
  });
});

describe("suggestColumns csv", () => {
  const eligible = eligibleFields("person", "csv");

  it("matches standard labels, bare and qualified, primary entity first", () => {
    const out = suggestColumns(
      ["name", "EMAIL", "Organization[Name]", "Website / domain"],
      "person",
      "csv",
      eligible,
    );
    expect(out.name).toMatchObject({ entity: "person", field: "name" });
    expect(out.EMAIL).toMatchObject({ field: "emails" });
    expect(out["Organization[Name]"]).toMatchObject({ entity: "organization", field: "name" });
    expect(out["Website / domain"]).toMatchObject({ entity: "organization", field: "domain" });
  });

  it("ignores synonyms and prefixes", () => {
    const out = suggestColumns(
      ["Person - Name", "Owner", "Organization"],
      "person",
      "csv",
      eligible,
    );
    expect(out["Person - Name"]).toEqual({ ...un, entity: "person" });
    expect(out.Owner).toEqual({ ...un, entity: "person" });
    expect(out.Organization).toEqual({ ...un, entity: "person" });
  });

  it("maps primary custom fields by label", () => {
    const out = suggestColumns(["linkedin handle"], "person", "csv", eligible, [
      { ...def("li", "LinkedIn Handle"), targetEntity: "person" },
    ]);
    expect(out["linkedin handle"]).toMatchObject({ isCustom: true, key: "li" });
  });
});

describe("suggestColumns duplicate matches", () => {
  it("leaves a second header unmapped when its matching destination is already claimed", () => {
    const out = suggestColumns(
      ["Deal - Title", "Title"],
      "deal",
      "pipedrive",
      eligibleFields("deal", "pipedrive"),
      [def("title_cf", "Title")],
    );
    expect(out["Deal - Title"]).toMatchObject({ field: "title" });
    expect(out.Title).toEqual(un);
  });
});
