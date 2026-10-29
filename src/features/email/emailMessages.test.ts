import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { sendFailureMessage } from "./composer/sendFailure";
import { emailMessagesForLocale } from "./emailMessages";

describe("Persian email chrome", () => {
  it("preserves contextual names and evaluates tracking plurals with numeric input", () => {
    const s = emailMessagesForLocale("fa");
    expect(s.title).toBe("صندوق ورودی");
    expect(s.createLabel("پیگیری سارا")).toContain("پیگیری سارا");
    expect(s.trackingOpened(12)).toContain("۱۲");
    expect(s.trackingOpened(12)).not.toContain("NaN");
  });
  it("distinguishes an unconfirmed send from a confirmed failure in Persian", () => {
    const s = emailMessagesForLocale("fa");
    expect(sendFailureMessage(ERROR_IDS.UI_ACTION_UNCONFIRMED, s)).toBe(
      s._composer.sendUnconfirmed,
    );
    expect(sendFailureMessage(ERROR_IDS.GMAIL_GRANT_REVOKED, s)).toContain("دوباره متصل");
  });
});
