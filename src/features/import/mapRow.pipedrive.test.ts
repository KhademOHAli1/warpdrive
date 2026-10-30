import { describe, expect, it } from "vitest";
import { applyMapping, validateMappedRow } from "./mapRow";
import { normalizeMapping } from "./schemas";

const col = (entity: string, field: string) => ({ entity, field, isCustom: false, key: "" });

const noteMapping = normalizeMapping(
  {
    dedupMode: "skip",
    columns: {
      Note: col("note", "body"),
      Created: col("note", "createdAt"),
      "Note ID": col("note", "pipedriveId"),
      "Deal ID": col("note", "dealPipedriveId"),
      "Person name": col("note", "personName"),
    },
  },
  "note",
);

describe("note target routing", () => {
  it("routes every note-entity column to the primary group", () => {
    const mapped = applyMapping(
      {
        Note: "Called them",
        Created: "2026-03-04",
        "Note ID": "11",
        "Deal ID": "5",
        "Person name": "Sam",
      },
      noteMapping,
      "note",
    );
    expect(mapped.primary).toMatchObject({
      body: "Called them",
      createdAt: "2026-03-04",
      pipedriveId: "11",
      dealPipedriveId: "5",
      personName: "Sam",
    });
    expect(mapped.note).toBeUndefined();
  });

  it("validates a note row against the note schema", () => {
    const ok = validateMappedRow(
      "note",
      { primary: { body: "hi", pipedriveId: "1" } },
      [],
      "pipedrive",
    );
    expect(ok.ok).toBe(true);
    const bad = validateMappedRow("note", { primary: { pipedriveId: "1" } }, [], "pipedrive");
    expect(bad.ok).toBe(false);
  });

  it("keeps the side-note behavior for deal targets: only body routes, to the note group", () => {
    const m = normalizeMapping(
      {
        dedupMode: "skip",
        columns: {
          Title: col("deal", "title"),
          Note: col("note", "body"),
          NoteDate: col("note", "createdAt"),
        },
      },
      "deal",
    );
    const mapped = applyMapping({ Title: "T", Note: "side", NoteDate: "2026-03-04" }, m, "deal");
    expect(mapped.note).toEqual({ body: "side" });
    expect(mapped.primary).not.toHaveProperty("createdAt");
  });
});

describe("activity dueTime", () => {
  const mapping = normalizeMapping(
    {
      dedupMode: "skip",
      columns: {
        Subject: col("activity", "subject"),
        Date: col("activity", "dueAt"),
        Time: col("activity", "dueTime"),
      },
    },
    "activity",
  );

  it("merges a time cell into the due date cell", () => {
    const mapped = applyMapping(
      { Subject: "Call", Date: "2026-03-04", Time: "14:30" },
      mapping,
      "activity",
    );
    expect(mapped.primary).not.toHaveProperty("dueTime");
    const r = validateMappedRow("activity", mapped, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.primary.dueAt).toBe("2026-03-04T14:30:00.000Z");
  });

  it("leaves a date-only activity alone", () => {
    const mapped = applyMapping(
      { Subject: "Call", Date: "2026-03-04", Time: "" },
      mapping,
      "activity",
    );
    const r = validateMappedRow("activity", mapped, []);
    expect(r.ok && r.value.primary.dueAt).toBe("2026-03-04T00:00:00.000Z");
  });

  it("makes a time without a date a row error on dueTime", () => {
    const mapped = applyMapping({ Subject: "Call", Date: "", Time: "14:30" }, mapping, "activity");
    const r = validateMappedRow("activity", mapped, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain("dueTime");
  });

  it("reports an unparseable time on the merged due date", () => {
    const mapped = applyMapping(
      { Subject: "Call", Date: "2026-03-04", Time: "99:99" },
      mapping,
      "activity",
    );
    const r = validateMappedRow("activity", mapped, []);
    expect(r.ok).toBe(false);
  });
});

describe("required Pipedrive ID", () => {
  it("makes a blank primary pipedriveId an error on pipedriveId for pipedrive batches", () => {
    const r = validateMappedRow(
      "deal",
      { primary: { title: "T", customFields: {} } },
      [],
      "pipedrive",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain("pipedriveId");
  });

  it("accepts a present pipedriveId", () => {
    const r = validateMappedRow(
      "deal",
      { primary: { title: "T", pipedriveId: "9", customFields: {} } },
      [],
      "pipedrive",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.primary.pipedriveId).toBe("9");
  });

  it("does not require it for csv batches", () => {
    const r = validateMappedRow("deal", { primary: { title: "T", customFields: {} } }, []);
    expect(r.ok).toBe(true);
  });

  it("does not require it for leads", () => {
    const r = validateMappedRow(
      "lead",
      { primary: { title: "T", customFields: {} } },
      [],
      "pipedrive",
    );
    expect(r.ok).toBe(true);
  });

  it("requires it on person, organization and activity primaries", () => {
    expect(
      validateMappedRow("person", { primary: { name: "S", customFields: {} } }, [], "pipedrive").ok,
    ).toBe(false);
    expect(
      validateMappedRow(
        "organization",
        { primary: { name: "O", customFields: {} } },
        [],
        "pipedrive",
      ).ok,
    ).toBe(false);
    expect(
      validateMappedRow(
        "activity",
        { primary: { subject: "S", customFields: {} } },
        [],
        "pipedrive",
      ).ok,
    ).toBe(false);
  });
});
