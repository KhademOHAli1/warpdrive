// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { PasswordFlow } from "./PasswordFlow";

const { requestPasswordReset, resetPassword, verifyEmail } = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
}));
vi.mock("../better/client", () => ({
  authClient: { requestPasswordReset, resetPassword, verifyEmail },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("uses the same German reset acknowledgement for an eligible or unknown email", async () => {
  requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
  render(
    <LocaleProvider locale="de">
      <PasswordFlow mode="forgot" />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
    target: { value: "ali@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Link zum Zurücksetzen senden" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Wenn eine Wiederherstellung für diese Adresse möglich ist",
  );
  expect(requestPasswordReset).toHaveBeenCalledWith(
    expect.objectContaining({ email: "ali@example.com", redirectTo: "/auth/reset-password" }),
  );
});
it("blocks mismatched Persian reset passwords before calling the endpoint", async () => {
  render(
    <LocaleProvider locale="fa">
      <PasswordFlow mode="reset" token="reset-token" />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("گذرواژه جدید"), {
    target: { value: "long private passphrase" },
  });
  fireEvent.change(screen.getByLabelText("تکرار گذرواژه"), {
    target: { value: "different passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "تغییر گذرواژه" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("گذرواژه‌ها یکسان نیستند."),
  );
  expect(resetPassword).not.toHaveBeenCalled();
});

it("offers a real resend route after a German verification link expires", async () => {
  verifyEmail.mockResolvedValue({ error: { code: "INVALID_VERIFICATION_TOKEN" } });
  render(
    <LocaleProvider locale="de">
      <PasswordFlow mode="verify" token="expired-verification" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "E-Mail bestätigen" }));
  expect(await screen.findByRole("link", { name: "Bestätigungs-E-Mail senden" })).toHaveAttribute(
    "href",
    "/auth/verify-email",
  );
});

it("explains a Farsi account mismatch and offers sign-out before retrying the same link", async () => {
  verifyEmail.mockResolvedValue({ error: { code: "VERIFICATION_ACCOUNT_MISMATCH" } });
  render(
    <LocaleProvider locale="fa">
      <PasswordFlow mode="verify" token="another-account-link" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "تأیید ایمیل" }));
  expect(
    await screen.findByRole("button", { name: "خروج از حساب فعلی و تأیید این حساب" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("حساب دیگری");
});

it("explains that old-address confirmation still requires the new inbox", async () => {
  verifyEmail.mockResolvedValue({ data: { status: true }, error: null });
  render(
    <LocaleProvider locale="de">
      <PasswordFlow mode="verify" token="old-address-confirmation" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "E-Mail bestätigen" }));
  expect(await screen.findByRole("status")).toHaveTextContent("neue E-Mail-Adresse");
  expect(screen.queryByRole("link", { name: "Zum Arbeitsbereich" })).toBeNull();
  expect(verifyEmail).toHaveBeenCalledWith({ query: { token: "old-address-confirmation" } });
});

it("confirms a completed Farsi verification and offers sign-in", async () => {
  verifyEmail.mockResolvedValue({ data: { status: true, user: null }, error: null });
  render(
    <LocaleProvider locale="fa">
      <PasswordFlow mode="verify" token="initial-verification" />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "تأیید ایمیل" }));
  expect(await screen.findByRole("status")).toHaveTextContent("نشانی ایمیل تأیید شد");
  expect(screen.getByRole("link", { name: "ورود" })).toHaveAttribute("href", "/login");
});
