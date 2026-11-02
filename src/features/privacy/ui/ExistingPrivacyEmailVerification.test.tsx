// @vitest-environment jsdom
import "./__fixtures__/ExistingPrivacyEmailVerificationTestKit";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err, ok } from "@/types/result";
import {
  CASE,
  CLAIM_RECORDED,
  deferred,
  LATE,
  mocks,
  OWN_RECORDED,
  ownCase,
  PRIVATE_DRAFT,
  RECEIPT,
  receipt,
  refreshStub,
  resetEmailVerificationUi,
  security,
  USER,
  unverified,
  VERIFY_EMAIL,
} from "./__fixtures__/ExistingPrivacyEmailVerificationTestKit";
import { OwnPrivacyCaseStatus } from "./OwnPrivacyCaseStatus";
import { OwnPrivacyRequestForm } from "./OwnPrivacyRequestForm";
import { PersonalPrivacyWorkspace } from "./PersonalPrivacyWorkspace";
import { ReviewerIntakeCard } from "./ReviewerIntakeCard";

beforeEach(resetEmailVerificationUi);
afterEach(cleanup);
const local = (children: ReactNode) => (
  <LocaleProvider locale="en" timeZone="UTC">
    {children}
  </LocaleProvider>
);
async function press(name: string) {
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
    return Promise.resolve();
  });
}
async function settle<Value>(pending: ReturnType<typeof deferred<Value>>, value: Value) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
async function loadQueue() {
  await press("Load intake queue");
  expect(screen.getByText(CASE)).toBeInTheDocument();
}
function fillDraft() {
  const input = screen.getByLabelText("What would you like us to review?");
  fireEvent.change(input, { target: { value: PRIVATE_DRAFT } });
  return input;
}
function guidance() {
  expect(screen.queryAllByText(VERIFY_EMAIL).length).toBeGreaterThan(0);
}

test("reviewer email-only props loss clears loaded queue rows and the recorded claim receipt", async () => {
  const refreshSecurity = refreshStub();
  const element = (status = security) =>
    local(<ReviewerIntakeCard securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  await loadQueue();
  await press("Take this case");
  expect(screen.getByText(CLAIM_RECORDED)).toBeInTheDocument();
  view.rerender(element(unverified));
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(CLAIM_RECORDED)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Take this case" })).not.toBeInTheDocument();
  guidance();
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});

test("reviewer refresh-only unverified status cannot dispatch another queue read or claim", async () => {
  const refreshSecurity = refreshStub();
  render(local(<ReviewerIntakeCard securityStatus={security} refreshSecurity={refreshSecurity} />));
  await loadQueue();
  refreshSecurity.mockResolvedValueOnce(ok(unverified));
  await press("Refresh queue");
  expect(refreshSecurity).toHaveBeenCalledTimes(2);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  guidance();
});

test("email loss suppresses a late claim but retains its frozen command for explicit same-user retry", async () => {
  const refreshSecurity = refreshStub();
  const element = (status = security) =>
    local(<ReviewerIntakeCard securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  await loadQueue();
  const pending = deferred<Awaited<ReturnType<typeof mocks.claim>>>();
  mocks.claim.mockReturnValueOnce(pending.promise);
  await press("Take this case");
  const original = mocks.claim.mock.calls[0]?.[1];
  view.rerender(element(unverified));
  await settle(pending, ok({ id: LATE, version: 99, status: "received" }));
  expect(screen.queryByText(LATE)).not.toBeInTheDocument();
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(CLAIM_RECORDED)).not.toBeInTheDocument();
  view.rerender(element());
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  await press("Retry this assignment");
  expect(mocks.claim).toHaveBeenNthCalledWith(2, "csrf", original, USER);
  expect(mocks.claim.mock.calls[1]?.[1]).toBe(original);
  expect(Object.isFrozen(original)).toBe(true);
});

test("own-case refresh-only email loss clears details and a recorded confirmation without another read", async () => {
  const refreshSecurity = refreshStub();
  render(
    local(
      <OwnPrivacyCaseStatus
        caseId={CASE}
        securityStatus={security}
        refreshSecurity={refreshSecurity}
      />,
    ),
  );
  await screen.findByText(CASE, {}, { timeout: 1000 });
  await press("Confirm this request concerns my own account");
  expect(screen.getByText(OWN_RECORDED)).toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  refreshSecurity.mockResolvedValueOnce(ok(unverified));
  await press("Refresh request status");
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(OWN_RECORDED)).not.toBeInTheDocument();
  guidance();
});

test("own-case email-only props loss fences an already pending read", async () => {
  const pending = deferred<Awaited<ReturnType<typeof mocks.read>>>();
  mocks.read.mockReturnValueOnce(pending.promise);
  const refreshSecurity = refreshStub();
  const element = (status = security) =>
    local(
      <OwnPrivacyCaseStatus
        caseId={CASE}
        securityStatus={status}
        refreshSecurity={refreshSecurity}
      />,
    );
  const view = render(element());
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1), { timeout: 1000 });
  view.rerender(element(unverified));
  await settle(pending, ok(ownCase));
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: "Confirm this request concerns my own account" }),
  ).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.verify).not.toHaveBeenCalled();
  guidance();
});

test("a late own-account confirmation cannot restore its notice or dispatch a follow-up read after email loss", async () => {
  const pending = deferred<Awaited<ReturnType<typeof mocks.verify>>>();
  mocks.verify.mockReturnValueOnce(pending.promise);
  const refreshSecurity = refreshStub();
  const element = (status = security) =>
    local(
      <OwnPrivacyCaseStatus
        caseId={CASE}
        securityStatus={status}
        refreshSecurity={refreshSecurity}
      />,
    );
  const view = render(element());
  await screen.findByText(CASE, {}, { timeout: 1000 });
  await press("Confirm this request concerns my own account");
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  view.rerender(element(unverified));
  await settle(pending, ok({ ...ownCase, version: 4 }));
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.queryByText(OWN_RECORDED)).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

test("own-form email-only props loss hides its server receipt and status link while preserving request text", async () => {
  const refreshSecurity = refreshStub();
  const element = (status = security) =>
    local(<OwnPrivacyRequestForm securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  fillDraft();
  await press("Send request");
  expect(screen.getByText(RECEIPT)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View request status" })).toHaveAttribute(
    "href",
    `/settings/privacy/requests/${RECEIPT}`,
  );
  view.rerender(element(unverified));
  expect(screen.queryByText(RECEIPT)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View request status" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("What would you like us to review?")).toHaveValue(PRIVATE_DRAFT);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

test("own-form email loss suppresses late onReceived and keeps the exact frozen attempt for explicit recovery", async () => {
  const pending = deferred<Awaited<ReturnType<typeof mocks.create>>>();
  mocks.create.mockReturnValueOnce(pending.promise);
  const refreshSecurity = refreshStub();
  const onReceived = vi.fn();
  const element = (status = security) =>
    local(
      <OwnPrivacyRequestForm
        securityStatus={status}
        refreshSecurity={refreshSecurity}
        onReceived={onReceived}
      />,
    );
  const view = render(element());
  const input = fillDraft();
  await press("Send request");
  const original = mocks.create.mock.calls[0]?.[1];
  view.rerender(element(unverified));
  await settle(pending, ok(receipt));
  expect(onReceived).not.toHaveBeenCalled();
  expect(screen.queryByText(RECEIPT)).not.toBeInTheDocument();
  expect(screen.getByLabelText("What would you like us to review?")).toBe(input);
  expect(input).toHaveValue(PRIVATE_DRAFT);
  expect(input).toBeDisabled();
  view.rerender(element());
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await press("Retry this request");
  expect(mocks.create).toHaveBeenNthCalledWith(2, "csrf", original, USER);
  expect(onReceived).toHaveBeenCalledTimes(1);
});

test("unverified-but-fresh retry preserves the draft/intakeKey and the existing first-submit fresh:false flow", async () => {
  mocks.create.mockResolvedValueOnce(err("fresh_auth_required"));
  const refreshSecurity = refreshStub();
  const element = (status = { ...security, fresh: false }) =>
    local(<OwnPrivacyRequestForm securityStatus={status} refreshSecurity={refreshSecurity} />);
  const view = render(element());
  const input = fillDraft();
  await press("Send request");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  const original = mocks.create.mock.calls[0]?.[1];
  refreshSecurity.mockResolvedValueOnce(ok(unverified));
  await press("Retry this request");
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("What would you like us to review?")).toBe(input);
  expect(input).toHaveValue(PRIVATE_DRAFT);
  expect(input).toBeDisabled();
  guidance();
  view.rerender(element(security));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await press("Retry this request");
  expect(mocks.create).toHaveBeenNthCalledWith(2, "csrf", original, USER);
});

test("workspace focus propagates email loss and offers verification recovery without replacing or submitting its draft", async () => {
  render(local(<PersonalPrivacyWorkspace />));
  await screen.findByLabelText("What would you like us to review?", {}, { timeout: 1000 });
  const input = fillDraft();
  await loadQueue();
  mocks.loadSecurity.mockResolvedValue(ok(unverified));
  await act(() => {
    fireEvent(window, new Event("focus"));
    return Promise.resolve();
  });
  expect(mocks.loadSecurity).toHaveBeenCalledTimes(3);
  expect(screen.queryAllByText(CASE)).toHaveLength(0);
  expect(screen.getByLabelText("What would you like us to review?")).toBe(input);
  expect(input).toHaveValue(PRIVATE_DRAFT);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  guidance();
  for (const link of screen.getAllByRole("link", { name: "Account security in a new tab" })) {
    expect(link).toHaveAttribute("href", "/settings/security");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  mocks.loadSecurity.mockResolvedValue(ok(security));
  await act(() => {
    fireEvent(window, new Event("focus"));
    return Promise.resolve();
  });
  expect(screen.getByLabelText("What would you like us to review?")).toBe(input);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.create).not.toHaveBeenCalled();
});
