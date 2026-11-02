// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import assert from "node:assert/strict";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err, ok, type Result } from "@/types/result";
import { status } from "./OwnPrivacyRequestFormTestKit";
import { PersonalPrivacyWorkspace } from "./PersonalPrivacyWorkspace";

type ChildProps = {
  securityStatus: SecurityStatus;
  refreshSecurity(signal: AbortSignal): Promise<Result<SecurityStatus | null, "unavailable">>;
  securityUnavailable?: boolean;
};
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  reviewer: vi.fn<(props: ChildProps) => void>(),
  personal: vi.fn<(identity: symbol) => void>(),
}));
vi.mock("./loadOwnPrivacySecurity", () => ({ loadOwnPrivacySecurity: mocks.load }));
vi.mock("./OwnPrivacyRequestForm", () => ({
  OwnPrivacyRequestForm: () => {
    const identity = useRef(Symbol("personal draft"));
    mocks.personal(identity.current);
    return <div data-testid="personal-form" />;
  },
}));
vi.mock("./OwnPrivacyCaseStatus", () => ({
  OwnPrivacyCaseStatus: () => <div data-testid="personal-case" />,
}));
vi.mock("./ReviewerIntakeCard", () => ({
  ReviewerIntakeCard: (props: ChildProps) => {
    mocks.reviewer(props);
    return <div data-testid="reviewer-intake" />;
  },
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok({ ...status, fresh: true }));
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "mounts reviewer intake after the unchanged personal form at the root in %s",
  async (locale) => {
    render(
      <LocaleProvider locale={locale} timeZone="UTC">
        <PersonalPrivacyWorkspace />
      </LocaleProvider>,
    );
    const personal = await screen.findByTestId("personal-form");
    const reviewer = await screen.findByTestId("reviewer-intake", {}, { timeout: 1000 });
    expect(personal.compareDocumentPosition(reviewer) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(mocks.reviewer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        securityStatus: expect.objectContaining({ user: status.user }),
        refreshSecurity: expect.any(Function),
        securityUnavailable: false,
      }),
    );
  },
);

test("a requester case detail never mounts the workspace review queue", async () => {
  render(
    <LocaleProvider locale="en" timeZone="UTC">
      <PersonalPrivacyWorkspace caseId="00000000-0000-4000-8000-000000000041" />
    </LocaleProvider>,
  );
  await screen.findByTestId("personal-case");
  expect(mocks.reviewer).not.toHaveBeenCalled();
  expect(screen.queryByTestId("reviewer-intake")).not.toBeInTheDocument();
});

test("security rechecks update reviewer availability without replacing personal draft state", async () => {
  render(
    <LocaleProvider locale="en" timeZone="UTC">
      <PersonalPrivacyWorkspace />
    </LocaleProvider>,
  );
  await screen.findByTestId("personal-form");
  const draft = mocks.personal.mock.calls[0]?.[0];
  const reviewer = mocks.reviewer.mock.calls.at(-1)?.[0];
  assert(reviewer !== undefined);
  mocks.load.mockResolvedValueOnce(err("unavailable"));
  await act(async () => {
    await reviewer.refreshSecurity(new AbortController().signal);
  });
  await waitFor(() => expect(mocks.reviewer.mock.calls.at(-1)?.[0].securityUnavailable).toBe(true));
  expect(mocks.personal.mock.calls.every(([identity]) => identity === draft)).toBe(true);
  expect(screen.getByTestId("personal-form")).toBeInTheDocument();
});
