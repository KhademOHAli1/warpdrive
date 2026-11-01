// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, configure, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { emailMessagesForLocale } from "./emailMessages";
import { intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";

beforeEach(() => configure({ asyncUtilTimeout: 500 }));
afterEach(cleanup);

const descriptions = {
  en: "This copy matches the email service’s send acknowledgement. Your review does not change its send status.",
  fa: "این نسخه با تأیید پذیرش ارسال از سوی سرویس ایمیل مطابقت دارد. بازبینی شما وضعیت ارسال را تغییر نمی‌دهد.",
  de: "Diese Kopie entspricht der Versandbestätigung des E-Mail-Dienstes. Ihre Prüfung ändert den Sendestatus nicht.",
};

for (const locale of ["fa", "de", "en"] as const) {
  const text = emailMessagesForLocale(locale).privateIntake;
  it(`describes only the provider send acknowledgement of a confirmed ${locale} copy`, async () => {
    const f = renderPrivateIntake(
      {
        summary: {
          ...intakeSummary,
          state: "confirmed_notification",
          contentState: "purged",
          decision: "dismiss",
        },
      },
      locale,
    );
    await f.user.click(screen.getByRole("button", { name: text.review }));
    const dialog = screen.getByRole("dialog", { name: text.dialogTitle });
    expect(within(dialog).getByText(descriptions[locale])).toBeVisible();
    expect(within(dialog).queryByText(text.restrictions)).toBeNull();
    expect(within(dialog).getByText(text.contentRemoved)).toBeVisible();
    expect(f.onReview).not.toHaveBeenCalled();
  });

  for (const state of ["unverified", "conflict"] as const)
    it(`keeps ${state} ${locale} restrictions after an explicit local restore decision`, async () => {
      const f = renderPrivateIntake(
        { summary: { ...intakeSummary, state, decision: "restore_private" } },
        locale,
      );
      await f.user.click(screen.getByRole("button", { name: text.review }));
      const dialog = screen.getByRole("dialog", { name: text.dialogTitle });
      expect(within(dialog).getByText(text.restrictions)).toBeVisible();
      expect(within(dialog).queryByText(descriptions[locale])).toBeNull();
      expect(f.onReview).not.toHaveBeenCalled();
    });
}
