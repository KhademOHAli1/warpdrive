// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import assert from "node:assert/strict";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err, ok, type Result } from "@/types/result";
import { status } from "./OwnPrivacyRequestFormTestKit";
import { PersonalPrivacyWorkspace } from "./PersonalPrivacyWorkspace";

type ChildProps = {
  securityStatus: SecurityStatus;
  refreshSecurity: (signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>;
  securityUnavailable?: boolean;
};
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  entry: vi.fn<(props: ChildProps) => void>(),
  intake: vi.fn<(props: ChildProps) => void>(),
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
    mocks.intake(props);
    return <div data-testid="reviewer-intake" />;
  },
}));
vi.mock("./ReviewerCaseReferenceEntry", () => ({
  ReviewerCaseReferenceEntry: (props: ChildProps) => {
    mocks.entry(props);
    return <div data-testid="reviewer-source-entry" />;
  },
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok({ ...status, fresh: true }));
});
afterEach(cleanup);

test.each(["en", "de", "fa"] as const)(
  "%s root places an exact-case source entry after intake and the preserved personal form",
  async (locale) => {
    render(
      <LocaleProvider locale={locale} timeZone="UTC">
        <PersonalPrivacyWorkspace />
      </LocaleProvider>,
    );
    const personal = await screen.findByTestId("personal-form");
    const intake = screen.getByTestId("reviewer-intake");
    const entry = screen.queryByTestId("reviewer-source-entry");
    expect(entry).toBeInTheDocument();
    assert(entry !== null);
    expect(personal.compareDocumentPosition(intake) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(intake.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(mocks.entry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        securityStatus: expect.objectContaining({ user: status.user }),
        refreshSecurity: expect.any(Function),
        securityUnavailable: false,
      }),
    );
  },
);

test("a requester-only case detail has no reviewer source entry", async () => {
  render(
    <LocaleProvider locale="en" timeZone="UTC">
      <PersonalPrivacyWorkspace caseId="00000000-0000-4000-8000-000000000041" />
    </LocaleProvider>,
  );
  await screen.findByTestId("personal-case");
  expect(mocks.entry).not.toHaveBeenCalled();
  expect(screen.queryByTestId("reviewer-source-entry")).not.toBeInTheDocument();
});

test("native security unavailability reaches the source entry while personal draft identity survives", async () => {
  render(
    <LocaleProvider locale="en" timeZone="UTC">
      <PersonalPrivacyWorkspace />
    </LocaleProvider>,
  );
  await screen.findByTestId("personal-form");
  expect(mocks.entry).toHaveBeenCalled();
  const entry = mocks.entry.mock.calls.at(-1)?.[0];
  assert(entry !== undefined);
  const draft = mocks.personal.mock.calls[0]?.[0];
  mocks.load.mockResolvedValueOnce(err("unavailable"));
  await act(async () => {
    await entry.refreshSecurity(new AbortController().signal);
  });
  expect(mocks.entry.mock.calls.at(-1)?.[0].securityUnavailable).toBe(true);
  expect(mocks.personal.mock.calls.every(([identity]) => identity === draft)).toBe(true);
});
