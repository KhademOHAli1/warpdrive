import { describe, expect, it } from "vitest";
import { columnMappingSchema, mappingEntityErrors } from "./schemas";

const col = (entity: string, field: string) => ({ entity, field, isCustom: false, key: "" });
const mapping = (columns: Record<string, ReturnType<typeof col>>) => ({
  dedupMode: "skip",
  columns,
});

describe("mappingEntityErrors by source", () => {
  it("rejects a pipedrive-only field in a csv batch", () => {
    const m = mapping({ ID: col("deal", "pipedriveId") });
    expect(mappingEntityErrors(m, "deal", "csv")).toHaveLength(1);
    expect(mappingEntityErrors(m, "deal")).toHaveLength(1);
    expect(mappingEntityErrors(m, "deal", "pipedrive")).toEqual([]);
  });

  it("rejects a pipedrive-only field on a related entity too", () => {
    const m = mapping({ Owner: col("organization", "owner") });
    expect(mappingEntityErrors(m, "deal", "csv")).toHaveLength(1);
  });

  it("rejects the lead source channel in a pipedrive batch only", () => {
    const m = mapping({ S: col("lead", "sourceChannel"), I: col("lead", "sourceChannelId") });
    expect(mappingEntityErrors(m, "lead", "pipedrive")).toHaveLength(2);
    expect(mappingEntityErrors(m, "lead", "csv")).toEqual([]);
  });

  it("rejects the note target for csv batches only", () => {
    const m = mapping({ Note: col("note", "body") });
    expect(mappingEntityErrors(m, "note", "csv")).toHaveLength(1);
    expect(mappingEntityErrors(m, "note", "pipedrive")).toEqual([]);
  });

  it("leaves csv fields and the side note body alone", () => {
    const m = mapping({ T: col("deal", "title"), N: col("note", "body") });
    expect(mappingEntityErrors(m, "deal", "csv")).toEqual([]);
  });

  it("rejects note-only fields under the side note of other targets", () => {
    for (const field of ["createdAt", "pipedriveId", "dealPipedriveId", "orgName", "personName"]) {
      const m = mapping({ X: col("note", field) });
      expect(mappingEntityErrors(m, "deal", "pipedrive")).toHaveLength(1);
      expect(mappingEntityErrors(m, "person", "pipedrive")).toHaveLength(1);
      expect(mappingEntityErrors(m, "note", "pipedrive")).toEqual([]);
    }
  });
});

describe("createMissingStages option", () => {
  const withOption = (createMissingStages: boolean) => ({
    ...mapping({}),
    options: { rowNoteFromUnmapped: false, createMissingStages },
  });

  it("defaults to off", () => {
    expect(columnMappingSchema.parse(mapping({})).options.createMissingStages).toBe(false);
  });

  it("is accepted for a pipedrive deal batch only", () => {
    expect(mappingEntityErrors(withOption(true), "deal", "pipedrive")).toEqual([]);
    expect(mappingEntityErrors(withOption(true), "deal", "csv")).toHaveLength(1);
    expect(mappingEntityErrors(withOption(true), "person", "pipedrive")).toHaveLength(1);
    expect(mappingEntityErrors(withOption(false), "deal", "csv")).toEqual([]);
  });
});
