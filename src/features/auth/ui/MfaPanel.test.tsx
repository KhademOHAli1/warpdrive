// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MfaPanel } from "./MfaPanel";

const { verifyTotp, verifyBackupCode, enable, passkey } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  enable: vi.fn(),
  passkey: vi.fn(),
}));
vi.mock("../better/client", () => ({
  authClient: {
    twoFactor: { verifyTotp, verifyBackupCode, enable, passkey },
    signIn: { passkey },
    passkey: { addPasskey: vi.fn() },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("preserves a Persian OTP's leading zero when completing the challenge", async () => {
  verifyTotp.mockResolvedValue({ data: { token: "opaque" }, error: null });
  const done = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <MfaPanel mode="challenge" onComplete={done} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("کد برنامه رمزساز"), { target: { value: "۰۱۲۳۴۵" } });
  fireEvent.click(screen.getByRole("button", { name: "تأیید کد" }));
  await waitFor(() =>
    expect(verifyTotp).toHaveBeenCalledWith(expect.objectContaining({ code: "012345" })),
  );
  expect(done).toHaveBeenCalledOnce();
});
it("switches German recovery mode and sends the exact authored recovery secret", async () => {
  verifyBackupCode.mockResolvedValue({ data: {}, error: null });
  render(
    <LocaleProvider locale="de">
      <MfaPanel mode="challenge" onComplete={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Wiederherstellungscode verwenden" }));
  fireEvent.change(screen.getByLabelText("Wiederherstellungscode"), {
    target: { value: "AbCD-0001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Code bestätigen" }));
  await waitFor(() =>
    expect(verifyBackupCode).toHaveBeenCalledWith(expect.objectContaining({ code: "AbCD-0001" })),
  );
});

it("offers a passkey challenge for accounts without an authenticator", async () => {
  passkey.mockResolvedValue({ data: {}, error: null });
  const done = vi.fn();
  render(
    <LocaleProvider locale="de">
      <MfaPanel mode="challenge" onComplete={done} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));
  await waitFor(() => expect(passkey).toHaveBeenCalledOnce());
  expect(done).toHaveBeenCalledOnce();
});

it("explains optional enrollment without claiming the workspace requires it", () => {
  render(
    <LocaleProvider locale="en">
      <MfaPanel mode="enroll" onComplete={vi.fn()} />
    </LocaleProvider>,
  );
  expect(
    screen.getByText(
      "Protect your account with an authenticator app or a passkey that verifies your identity on your device.",
    ),
  ).toBeInTheDocument();
});
