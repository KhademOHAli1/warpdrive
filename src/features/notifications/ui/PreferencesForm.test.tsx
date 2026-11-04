// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationType } from "@/constants/notificationTypes";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { messagesForLocale } from "@/features/i18n/catalog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import {
  type NotificationPreference,
  type PreferenceSaveFeedback,
  PreferencesForm,
} from "./PreferencesForm";

afterEach(cleanup);

const allFalse = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type, { inApp: false, email: false }]),
) as Record<NotificationType, { inApp: boolean; email: boolean }>;
const labels = messagesForLocale("en").notifications.preferences;

function row(name: string) {
  return within(screen.getByRole("group", { name }));
}

function RetryingPreferences({
  pending,
  onRetry,
  onChange,
}: {
  pending: Promise<void>;
  onRetry: (type: NotificationType) => void;
  onChange: (type: NotificationType, next: NotificationPreference) => void;
}) {
  const [feedback, setFeedback] = useState<PreferenceSaveFeedback>("error");
  return (
    <PreferencesForm
      prefs={allFalse}
      onChange={onChange}
      feedback={{ mention: feedback }}
      onRetry={(type) => {
        onRetry(type);
        setFeedback("saving");
        void pending.then(() => setFeedback("saved"));
      }}
    />
  );
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

  it.each(["en", "de", "fa"] as const)(
    "retains meaningful row focus through keyboard Retry, saving and success in %s",
    async (locale) => {
      const user = userEvent.setup();
      const messages = messagesForLocale(locale);
      const L = settingsMessagesForLocale(locale);
      const event = messages.notifications.preferences.typeLabels.mention;
      const onRetry = vi.fn();
      const onChange = vi.fn();
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      render(
        <LocaleProvider locale={locale}>
          <RetryingPreferences pending={pending} onRetry={onRetry} onChange={onChange} />
        </LocaleProvider>,
      );
      const group = screen.getByRole("group", { name: event });
      const controls = within(group);
      const heading = controls.getByText(event, { exact: true });
      const [inApp, email] = controls.getAllByRole("switch");
      const retry = controls.getByRole("button", { name: messages.boundaries.retry });
      await user.tab();
      expect(inApp).toHaveFocus();
      await user.tab();
      expect(email).toHaveFocus();
      await user.tab();
      expect(retry).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(onRetry).toHaveBeenCalledExactlyOnceWith("mention");
      expect(heading).toHaveFocus();
      expect(heading).toHaveAttribute("tabindex", "-1");
      expect(group).toHaveAttribute("aria-busy", "true");
      expect(inApp).toBeDisabled();
      expect(email).toBeDisabled();
      expect(controls.queryByRole("button")).not.toBeInTheDocument();
      expect(controls.getByRole("status")).toHaveTextContent(L._extra.saving);
      expect(onChange).not.toHaveBeenCalled();

      await act(async () => {
        finish();
        await pending;
      });
      expect(controls.getByText(event, { exact: true })).toBe(heading);
      expect(heading).toHaveFocus();
      expect(group).toHaveAttribute("aria-busy", "false");
      expect(controls.getByRole("status")).toHaveTextContent(L.saved);
      expect(inApp).toBeEnabled();
      expect(email).toBeEnabled();
      expect(controls.queryByRole("alert")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

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
