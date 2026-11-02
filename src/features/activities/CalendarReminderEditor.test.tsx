// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarReminderDefaultsEditor } from "./CalendarReminderDefaultsEditor";
import { CalendarReminderEditor } from "./CalendarReminderEditor";
import type { ReminderDefaults, ReminderSelection } from "./reminderPolicy";

const defaults: ReminderDefaults = {
  timed: [{ method: "notification", minutesBefore: 10 }],
  allDay: [{ method: "notification", daysBefore: 0, time: "09:00" }],
};
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function EventDraft({
  allDay = false,
  initial = { useDefault: true },
  changed = () => undefined,
  ...props
}: {
  allDay?: boolean;
  initial?: ReminderSelection;
  changed?: (value: ReminderSelection) => void;
} & Partial<
  Pick<
    React.ComponentProps<typeof CalendarReminderEditor>,
    "reveal" | "error" | "onRawChange" | "onValidityChange" | "emailCapability"
  >
>) {
  const [value, setValue] = useState<ReminderSelection>(initial);
  return (
    <CalendarReminderEditor
      value={value}
      defaults={defaults}
      allDay={allDay}
      timeZone="Asia/Tehran"
      emailCapability="available"
      {...props}
      onChange={(next) => {
        setValue(next);
        changed(next);
      }}
    />
  );
}

function DefaultsDraft({ changed }: { changed: (value: ReminderDefaults) => void }) {
  const [value, setValue] = useState(defaults);
  return (
    <CalendarReminderDefaultsEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        changed(next);
      }}
      timeZone="Europe/Berlin"
      emailCapability="available"
    />
  );
}

it.each([
  {
    locale: "fa",
    title: "یادآوری‌ها",
    useDefault: "استفاده از پیش‌فرض‌های تقویم من",
    minutes: "دقیقه پیش از رویداد برای یادآوری ۱",
    days: "روز پیش از رویداد برای یادآوری ۱",
    clock: "ساعت یادآوری ۱",
    five: "۵",
    ten: "۰۹:۰۰",
  },
  {
    locale: "de",
    title: "Erinnerungen",
    useDefault: "Meine Kalender-Vorgaben verwenden",
    minutes: "Minuten vor dem Termin für Erinnerung 1",
    days: "Tage vor dem Termin für Erinnerung 1",
    clock: "Uhrzeit für Erinnerung 1",
    five: "5",
    ten: "09:00",
  },
] as const)(
  "preserves both reminder groups through keyboard disclosure and all-day switching in $locale",
  async ({ locale, title, useDefault, minutes, days, clock, five, ten }) => {
    const changed = vi.fn();
    const view = render(
      <LocaleProvider locale={locale}>
        <EventDraft changed={changed} />
      </LocaleProvider>,
    );
    const trigger = screen.getByRole("button", { name: title });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await userEvent.setup().keyboard("{Enter}");
    fireEvent.click(screen.getByRole("checkbox", { name: useDefault }));
    fireEvent.change(screen.getByLabelText(minutes), { target: { value: five } });
    fireEvent.blur(screen.getByLabelText(minutes));
    fireEvent.click(trigger);
    expect(screen.queryByLabelText(minutes)).not.toBeVisible();
    view.rerender(
      <LocaleProvider locale={locale}>
        <EventDraft changed={changed} allDay />
      </LocaleProvider>,
    );
    fireEvent.click(trigger);
    expect(screen.getByLabelText(days)).toHaveValue(locale === "fa" ? "۰" : "0");
    expect(screen.getByLabelText(clock)).toHaveValue(ten);
    expect(screen.getByText("Asia/Tehran")).toBeVisible();
    view.rerender(
      <LocaleProvider locale={locale}>
        <EventDraft changed={changed} />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText(minutes)).toHaveValue(five);
    expect(changed).toHaveBeenLastCalledWith({
      useDefault: false,
      timed: [{ method: "notification", minutesBefore: 5 }],
      allDay: defaults.allDay,
    });
  },
);

it("keeps explicit no-reminder overrides when defaults are enabled then disabled", () => {
  const changed = vi.fn();
  render(<EventDraft initial={{ useDefault: false, timed: [], allDay: [] }} changed={changed} />);
  expect(screen.getByText("No reminders")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  const toggle = screen.getByRole("checkbox", { name: "Use my calendar defaults" });
  fireEvent.click(toggle);
  expect(changed).toHaveBeenLastCalledWith({ useDefault: true });
  fireEvent.click(toggle);
  expect(changed).toHaveBeenLastCalledWith({ useDefault: false, timed: [], allDay: [] });
  expect(
    screen.queryByLabelText("Minutes before the event for reminder 1"),
  ).not.toBeInTheDocument();
});

it("limits each group to five reminders and removes a selected row without changing the other group", async () => {
  const changed = vi.fn();
  render(
    <EventDraft
      initial={{ useDefault: false, timed: [], allDay: defaults.allDay }}
      changed={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  const add = screen.getByRole("button", { name: "Add reminder" });
  for (let index = 0; index < 5; index++) fireEvent.click(add);
  expect(add).toBeDisabled();
  expect(screen.getAllByRole("combobox", { name: /Delivery method for reminder/ })).toHaveLength(5);
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Delivery method for reminder 2" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("option", { name: "Email" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove reminder 1" }));
  expect(add).toBeEnabled();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      allDay: defaults.allDay,
      timed: expect.arrayContaining([expect.objectContaining({ method: "email" })]),
    }),
  );
});

it("preserves an invalid numeric draft across collapse and exposes validity to the containing form", async () => {
  const raw = vi.fn();
  const valid = vi.fn();
  const view = render(
    <EventDraft
      initial={{ useDefault: false, ...defaults }}
      onRawChange={raw}
      onValidityChange={valid}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  const minutes = screen.getByLabelText("Minutes before the event for reminder 1");
  fireEvent.change(minutes, { target: { value: "40321" } });
  fireEvent.blur(minutes);
  await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
  expect(raw).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
  view.rerender(
    <EventDraft
      initial={{ useDefault: false, ...defaults }}
      onRawChange={raw}
      onValidityChange={valid}
      reveal
      error="Review the reminder values."
    />,
  );
  expect(screen.getByRole("button", { name: "Reminders" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByLabelText("Minutes before the event for reminder 1")).toHaveValue("40321");
  expect(screen.getByText("Review the reminder values.")).toHaveAttribute("role", "alert");
});

it("accepts Persian all-day clock digits and explains unavailable email delivery", () => {
  const changed = vi.fn();
  const view = render(
    <LocaleProvider locale="fa">
      <EventDraft
        allDay
        initial={{ useDefault: false, ...defaults }}
        changed={changed}
        emailCapability="mailboxMissing"
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "یادآوری‌ها" }));
  expect(
    screen.getByText(
      "یادآوری ایمیلی به یک صندوق ایمیل متصل نیاز دارد. می‌توانید این انتخاب را نگه دارید.",
    ),
  ).toBeVisible();
  const clock = screen.getByLabelText("ساعت یادآوری ۱");
  fireEvent.change(clock, { target: { value: "۱۰:۳۰" } });
  fireEvent.blur(clock);
  expect(changed).toHaveBeenLastCalledWith({
    useDefault: false,
    timed: defaults.timed,
    allDay: [{ method: "notification", daysBefore: 0, time: "10:30" }],
  });
  view.rerender(
    <LocaleProvider locale="fa">
      <EventDraft
        allDay
        initial={{ useDefault: false, ...defaults }}
        changed={changed}
        emailCapability="channelDisabled"
      />
    </LocaleProvider>,
  );
  expect(
    screen.getByText(
      "یادآوری ایمیلی در تنظیمات اعلان شما خاموش است. می‌توانید این انتخاب را نگه دارید.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("ساعت یادآوری ۱")).toHaveValue("۱۰:۳۰");
});

it("edits personal timed and all-day defaults independently in one compact disclosure", () => {
  const changed = vi.fn();
  render(<DefaultsDraft changed={changed} />);
  const trigger = screen.getByRole("button", { name: "My reminder defaults" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  const timed = screen.getByRole("group", { name: "Timed events" });
  const allDay = screen.getByRole("group", { name: "All-day events" });
  expect(
    within(allDay).getByText(
      "0 days means the event date. Clock times follow each event’s own time zone.",
    ),
  ).toBeVisible();
  fireEvent.change(within(timed).getByLabelText("Minutes before the event for reminder 1"), {
    target: { value: "30" },
  });
  fireEvent.change(within(allDay).getByLabelText("Days before the event for reminder 1"), {
    target: { value: "2" },
  });
  expect(changed).toHaveBeenLastCalledWith({
    timed: [{ method: "notification", minutesBefore: 30 }],
    allDay: [{ method: "notification", daysBefore: 2, time: "09:00" }],
  });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(within(timed).getByLabelText("Minutes before the event for reminder 1")).toHaveValue("30");
});

it("reveals an invalid inactive rule group instead of allowing a schema-invalid hidden draft", async () => {
  const valid = vi.fn();
  const initial: ReminderSelection = {
    useDefault: false,
    timed: [
      { method: "notification", minutesBefore: 10 },
      { method: "notification", minutesBefore: 10 },
    ],
    allDay: defaults.allDay,
  };
  const view = render(<EventDraft allDay initial={initial} onValidityChange={valid} />);
  await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
  view.rerender(
    <EventDraft
      allDay
      initial={initial}
      onValidityChange={valid}
      reveal
      error="Review the reminder values."
    />,
  );
  const timed = screen.getByRole("group", { name: "Timed events" });
  expect(timed).toBeVisible();
  fireEvent.change(within(timed).getByLabelText("Minutes before the event for reminder 2"), {
    target: { value: "30" },
  });
  await waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
  expect(within(timed).getByLabelText("Minutes before the event for reminder 2")).toBeVisible();
});
