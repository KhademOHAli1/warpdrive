import { expect, it } from "vitest";
import { ORG_FILTER_CONFIG } from "@/features/contacts/contactFilterConfig";
import { rowsToDefinition } from "@/features/contacts/contactFilterRows";
import { dealRowsToDefinition, definitionToRows } from "@/features/deals/dealFilterRows";
import { leadRowsToCondition } from "@/features/leads/inbox/leadFilterRows";
import { completeRowValue, type RowValue } from "./rowValue";

it("normalizes explicitly tagged user drafts once and leaves canonical strings untouched", () => {
  const draft: RowValue = { kind: "number-draft", raw: "1.234,56", locale: "de" };
  expect(completeRowValue(draft)).toBe("1234.56");
  expect(completeRowValue("1.234")).toBe("1.234");
  expect(completeRowValue({ kind: "number-draft", raw: "1,234", locale: "de" })).toBe("1.234");
});

it("never reinterprets an invalid German draft as a valid canonical number in another compiler", () => {
  const value: RowValue = { kind: "number-draft", raw: "1.23", locale: "de" };
  expect(completeRowValue(value)).toBeNull();
  expect(dealRowsToDefinition([{ field: "value", op: "gt", value }], "and", "en")).toBeNull();
  expect(
    rowsToDefinition("and", [{ field: "employeeCount", op: "gt", value }], ORG_FILTER_CONFIG),
  ).toBeNull();
  expect(leadRowsToCondition([{ field: "value", op: "gt", value }], "and")).toBeNull();
});

it("serializes German drafts as canonical primitives in Deals, Contacts and Leads", () => {
  const value: RowValue = { kind: "number-draft", raw: "1.234,56", locale: "de" };
  expect(
    dealRowsToDefinition([{ field: "value", op: "gt", value }], "and", "de")?.conditions[0]?.value,
  ).toBe("1234.56");
  expect(
    rowsToDefinition("and", [{ field: "employeeCount", op: "gt", value }], ORG_FILTER_CONFIG)
      ?.conditions[0]?.value,
  ).toBe(1234.56);
  expect(
    leadRowsToCondition([{ field: "value", op: "gt", value }], "and")?.conditions[0]?.value,
  ).toBe("1234.56");
});

it("reopens and reapplies saved decimal values without treating their decimal point as grouping", () => {
  const saved = {
    combinator: "and",
    conditions: [{ field: "value", op: "gt", value: "1.234" }],
  } as const;
  expect(
    dealRowsToDefinition(
      definitionToRows({ ...saved, conditions: [...saved.conditions] }),
      "and",
      "de",
    ),
  ).toEqual(saved);
});
