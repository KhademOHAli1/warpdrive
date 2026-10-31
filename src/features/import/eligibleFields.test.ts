import { describe, expect, it } from "vitest";
import { eligibleFields } from "./eligibleFields";

const keys = (list: ReturnType<typeof eligibleFields>) => list.map((f) => `${f.entity}:${f.field}`);

describe("eligibleFields", () => {
  it("drops pipedrive-only fields for csv", () => {
    expect(keys(eligibleFields("deal", "csv"))).not.toContain("deal:pipedriveId");
    expect(keys(eligibleFields("deal", "pipedrive"))).toContain("deal:pipedriveId");
  });

  it("drops hidden built-ins but keeps a required primary field", () => {
    const out = keys(eligibleFields("deal", "csv", { deal: new Set(["value", "title"]) }));
    expect(out).not.toContain("deal:value");
    expect(out).toContain("deal:title");
  });

  it("offers only the body for a side note", () => {
    const side = keys(eligibleFields("deal", "pipedrive")).filter((k) => k.startsWith("note:"));
    expect(side).toEqual(["note:body"]);
    const own = keys(eligibleFields("note", "pipedrive")).filter((k) => k.startsWith("note:"));
    expect(own).toContain("note:createdAt");
  });

  it("marks the primary required fields, including the pipedrive id", () => {
    const found = eligibleFields("deal", "pipedrive").filter((f) => f.required);
    expect(found.map((f) => f.field).sort()).toEqual(["pipedriveId", "title"]);
  });
});
