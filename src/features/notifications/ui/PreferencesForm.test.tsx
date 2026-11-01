// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationType } from "@/constants/notificationTypes";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { messagesForLocale } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { PreferencesForm } from "./PreferencesForm";

afterEach(cleanup);

const allFalse = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type, { inApp: false, email: false }]),
) as Record<NotificationType, { inApp: boolean; email: boolean }>;
const labels = messagesForLocale("en").notifications.preferences;

function row(name: string) {
  return within(screen.getByRole("group", { name }));
}

describe("PreferencesForm", () => {
  it.each(["en", "de", "fa"] as const)(
    "identifies every switch by its event and channel in %s",
    (locale) => {
      const messages = messagesForLocale(locale).notifications.preferences;
      render(
        <LocaleProvider locale={locale}>
          <PreferencesForm prefs={allFalse} onChange={() => {}} />
        </LocaleProvider>,
      );
      expect(screen.getAllByTestId("pref-row")).toHaveLength(NOTIFICATION_TYPES.length);
      for (const type of NOTIFICATION_TYPES) {
        for (const channel of [messages.columnInApp, messages.columnEmail]) {
          expect(
            screen.getByRole("switch", { name: `${messages.typeLabels[type]}: ${channel}` }),
          ).toHaveAttribute("aria-checked", "false");
        }
      }
    },
  );

  it("keeps channel labels associated with their switches", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PreferencesForm prefs={allFalse} onChange={onChange} />);
    await user.click(row(labels.typeLabels.mention).getByText(labels.columnInApp));
    expect(onChange).toHaveBeenCalledWith("mention", { inApp: true, email: false });
  });

  it("preserves the other channel when a preference changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PreferencesForm
        prefs={{ ...allFalse, mention: { inApp: true, email: true } }}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("switch", { name: `${labels.typeLabels.mention}: ${labels.columnEmail}` }),
    );
    expect(onChange).toHaveBeenCalledWith("mention", { inApp: true, email: false });
  });

  it("locks only the saving event and announces its state", () => {
    render(
      <PreferencesForm prefs={allFalse} onChange={() => {}} feedback={{ mention: "saving" }} />,
    );
    for (const toggle of row(labels.typeLabels.mention).getAllByRole("switch")) {
      expect(toggle).toBeDisabled();
    }
    expect(row(labels.typeLabels.mention).getByRole("status")).toHaveTextContent("Saving");
    expect(row(labels.typeLabels.mention).getByRole("status")).toHaveTextContent(
      labels.typeLabels.mention,
    );
    expect(row(labels.typeLabels.activity_assigned).getAllByRole("switch")[0]).toBeEnabled();
  });

  it("offers an event-specific retry beside failed preferences", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <PreferencesForm
        prefs={allFalse}
        onChange={() => {}}
        feedback={{ mention: "error" }}
        onRetry={onRetry}
      />,
    );
    expect(row(labels.typeLabels.mention).getByRole("alert")).toHaveTextContent("Failed to save");
    await user.click(row(labels.typeLabels.mention).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith("mention");
  });
});
