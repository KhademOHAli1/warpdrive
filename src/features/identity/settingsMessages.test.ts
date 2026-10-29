import { describe, expect, it } from "vitest";
import {
  settingsIdentityError,
  settingsImportError,
  settingsMessagesForLocale,
} from "./settingsMessages";

describe("localized settings messages", () => {
  it("preserves the English field/function/step contracts", () => {
    const s = settingsMessagesForLocale("en");
    expect(s.profile).toBe("Personal preferences");
    expect(s.importer.result(2, 1, 0)).toBe("2 imported, 1 skipped, 0 failed");
    expect(s.mcpConnectSteps[0]).toContain("Open Settings");
  });

  it("provides contextual Persian copy, numbers, and safe action errors", () => {
    const s = settingsMessagesForLocale("fa");
    expect(s.profile).toBe("تنظیمات شخصی");
    expect(s.importer.rowsDetected(12)).toContain("۱۲");
    expect(s._emailSync.connectedAs("demo@example.com")).toContain("demo@example.com");
    expect(settingsIdentityError(s, "cannot deactivate yourself")).toBe(
      "نمی‌توانید حساب خودتان را غیرفعال کنید.",
    );
    expect(settingsIdentityError(s, "unknown_internal_failure")).toBe(s._errors.generic);
  });
});

it("translates persisted import diagnostics without changing the English diagnostic contract", () => {
  const fa = settingsMessagesForLocale("fa");
  expect(settingsImportError(fa, "unknown pipeline: فروش شرق", "fa")).toBe(
    "مسیر فروش پیدا نشد: فروش شرق",
  );
  expect(settingsImportError(fa, "ambiguous match: 12 existing contacts", "fa")).toContain("۱۲");
  expect(settingsImportError(fa, "Invalid input", "fa")).toBe(fa._extra.importErrors.invalid);
  expect(
    settingsImportError(settingsMessagesForLocale("en"), "unknown pipeline: Sales", "en"),
  ).toBe("unknown pipeline: Sales");
});

it("describes regional timezone fallback and request quotas precisely", () => {
  const en = settingsMessagesForLocale("en");
  const fa = settingsMessagesForLocale("fa");
  expect(en.timezoneNone).toBe("Use regional preference (UTC fallback)");
  expect(fa.timezoneNone).toBe("طبق تنظیمات منطقه‌ای (پیش‌فرض: UTC)");
  expect(fa._enrichment.settings.testQuotaHourly(12)).toBe("۱۲ درخواست در ساعت جاری");
  expect(fa._enrichment.settings.testQuotaDaily(5)).toBe("۵ درخواست امروز");
  expect(fa._extra.activityGoalDisplayLabel("completed", "ماهانه")).toBe(
    "فعالیت‌های انجام‌شده، ماهانه",
  );
  expect(fa._extra.activityGoalDisplayLabel("added", "هفتگی")).toBe("فعالیت‌های ایجادشده، هفتگی");
});
