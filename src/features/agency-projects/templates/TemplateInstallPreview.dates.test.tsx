// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { formatDateOnly, formatNumber } from "@/lib/localeFormatting";
import {
  detail,
  dueDates,
  namedList,
  previewPacket,
  previewRegion,
  previewView,
  projectStart,
  renderPreview,
  rowFor,
  staffLabel,
} from "./TemplateInstallPreview.test-support";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
afterEach(cleanup);

it("shows signed calendar-day offsets, including weekends and holidays, without sorting by due date", () => {
  renderPreview();
  expect(previewRegion()).toHaveTextContent(
    "Calendar days from project start, including weekends and holidays.",
  );
  const list = namedList("Planned items");
  for (const [label, days] of [
    ["Review model", 2],
    ["Follow up briefing", -1],
    ["Model assignment", 0],
  ] as const) {
    expect(detail(rowFor(list, label), "Calendar-day offset")).toHaveTextContent(
      formatNumber(days, { locale: "en", numberingSystem: "latn" }, { signDisplay: "always" }),
    );
  }
});

it.each([
  {
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    title: "پیش‌نمایش محتوای الگو",
    items: "موارد برنامه‌ریزی‌شده",
    template: "تولید مدل",
    dir: "rtl",
  },
  {
    locale: "de",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "America/New_York",
    title: "Inhaltsvorschau der Vorlage",
    items: "Geplante Einträge",
    template: "Modellproduktion",
    dir: "ltr",
  },
  {
    locale: "en",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
    title: "Template contents preview",
    items: "Planned items",
    template: "Model production",
    dir: "ltr",
  },
] as const)(
  "$locale keeps calendar, digits and zone independent for strict civil dates",
  (preferences) => {
    renderPreview(previewPacket(), preferences);
    const region = previewRegion(preferences.title);
    expect(region).toHaveAttribute("dir", preferences.dir);
    expect(region).toHaveTextContent(preferences.template);
    const start = region.querySelector("time");
    expect(start).toHaveAttribute("datetime", projectStart);
    expect(start).toHaveTextContent(formatDateOnly(projectStart, preferences));
    const items = within(region).getByRole("list", { name: preferences.items });
    const times = Array.from(items.querySelectorAll("time"));
    expect(times.map((time) => time.dateTime)).toEqual(dueDates);
    expect(times.map((time) => time.textContent)).toEqual(
      dueDates.map((date) => formatDateOnly(date, preferences)),
    );
  },
);

it.each([
  {
    name: "wrong role kind",
    bindings: [
      {
        roleId: "producer",
        kind: "external-contact",
        personId: "abcdefab-1234-4abc-8def-1234567890ab",
      },
    ],
  },
  { name: "non-array bindings", bindings: { roleId: "producer" } },
])("clears the previous dated/bound projection for $name", ({ bindings }) => {
  const packet = previewPacket();
  const view = render(previewView(packet));
  view.rerender(
    previewView({
      ...packet,
      target: { ...packet.target, selectionKey: "draft-selection:2" },
      bindings,
    }),
  );
  const region = previewRegion();
  expect(within(region).getByRole("alert")).toHaveTextContent("Check the selected role bindings.");
  expect(region.querySelector("time")).toBeNull();
  expect(within(region).queryByRole("list")).not.toBeInTheDocument();
  expect(region).not.toHaveTextContent(staffLabel);
});

it.each([
  { name: "final newline", start: "2027-03-21\n" },
  { name: "derived date outside the supported range", start: "9999-12-31" },
])("clears the previous projection for a $name", ({ start }) => {
  const packet = previewPacket();
  const view = render(previewView(packet));
  view.rerender(
    previewView({
      ...packet,
      target: { ...packet.target, selectionKey: "draft-selection:2" },
      projectStart: start,
    }),
  );
  const region = previewRegion();
  expect(within(region).getByRole("alert")).toHaveTextContent(
    "Check the project start and derived dates.",
  );
  expect(region.querySelector("time")).toBeNull();
  expect(within(region).queryByRole("list")).not.toBeInTheDocument();
});

it("checks the start date even when no template items need arithmetic", () => {
  const packet = previewPacket();
  render(
    previewView({
      ...packet,
      manifest: { ...packet.manifest, intents: [] },
      projectStart: "0000-01-01",
    }),
  );
  const region = previewRegion();
  expect(within(region).getByRole("alert")).toHaveTextContent(
    "Check the project start and derived dates.",
  );
  expect(region.querySelector("time")).toBeNull();
});

it("recomputes a replacement selection after invalid input without reusing prior dates or mappings", () => {
  const packet = previewPacket();
  const view = render(previewView(packet));
  view.rerender(
    previewView({
      ...packet,
      target: { ...packet.target, selectionKey: "draft-selection:2" },
      projectStart: "invalid",
    }),
  );
  expect(previewRegion().querySelector("time")).toBeNull();
  view.rerender(
    previewView({
      ...packet,
      target: { ...packet.target, selectionKey: "draft-selection:3" },
      projectStart: "2027-03-22",
      bindings: [],
    }),
  );
  const times = Array.from(namedList("Planned items").querySelectorAll("time"));
  expect(times.map((time) => time.dateTime)).toEqual(["2027-03-24", "2027-03-21", "2027-03-22"]);
  expect(previewRegion()).not.toHaveTextContent(staffLabel);
  expect(within(namedList("Roles")).getAllByText("Not mapped")).toHaveLength(3);
});
