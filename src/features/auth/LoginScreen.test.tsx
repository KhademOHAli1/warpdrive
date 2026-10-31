// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LoginScreen } from "./LoginScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
afterEach(cleanup);
it("explains a failed sign-in in Persian while preserving the Google auth entry point", () => {
  render(
    <LocaleProvider locale="fa">
      <LoginScreen
        failed
        config={{
          emailPassword: true,
          passkeys: true,
          providers: [{ id: "google", name: "Google" }],
        }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("heading", { name: "ورود به Warpdrive" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("ورود انجام نشد.");
  expect(screen.getByRole("button", { name: "ورود با حساب گوگل" })).toBeInTheDocument();
});
it("preserves the English sign-in screen without an error by default", () => {
  render(<LoginScreen config={{ emailPassword: true, passkeys: false, providers: [] }} />);
  expect(screen.getByRole("heading", { name: "Sign in to Warpdrive" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
