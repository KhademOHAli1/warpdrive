import { describe, expect, it } from "vitest";
import { sourceChannelLabel, sourceChannelOptions } from "@/constants/sourceChannelLabels";
import { formatChangeLabel } from "@/features/deal-workspace/changeLabel";
import { createAppTranslator } from "@/features/i18n/catalog";
import { dealCountLabel } from "@/features/pipelines/stageRemoval";
import { activityTooltip } from "./cardIndicators";
import { dealFilterFields } from "./dealFilterCatalog";
import { conditionRowIssue, dealRowsToDefinition } from "./dealFilterRows";
import { dealListColumns } from "./dealListColumns";
import { parseNewDeal } from "./newDealForm";

describe("Farsi sales presentation", () => {
  it("interpolates names inside English quoted create labels", () => {
    const t = createAppTranslator("en", "sales");
    expect(t("add_arg0_as_new_person_11c06", { arg0: "سارا" })).toBe("Add 'سارا' as new person");
    expect(t("add_arg0_as_new_organization_d5252", { arg0: "Acme" })).toBe(
      "Add 'Acme' as new organization",
    );
  });
  it("formats whole plural messages with Persian numbers", () => {
    const t = createAppTranslator("fa", "sales");
    expect(t("computed.participantCount", { count: 2 })).toBe("۲ فرد مرتبط");
    expect(dealCountLabel(12, 3, "fa")).toContain("۱۲");
    expect(dealCountLabel(12, 3, "fa")).toContain("۳");
    expect(dealCountLabel(0, 0, "fa")).toBe("فرصت فروشی وجود ندارد");
  });
  it("localizes columns and filter options while preserving machine values and user stage names", () => {
    expect(dealListColumns("fa").find((c) => c.key === "stage")?.header).toBe("مرحله");
    const fields = dealFilterFields({ stages: [{ id: "qualified", name: "Qualified" }] }, "fa");
    expect(fields.find((f) => f.field === "stageId")?.input).toEqual({
      kind: "select",
      options: [{ value: "qualified", label: "Qualified" }],
    });
    expect(fields.find((f) => f.field === "status")?.input).toEqual({
      kind: "select",
      options: [
        { value: "open", label: "باز" },
        { value: "won", label: "موفق" },
        { value: "lost", label: "ناموفق" },
      ],
    });
  });
  it("accepts Persian digits in money filters and serializes canonical values", () => {
    const fields = dealFilterFields({}, "fa");
    const rows = [{ field: "value", op: "gt", value: "۱۲۳۴٫۵" }];
    expect(conditionRowIssue(rows, fields, "fa")).toBeNull();
    expect(dealRowsToDefinition(rows, "and", "fa")?.conditions[0]?.value).toBe("1234.5");
  });
  it("keeps the existing activity day semantics and localizes relative time", () => {
    const now = new Date("2026-03-20T18:00:00Z");
    const tip = activityTooltip("Call Acme", new Date("2026-03-22T09:00:00Z"), now, "fa");
    expect(tip).toContain("Call Acme");
    expect(tip).toContain("۲");
    expect(tip).not.toMatch(/days|today|overdue/);
  });
  it("localizes audit rows when read, preserving stored status and names", () => {
    const change = { field: "status", oldValue: "open", newValue: "won" };
    expect(formatChangeLabel(change, "fa")).toContain("باز");
    expect(formatChangeLabel(change, "fa")).toContain("موفق");
    expect(change).toEqual({ field: "status", oldValue: "open", newValue: "won" });
    expect(
      formatChangeLabel({ field: "stageId", oldValue: "Qualified", newValue: "Proposal" }, "fa"),
    ).toContain("Qualified");
  });
  it("presents source channels and validation without changing their keys", () => {
    expect(sourceChannelLabel("web_form", "fa")).toBe("فرم وب‌سایت");
    expect(sourceChannelOptions("fa").map((o) => o.value)).toEqual(
      sourceChannelOptions("en").map((o) => o.value),
    );
    const result = parseNewDeal({ title: "", stageId: "stage", value: "" }, "pipeline", "fa");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/Title|required/);
  });
});
