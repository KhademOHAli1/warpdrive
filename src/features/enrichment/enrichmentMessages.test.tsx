// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENRICHMENT_STRINGS } from "@/constants/enrichmentStrings";
import { ERROR_IDS } from "@/constants/errorIds";
import type * as LocaleProviderModule from "@/features/i18n/LocaleProvider";
import { EnrichDialog } from "./EnrichDialog";
import { EnrichFieldRow } from "./EnrichFieldRow";
import { canonicalFieldLabel, enrichmentMessagesForLocale } from "./enrichmentMessages";
import { failureReasonsText } from "./failureReasons";
import { overwriteNotice } from "./overwriteNotice";
import { ProspectFilters } from "./prospects/ProspectFilters";
import { ProspectRevealStep } from "./prospects/ProspectRevealStep";
import { messageForOutcome, revealErrorId, revealErrorMessage } from "./prospects/searchMessage";
import type { RunView } from "./service";
import type { ProposedField } from "./types";

const preferences = vi.hoisted(() => ({
  locale: "fa",
  calendar: "persian",
  timeZone: "UTC",
  numberingSystem: "arabext",
}));
vi.mock("@/features/i18n/LocaleProvider", async () => {
  const actual = await vi.importActual<typeof LocaleProviderModule>(
    "@/features/i18n/LocaleProvider",
  );
  return { ...actual, useLocalePreferences: () => preferences };
});
beforeEach(() => {
  preferences.locale = "fa";
  preferences.timeZone = "UTC";
  preferences.numberingSystem = "arabext";
});
afterEach(cleanup);

describe("enrichment display messages", () => {
  it("preserves English plural semantics and formats raw Farsi numeric ICU arguments", () => {
    const en = enrichmentMessagesForLocale("en");
    const fa = enrichmentMessagesForLocale("fa");
    for (const count of [0, 1, 2, 1234]) {
      expect(en.dialog.apply(count)).toBe(ENRICHMENT_STRINGS.dialog.apply(count));
    }
    expect(fa.dialog.apply(12)).toContain("۱۲");
    expect(fa.prospects.revealProgress(2, 15)).toContain("۲");
    expect(fa.prospects.revealProgress(2, 15)).toContain("۱۵");
    expect(enrichmentMessagesForLocale("fa", "latn").dialog.apply(12)).toContain("12");
  });

  it("resolves canonical display names while preserving unknown/custom names and identifiers", () => {
    const fa = enrichmentMessagesForLocale("fa");
    expect(canonicalFieldLabel("person.title", "Job title", fa, "fa")).toBe("عنوان شغلی");
    expect(canonicalFieldLabel("custom:region", "منطقه مشتری", fa, "fa")).toBe("منطقه مشتری");
    expect(canonicalFieldLabel("person.linkedinUrl", "LinkedIn", fa, "en")).toBe("LinkedIn");
    expect(fa.seniority.c_suite).toBe("مدیریت ارشد اجرایی");
  });

  it("uses safe localized provider explanations without leaking provider diagnostics", () => {
    const fa = enrichmentMessagesForLocale("fa");
    const message = messageForOutcome(
      {
        provider: "apollo",
        kind: "provider_error",
        message: "Provider returned 422: secret-debug",
      },
      "Acme",
      fa,
    );
    expect(message?.body).toMatch(/ارائه‌دهنده|سرویس/);
    expect(message?.body).not.toContain("422");
    expect(message?.body).not.toContain("secret-debug");
    expect(
      messageForOutcome({ provider: "apollo", kind: "not_entitled" }, "Acme", fa)?.body,
    ).toContain("Apollo");
    expect(revealErrorMessage(ERROR_IDS.PERM_DENIED, fa)).toBe(fa.prospects.itemDenied);
    expect(revealErrorId(ERROR_IDS.PERM_DENIED)).toBe(ERROR_IDS.PERM_DENIED);
    expect(revealErrorId(ERROR_IDS.ENRICH_SELECTION_TOO_LARGE)).toBe(
      ERROR_IDS.ENRICH_SELECTION_TOO_LARGE,
    );
    expect(revealErrorId("arbitrary backend prose")).toBe(ERROR_IDS.ENRICH_ALL_FAILED);
    expect(revealErrorMessage("arbitrary backend prose", fa)).toBe(fa.prospects.revealFailed);
    expect(fa.outcome.quota).toContain("اعتبار");
  });

  it("localizes overwrite and known outcome reasons while preserving existing values", () => {
    const fa = enrichmentMessagesForLocale("fa");
    const field = {
      canonicalKey: "person.title",
      isOverwrite: true,
      currentValue: "مدیر Sales",
    } as ProposedField;
    expect(overwriteNotice(field, fa)).toContain("مدیر Sales");
    expect(overwriteNotice(field, fa)).not.toContain("Overwrites");
    expect(
      failureReasonsText(
        { reasons: { apollo: "quota", rocketreach: "timeout", unknown: "future_kind" } },
        fa,
      ),
    ).toContain(fa.outcome.quota);
  });
});

it("shows Persian canonical labels and numeric values while submitting the original radio value", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const field: ProposedField = {
    canonicalKey: "org.employeeCount",
    label: "Employee count",
    values: [
      { value: 1200, providers: ["apollo"] },
      { value: 2400, providers: ["rocketreach"] },
    ],
    selectedValue: 1200,
    currentValue: null,
    isOverwrite: false,
    currentInvalid: false,
    supportsPrimary: false,
    defaultMakePrimary: false,
    defaultSelected: true,
  };
  render(
    <EnrichFieldRow
      field={field}
      checked
      selectedValue="1200"
      makePrimary={false}
      onCheckedChange={() => {}}
      onValueChange={onValueChange}
      onMakePrimaryChange={() => {}}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "تعداد کارکنان" })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "۲٬۴۰۰" }));
  expect(onValueChange).toHaveBeenCalledWith("2400");
});

it("localizes reveal progress and hides arbitrary raw exception prose", () => {
  render(
    <ProspectRevealStep
      status="error"
      processed={2}
      total={12}
      failures={0}
      stopping={false}
      error="backend internal secret"
      onStop={() => {}}
    />,
  );
  expect(screen.getByRole("progressbar")).toHaveAccessibleName(
    enrichmentMessagesForLocale("fa").prospects.revealProgress(2, 12),
  );
  expect(screen.queryByText(/backend internal secret/)).not.toBeInTheDocument();
});

it("localizes filter accessible names and seniority options while retaining request values", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <ProspectFilters
      value={{ provider: "apollo", title: "", seniorities: [] }}
      providers={["apollo"]}
      busy={false}
      onChange={onChange}
      onSearch={() => {}}
    />,
  );
  expect(screen.getByRole("combobox", { name: "جست‌وجو با" })).toHaveTextContent("Apollo");
  expect(screen.getByPlaceholderText("مثلاً مدیر همکاری‌ها")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "سطح شغلی" }));
  await user.click(screen.getByRole("option", { name: "مدیریت ارشد اجرایی" }));
  expect(onChange).toHaveBeenCalledWith({
    provider: "apollo",
    title: "",
    seniorities: ["c_suite"],
  });
});

it("keeps review selections across a language change and applies the original numeric field", async () => {
  const user = userEvent.setup();
  const onApply = vi.fn();
  const field: ProposedField = {
    canonicalKey: "org.employeeCount",
    label: "Employee count",
    values: [{ value: 1200, providers: ["apollo"] }],
    selectedValue: 1200,
    currentValue: null,
    isOverwrite: false,
    currentInvalid: false,
    supportsPrimary: false,
    defaultMakePrimary: false,
    defaultSelected: true,
  };
  const run = {
    runId: "run-1",
    entityType: "organization",
    fields: [field],
    outcomes: [],
    cached: false,
    createdAtIso: "2026-10-29T10:00:00Z",
  } as unknown as RunView;
  const props = {
    open: true,
    entityName: "Acme",
    state: { kind: "loaded" as const, run },
    applyBusy: false,
    applyError: null,
    onRefresh: () => {},
    onApply,
    onOpenChange: () => {},
  };
  const view = render(<EnrichDialog {...props} />);
  await user.click(screen.getByRole("checkbox", { name: "تعداد کارکنان" }));
  preferences.locale = "en";
  preferences.numberingSystem = "latn";
  view.rerender(<EnrichDialog {...props} />);
  expect(screen.getByRole("checkbox", { name: "Employee count" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Apply 0 fields" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Employee count" }));
  await user.click(screen.getByRole("button", { name: "Apply 1 field" }));
  expect(onApply).toHaveBeenCalledWith([{ canonicalKey: "org.employeeCount", value: 1200 }]);
});

it("localizes a semantic error after a language change and formats retry time in the selected zone", () => {
  preferences.timeZone = "Asia/Tehran";
  const props = {
    open: true,
    entityName: "Acme",
    state: {
      kind: "error" as const,
      message: "",
      errorId: ERROR_IDS.ENRICH_THROTTLED,
      errorContext: { earliestRetryIso: "2026-10-29T10:00:00Z" },
      canRefresh: true,
    },
    applyBusy: false,
    applyError: null,
    onRefresh: () => {},
    onApply: () => {},
    onOpenChange: () => {},
  };
  const view = render(<EnrichDialog {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("۱۳:۳۰");
  preferences.locale = "en";
  preferences.numberingSystem = "latn";
  view.rerender(<EnrichDialog {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Every provider is rate limited");
  expect(screen.getByRole("alert")).toHaveTextContent("13:30");
});
