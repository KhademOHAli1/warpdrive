// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LoginScreen } from "./LoginScreen";

afterEach(cleanup);
it("explains a failed sign-in in Persian while preserving the Google auth entry point", () => {
  render(
    <LocaleProvider locale="fa">
      <LoginScreen failed />
    </LocaleProvider>,
  );
  expect(screen.getByRole("heading", { name: "ورود به Warpdrive" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("ورود انجام نشد.");
  expect(screen.getByRole("link", { name: "ورود با حساب گوگل" })).toHaveAttribute(
    "href",
    "/auth/start",
  );
});
it("preserves the English sign-in screen without an error by default", () => {
  render(<LoginScreen />);
  expect(screen.getByRole("heading", { name: "Sign in to Warpdrive" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
