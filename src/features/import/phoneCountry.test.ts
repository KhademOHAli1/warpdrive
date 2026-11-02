import { expect, it } from "vitest";
import { applyMapping, validateMappedRow } from "./mapRow";
import { normalizeMapping } from "./schemas";
import { buildColumnMapping, initialWizardState, wizardReducer } from "./wizardState";

it("carries explicitly selected phone country through the import mapping and derives canonical metadata without rewriting CSV input", () => {
  const raw = { Name: "مخاطب نمونه", Phone: " ۰۹۱۲ ۳۴۵ ۶۷۸۹ " };
  const mapping = normalizeMapping(
    {
      dedupMode: "skip",
      columns: {
        Name: { entity: "person", field: "name", isCustom: false, key: "" },
        Phone: { entity: "person", field: "phones", isCustom: false, key: "" },
      },
      options: { phoneCountry: "IR" },
    },
    "person",
  );
  const mapped = applyMapping(raw, mapping, "person");
  const checked = validateMappedRow("person", mapped, []);
  if (!checked.ok) throw new Error("expected valid import");
  expect(checked.value.primary.phones).toEqual([
    {
      label: "work",
      value: raw.Phone,
      primary: true,
      country: "IR",
      e164: "+989123456789",
      normalization: "valid",
    },
  ]);
  expect(raw.Phone).toBe(" ۰۹۱۲ ۳۴۵ ۶۷۸۹ ");
});

it("persists the user's region choice independently of UI language and clears it with wizard reset", () => {
  const selected = wizardReducer(initialWizardState(), {
    type: "setPhoneCountry",
    phoneCountry: "DE",
  });
  expect(buildColumnMapping(selected).options.phoneCountry).toBe("DE");
  expect(
    buildColumnMapping(wizardReducer(selected, { type: "reset" })).options.phoneCountry,
  ).toBeUndefined();
});

it("retains historic trimming for non-phone record fields and skips whitespace-only phone cells", () => {
  const mapping = normalizeMapping(
    {
      columns: {
        Title: { entity: "deal", field: "title", isCustom: false, key: "" },
        Custom: { entity: "deal", field: "", isCustom: true, key: "cf_text" },
        Phone: { entity: "person", field: "phones", isCustom: false, key: "" },
      },
    },
    "deal",
  );
  const result = applyMapping(
    { Title: "  Deal title  ", Custom: "  Custom text  ", Phone: "   " },
    mapping,
    "deal",
  );
  expect(result.primary).toMatchObject({
    title: "Deal title",
    customFields: { cf_text: "Custom text" },
  });
  expect(result.person).toBeUndefined();
});
