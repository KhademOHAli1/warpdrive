import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { formatChangeLabel } from "@/features/deal-workspace/changeLabel";
import { dealActionErrorContent } from "@/features/deal-workspace/dealActionError";
import { createAppTranslator } from "@/features/i18n/catalog";

const readable = (value: string) => value.replace(/[\u2066-\u2069]/g, "");

describe("contextual sales language review", () => {
  it("includes overdue work in the Persian Focus label and distinguishes filter authorship", () => {
    const t = createAppTranslator("fa", "sales");
    for (const key of ["computed.focus", "focus_9d3ca", "focus_c51fa"] as const)
      expect(t(key)).toBe("نیازمند پیگیری");
    expect(t("computed.copyFilterNote")).toBe(
      "این فیلتر را شما ایجاد نکرده‌اید؛ تغییراتتان به‌صورت یک فیلتر جدید ذخیره می‌شود.",
    );
    expect(t("computed.requiredField", { name: "شماره تماس" })).toBe(
      "وارد کردن «شماره تماس» الزامی است.",
    );
  });
  it("describes time in the current stage rather than unmeasured inactivity", () => {
    expect(createAppTranslator("en", "sales")("rotting_idle_arg0_days_0f4ad", { arg0: 12 })).toBe(
      "Rotting; 12 days in this stage",
    );
    expect(createAppTranslator("fa", "sales")("rotting_idle_arg0_days_0f4ad", { arg0: 12 })).toBe(
      "راکد؛ ۱۲ روز در این مرحله",
    );
  });
  it("explains a permission denial without claiming only the owner can act", () => {
    expect(dealActionErrorContent(ERROR_IDS.PERM_DENIED, "en").body).toBe(
      "You don't have permission to make this change. Ask an admin to review your access.",
    );
    expect(dealActionErrorContent(ERROR_IDS.PERM_DENIED, "fa").body).toBe(
      "اجازهٔ انجام این تغییر را ندارید. از مدیر سامانه بخواهید دسترسی شما را بررسی کند.",
    );
  });
  it("formats supported phone audit metadata while preserving raw values and custom labels", () => {
    const entry = {
      field: "person.phones",
      oldValue: [{ label: "Work", value: "+98 912 000 0000", primary: true }],
      newValue: [
        { label: "VIP desk", value: "09120000001", primary: false },
        { label: "mobile", value: "09120000002", primary: true },
      ],
    };
    const original = JSON.stringify(entry);
    const label = formatChangeLabel(entry, "fa");
    const text = readable(label);
    expect(text).toContain(
      "از «+98 912 000 0000 (کاری، اصلی)» به «09120000001 (VIP desk)؛ 09120000002 (همراه، اصلی)»",
    );
    expect(label).toContain("\u2068");
    expect(label).toContain("\u2066+98 912 000 0000\u2069");
    expect(text).not.toContain('"primary"');
    expect(JSON.stringify(entry)).toBe(original);
  });
  it("renders English contact-point changes as meaningful values and metadata", () => {
    const label = readable(
      formatChangeLabel(
        {
          field: "person.emails",
          oldValue: [{ label: "Home", value: "old@example.com", primary: true }],
          newValue: [{ label: "Other", value: "new@example.com", primary: false }],
        },
        "en",
      ),
    );
    expect(label).toBe("Email: old@example.com (Home, Primary) → new@example.com (Other)");
  });
  it("preserves custom labels that overlap object property names", () => {
    expect(
      readable(
        formatChangeLabel(
          {
            field: "person.emails",
            oldValue: null,
            newValue: [{ label: "constructor", value: "custom@example.com", primary: false }],
          },
          "fa",
        ),
      ),
    ).toContain("custom@example.com (constructor)");
  });
  it("keeps unsupported audit shapes intact and isolates mixed-direction transition values", () => {
    const value = { label: "Custom", value: 12, extra: "keep" };
    expect(
      readable(
        formatChangeLabel({ field: "person.phones", oldValue: null, newValue: [value] }, "fa"),
      ),
    ).toContain(JSON.stringify(value));
    const label = formatChangeLabel(
      { field: "title", oldValue: "Acme (Europe)", newValue: "فروش تهران + Acme" },
      "fa",
    );
    expect(label).toContain("از «\u2068Acme (Europe)\u2069» به «\u2068فروش تهران + Acme\u2069»");
  });
  it("uses the unknown-field copy for unrecognized and prototype-like audit keys", () => {
    const unknownField = createAppTranslator("fa", "sales")("changeLog.unknownField");
    for (const field of ["unknown_field", "constructor", "toString", "__proto__"])
      expect(readable(formatChangeLabel({ field, oldValue: "قبل", newValue: "بعد" }, "fa"))).toBe(
        `${unknownField}: از «قبل» به «بعد»`,
      );
  });
});
