// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "../__fixtures__/ReviewerCaseReferenceEntryTestKit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  CASE,
  CHILD_PRIVATE,
  deferred,
  entryProps,
  installLateChild,
  LATE_PRIVATE,
  labels,
  mocks,
  OTHER,
  reset,
  security,
  wrap,
} from "../__fixtures__/ReviewerCaseReferenceEntryTestKit";
import { ReviewerCaseReferenceEntry } from "./ReviewerCaseReferenceEntry";

beforeEach(reset);
afterEach(cleanup);
function open() {
  fireEvent.change(screen.getByLabelText(labels.en.reference), { target: { value: CASE } });
  fireEvent.click(screen.getByRole("button", { name: labels.en.open }));
  expect(screen.getByTestId("exact-case-preview")).toBeInTheDocument();
}

test("email verification loss drops the selection before child values can commit", () => {
  const props = entryProps();
  const committed = vi.fn<(text: string) => void>();
  const view = render(wrap(<ReviewerCaseReferenceEntry {...props} />, "en", committed));
  open();
  committed.mockClear();
  view.rerender(
    wrap(
      <ReviewerCaseReferenceEntry
        {...props}
        securityStatus={{ ...security, emailVerified: false }}
      />,
      "en",
      committed,
    ),
  );
  expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
  expect(screen.queryByText(CHILD_PRIVATE)).not.toBeInTheDocument();
  expect(screen.getByLabelText(labels.en.reference)).toHaveValue("");
  expect(committed).toHaveBeenCalled();
  for (const [text] of committed.mock.calls) expect(text).not.toContain(CHILD_PRIVATE);
  expect(props.refreshSecurity).not.toHaveBeenCalled();
});

test("initially unverified email disables opening and explains verification", () => {
  const props = entryProps({ securityStatus: { ...security, emailVerified: false } });
  render(wrap(<ReviewerCaseReferenceEntry {...props} />));
  fireEvent.change(screen.getByLabelText(labels.en.reference), { target: { value: CASE } });
  const button = screen.getByRole("button", { name: labels.en.open });
  expect(button).toBeDisabled();
  expect(screen.getByText(labels.en.verifyEmail)).toBeInTheDocument();
  fireEvent.click(button);
  expect(mocks.child).not.toHaveBeenCalled();
  expect(props.refreshSecurity).not.toHaveBeenCalled();
});

for (const boundary of ["account", "unavailable", "freshness", "MFA", "enrollment"] as const)
  test(`${boundary} change drops the old selection before committed child values can survive`, () => {
    const props = entryProps();
    const committed = vi.fn<(text: string) => void>();
    const view = render(wrap(<ReviewerCaseReferenceEntry {...props} />, "en", committed));
    open();
    committed.mockClear();
    const next =
      boundary === "account"
        ? { ...props, securityStatus: { ...security, user: { ...security.user, id: OTHER } } }
        : boundary === "unavailable"
          ? { ...props, securityUnavailable: true }
          : boundary === "freshness"
            ? { ...props, securityStatus: { ...security, fresh: false } }
            : boundary === "MFA"
              ? { ...props, securityStatus: { ...security, needsMfa: true } }
              : { ...props, securityStatus: { ...security, needsEnrollment: true } };
    view.rerender(wrap(<ReviewerCaseReferenceEntry {...next} />, "en", committed));
    expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
    expect(screen.queryByText(CHILD_PRIVATE)).not.toBeInTheDocument();
    expect(committed).toHaveBeenCalled();
    for (const [text] of committed.mock.calls) expect(text).not.toContain(CHILD_PRIVATE);
    expect(props.refreshSecurity).not.toHaveBeenCalled();
  });

test("security unavailability disables opening even a valid reference", () => {
  const props = entryProps({ securityUnavailable: true });
  render(wrap(<ReviewerCaseReferenceEntry {...props} />));
  fireEvent.change(screen.getByLabelText(labels.en.reference), { target: { value: CASE } });
  const button = screen.getByRole("button", { name: labels.en.open });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(mocks.child).not.toHaveBeenCalled();
  expect(props.refreshSecurity).not.toHaveBeenCalled();
});

test("same-account recovery does not reopen a discarded source selection automatically", () => {
  const props = entryProps();
  const view = render(wrap(<ReviewerCaseReferenceEntry {...props} />));
  open();
  view.rerender(wrap(<ReviewerCaseReferenceEntry {...props} securityUnavailable />));
  expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
  view.rerender(wrap(<ReviewerCaseReferenceEntry {...props} />));
  expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
  open();
  expect(mocks.child.mock.calls.at(-1)?.[0]?.caseId).toBe(CASE);
  expect(props.refreshSecurity).not.toHaveBeenCalled();
});

for (const boundary of ["account", "unavailable"] as const)
  test(`late mocked child values cannot reopen the selection after ${boundary} change`, async () => {
    const ready = deferred();
    installLateChild(ready.promise);
    const props = entryProps();
    const view = render(wrap(<ReviewerCaseReferenceEntry {...props} />));
    open();
    const next =
      boundary === "account"
        ? { ...props, securityStatus: { ...security, user: { ...security.user, id: OTHER } } }
        : { ...props, securityUnavailable: true };
    view.rerender(wrap(<ReviewerCaseReferenceEntry {...next} />));
    expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
    await act(async () => {
      ready.resolve();
      await ready.promise;
    });
    expect(screen.queryByText(LATE_PRIVATE)).not.toBeInTheDocument();
    expect(screen.queryByTestId("exact-case-preview")).not.toBeInTheDocument();
    expect(props.refreshSecurity).not.toHaveBeenCalled();
  });
