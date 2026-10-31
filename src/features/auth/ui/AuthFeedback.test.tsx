// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { AuthFeedback } from "./useAuthAction";

afterEach(cleanup);
it("offers a recovery path when fresh verification expires while a form is open", () => {
  const L = authScreensMessagesForLocale("de").flow;
  render(
    <LocaleProvider locale="de">
      <AuthFeedback error={L.freshRequired} notice={null} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("link", { name: L.confirmIdentity })).toHaveAttribute(
    "href",
    "/settings/security",
  );
});
