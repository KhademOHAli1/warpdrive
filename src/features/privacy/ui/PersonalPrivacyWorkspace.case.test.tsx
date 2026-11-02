// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ok } from "@/types/result";
import { status } from "./OwnPrivacyRequestFormTestKit";
import { PersonalPrivacyWorkspace } from "./PersonalPrivacyWorkspace";

const mocks = vi.hoisted(() => ({ load: vi.fn(), caseView: vi.fn() }));
vi.mock("./loadOwnPrivacySecurity", () => ({ loadOwnPrivacySecurity: mocks.load }));
vi.mock("./OwnPrivacyRequestForm", () => ({
  OwnPrivacyRequestForm: () => <div data-testid="new-request-form" />,
}));
vi.mock("./OwnPrivacyCaseStatus", () => ({
  OwnPrivacyCaseStatus: (props: { caseId: string }) => {
    mocks.caseView(props);
    return <div data-testid="own-case-view">{props.caseId}</div>;
  },
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok({ ...status, fresh: true }));
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "mounts only the selected own-case view after native security status in %s",
  async (locale) => {
    const caseId = "00000000-0000-4000-8000-000000000031";
    render(
      <LocaleProvider locale={locale} timeZone="UTC">
        <PersonalPrivacyWorkspace caseId={caseId} />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("own-case-view", {}, { timeout: 1000 })).toHaveTextContent(
      caseId,
    );
    expect(screen.queryByTestId("new-request-form")).not.toBeInTheDocument();
    expect(mocks.caseView).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId,
        securityStatus: expect.objectContaining({ user: status.user }),
        refreshSecurity: expect.any(Function),
      }),
    );
  },
);

test.each([
  ["en", "Sign in"],
  ["de", "Anmelden"],
  ["fa", "ورود به حساب"],
] as const)(
  "preserves only the opaque own-case path through sign-in in %s",
  async (locale, label) => {
    mocks.load.mockResolvedValueOnce(ok(null));
    const caseId = "00000000-0000-4000-8000-000000000031";
    render(
      <LocaleProvider locale={locale} timeZone="UTC">
        <PersonalPrivacyWorkspace caseId={caseId} />
      </LocaleProvider>,
    );
    const link = await screen.findByRole("link", { name: label }, { timeout: 1000 });
    expect(link).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(`/settings/privacy/requests/${caseId}`)}`,
    );
    expect(link.getAttribute("href")).not.toContain(status.user.email);
    expect(mocks.caseView).not.toHaveBeenCalled();
  },
);
