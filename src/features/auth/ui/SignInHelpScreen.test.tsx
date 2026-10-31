// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { SignInHelpScreen } from "./SignInHelpScreen";
import type * as WorkflowRequest from "./workflowRequest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./workflowRequest", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkflowRequest>()),
  workflowRequest: request,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe.each(["fa", "de", "en"] as const)("%s sign-in assistance", (locale) => {
  it("separates password reset from reviewed recovery and preserves the return destination", async () => {
    request.mockResolvedValue({ ok: true, data: {} });
    const L = authScreensMessagesForLocale(locale).flow;
    render(
      <LocaleProvider locale={locale}>
        <SignInHelpScreen
          config={{ emailPassword: true, passkeys: true, providers: [] }}
          returnTo="/activities/calendar?view=month"
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading", { name: L.signInHelpTitle, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: L.resetTitle })).toHaveAttribute(
      "href",
      "/auth/forgot-password",
    );
    if (locale === "fa")
      expect(screen.getByRole("link", { name: "بازنشانی گذرواژه" })).toBeInTheDocument();
    expect(screen.getByText(L.passwordResetHelp)).toBeInTheDocument();
    expect(screen.getByText(L.recoveryCodeHelp)).toBeInTheDocument();
    expect(screen.queryByLabelText(L.recoveryCode)).toBeNull();
    expect(screen.getByRole("link", { name: L.backToLogin })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Factivities%2Fcalendar%3Fview%3Dmonth",
    );
    fireEvent.change(screen.getByLabelText(L.email), {
      target: { value: "unknown@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: L.requestRecovery }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "recovery-request",
        expect.anything(),
        expect.any(AbortSignal),
        { email: "unknown@example.com" },
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(L.recoveryRequested);
  });
});

it("does not advertise password reset when the workspace disables passwords", () => {
  const L = authScreensMessagesForLocale("de").flow;
  render(
    <LocaleProvider locale="de">
      <SignInHelpScreen config={{ emailPassword: false, passkeys: true, providers: [] }} />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("link", { name: L.resetTitle })).toBeNull();
  expect(screen.getByRole("button", { name: L.requestRecovery })).toBeInTheDocument();
});

it("rejects an external return destination", () => {
  render(
    <LocaleProvider locale="en">
      <SignInHelpScreen
        config={{ emailPassword: true, passkeys: false, providers: [] }}
        returnTo="https://attacker.invalid/"
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
    "href",
    "/login?returnTo=%2Fpipeline",
  );
});
