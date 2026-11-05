import { describe, expect, it } from "vitest";
import { workCatalog } from "./catalog";
import { commandSchema, itemDraftSchema, overviewSchema } from "./contracts";
import { buildPreview } from "./preview";
import { emptyPreferences } from "./read";
import { fingerprint } from "./storage";

const empty = { pipelines: [], fields: [], activities: [], types: [] };
const input = {
  action: "preview" as const,
  requestId: "c80abe60-11f9-42d3-8ce1-46c4c3fd1205",
  presetId: "vehicle_repair" as const,
  locale: "en" as const,
  expectedRevision: 0,
  selection: { sales: true, delivery: true, dealFields: true, activityTypes: true },
};
describe("work-profile browser and catalog contracts", () => {
  it("exposes distinct versioned operational work in all supported locales", () => {
    for (const locale of ["en", "de", "fa"] as const) {
      const data = {
        workspaceScope: input.requestId,
        revision: 0,
        preferences: emptyPreferences,
        catalog: workCatalog(locale),
        workTypes: [],
        installations: [],
        permissions: {
          manageProfile: true,
          apply: true,
          view: true,
          create: true,
          change: true,
          manage: true,
        },
      };
      expect(overviewSchema.safeParse(data).success).toBe(true);
      expect(data.catalog).toHaveLength(3);
      for (const p of data.catalog) {
        expect(p.delivery.stages.some((s) => s.bucket === "complete")).toBe(true);
        expect(p.dealFields.every((f) => f.key.startsWith("wp_"))).toBe(true);
        expect(p.delivery.fields.every((f) => !f.required)).toBe(true);
      }
    }
  });
  it("binds preview to revision, locale, selection and catalog content", () => {
    const p = buildPreview(input, empty);
    expect(p.operations).toHaveLength(4);
    expect(p.conflicts).toEqual([]);
    expect(buildPreview({ ...input, expectedRevision: 1 }, empty).fingerprint).not.toBe(
      p.fingerprint,
    );
    expect(buildPreview({ ...input, locale: "de" }, empty).fingerprint).not.toBe(p.fingerprint);
    expect(
      buildPreview({ ...input, selection: { ...input.selection, sales: false } }, empty)
        .fingerprint,
    ).not.toBe(p.fingerprint);
  });
  it("rejects hidden definitions and zero-selection commands", () => {
    expect(
      commandSchema.safeParse({
        ...input,
        selection: { sales: false, delivery: false, dealFields: false, activityTypes: false },
      }).success,
    ).toBe(false);
    expect(commandSchema.safeParse({ ...input, arbitraryStages: ["secret"] }).success).toBe(false);
  });
  it("hashes normalized persisted JSON and dates consistently", () => {
    const a = { when: new Date("2026-11-05T00:00:00Z"), nested: { b: 2, a: 1 } };
    expect(fingerprint(a)).toBe(fingerprint(JSON.parse(JSON.stringify(a))));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, when: new Date("2026-11-06T00:00:00Z") }));
  });
  it("requires a matching group hint for group visibility", () => {
    const draft = {
      typeId: input.requestId,
      stageId: input.requestId,
      title: "A job",
      description: "",
      ownerId: input.requestId,
      organizationId: null,
      personId: null,
      dealId: null,
      dueDate: null,
      visibility: "group",
      visibilityGroupId: null,
      values: {},
    };
    expect(itemDraftSchema.safeParse(draft).success).toBe(false);
  });
});
it("accepts explicit UUID cancellation without a retained private command payload", () => {
  expect(
    commandSchema.safeParse({
      action: "cancel_operation",
      requestId: "6db55843-5ab9-43c7-9488-10c438501ab5",
      targetRequestId: input.requestId,
    }).success,
  ).toBe(true);
});
