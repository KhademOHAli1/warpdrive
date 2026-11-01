// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxFreshAuthDialog } from "./MailboxFreshAuthDialog";

vi.mock("@/features/auth/better/client", () => ({
  authClient: { twoFactor: { verifyTotp: vi.fn() }, signIn: { passkey: vi.fn(), social: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
for (const locale of ["fa", "de"] as const) {
  it(`recovers a failed native status request without losing the surrounding workflow in ${locale}`, async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        await Promise.resolve();
        if (path.endsWith("providers"))
          return Response.json({
            ok: true,
            data: { providers: [], emailPassword: true, passkeys: true },
          });
        attempts++;
        if (attempts === 1) throw new Error("private status diagnostic");
        return Response.json({
          ok: true,
          data: {
            authenticated: true,
            user: { id: "user", name: "Operator", email: "operator@example.com", isAdmin: false },
            emailVerified: true,
            hasPassword: true,
            twoFactorEnabled: false,
            needsMfa: false,
            needsEnrollment: false,
            fresh: false,
            authMethod: "password",
            policy: {
              requireMfaForAll: false,
              idleMinutes: 30,
              absoluteHours: 168,
              freshMinutes: 5,
            },
            accounts: [],
            passkeys: [],
            sessions: [],
            recoveryCodesAvailable: false,
            audit: [],
          },
        });
      }),
    );
    const L = authScreensMessagesForLocale(locale).flow;
    render(
      <LocaleProvider locale={locale}>
        <MailboxFreshAuthDialog onClose={vi.fn()} onConfirmed={vi.fn()} />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(L.networkError);
    expect(screen.queryByText("private status diagnostic")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.retry }));
    expect(await screen.findByLabelText(L.currentPassword)).toBeVisible();
    expect(attempts).toBe(2);
  });
}
