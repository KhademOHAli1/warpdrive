// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "./IdentityActionError";

afterEach(cleanup);
test("a Farsi fresh-authentication error links directly to the security workflow", () => {
  render(
    <LocaleProvider locale="fa">
      <IdentityActionError message="fresh_auth_required" />
    </LocaleProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("هویت");
  expect(screen.getByRole("link", { name: "تنظیمات امنیتی" })).toHaveAttribute(
    "href",
    "/settings/security",
  );
});
