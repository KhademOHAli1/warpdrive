// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "../__fixtures__/ReviewerCaseCardTestKit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import {
  cardProps,
  deferred,
  labels,
  mocks,
  NEXT_CASE,
  ORIGINAL_EMAIL,
  OTHER,
  reset,
  row,
  SUMMARY,
  security,
  wrap,
} from "../__fixtures__/ReviewerCaseCardTestKit";
import { ReviewerCaseCard } from "./ReviewerCaseCard";

beforeEach(reset);
afterEach(cleanup);
async function load() {
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(SUMMARY, {}, { timeout: 1000 });
}
const caseBoundaries = [
  "case",
  "account",
  "freshness",
  "MFA",
  "enrollment",
  "unavailable",
] as const;
function propsForCaseBoundary(
  boundary: (typeof caseBoundaries)[number],
  props: ReturnType<typeof cardProps>,
): ReturnType<typeof cardProps> {
  switch (boundary) {
    case "case":
      return { ...props, caseId: NEXT_CASE };
    case "account":
      return { ...props, securityStatus: { ...security, user: { ...security.user, id: OTHER } } };
    case "freshness":
      return { ...props, securityStatus: { ...security, fresh: false } };
    case "MFA":
      return { ...props, securityStatus: { ...security, needsMfa: true } };
    case "enrollment":
      return { ...props, securityStatus: { ...security, needsEnrollment: true } };
    case "unavailable":
      return { ...props, securityUnavailable: true };
  }
}

test("email verification loss cannot commit cached original request values", async () => {
  const props = cardProps();
  const committed = vi.fn<(text: string) => void>();
  const view = render(wrap(<ReviewerCaseCard {...props} />, "en", committed));
  await load();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  committed.mockClear();
  view.rerender(
    wrap(
      <ReviewerCaseCard {...props} securityStatus={{ ...security, emailVerified: false }} />,
      "en",
      committed,
    ),
  );
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
  expect(committed).toHaveBeenCalled();
  for (const [text] of committed.mock.calls) {
    expect(text).not.toContain(SUMMARY);
    expect(text).not.toContain(ORIGINAL_EMAIL);
  }
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

test("fresh native security with unverified email denies case action with verification guidance", async () => {
  const props = cardProps();
  vi.mocked(props.refreshSecurity).mockResolvedValueOnce(ok({ ...security, emailVerified: false }));
  render(wrap(<ReviewerCaseCard {...props} />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await Promise.resolve();
  });
  expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
  expect(screen.getByText(labels.en.verifyEmail)).toBeInTheDocument();
});

for (const boundary of caseBoundaries)
  test(`${boundary} change cannot commit cached original request values`, async () => {
    const props = cardProps();
    const committed = vi.fn<(text: string) => void>();
    const view = render(wrap(<ReviewerCaseCard {...props} />, "en", committed));
    await load();
    committed.mockClear();
    const next = propsForCaseBoundary(boundary, props);
    view.rerender(wrap(<ReviewerCaseCard {...next} />, "en", committed));
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
    expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
    expect(committed).toHaveBeenCalled();
    for (const [text] of committed.mock.calls) expect(text).not.toContain(SUMMARY);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

for (const boundary of ["signed out", "stale", "MFA", "enrollment", "unavailable"] as const)
  test(`current ${boundary} native security denies before case action`, async () => {
    const props = cardProps();
    vi.mocked(props.refreshSecurity).mockResolvedValueOnce(
      boundary === "unavailable"
        ? err("unavailable")
        : ok(
            boundary === "signed out"
              ? null
              : {
                  ...security,
                  fresh: boundary !== "stale",
                  needsMfa: boundary === "MFA",
                  needsEnrollment: boundary === "enrollment",
                },
          ),
    );
    render(wrap(<ReviewerCaseCard {...props} />));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
      await Promise.resolve();
    });
    expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
    if (["stale", "MFA", "enrollment"].includes(boundary))
      expect(screen.getByText(labels.en.fresh)).toBeInTheDocument();
  });

for (const failure of [
  "forbidden",
  "evidence_unavailable",
  "reviewer_changed",
  "fresh_auth_required",
  "request_failed",
] as const)
  test(`${failure} on refresh discards every cached case detail`, async () => {
    render(wrap(<ReviewerCaseCard {...cardProps()} />));
    await load();
    mocks.read.mockResolvedValueOnce(err(failure));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: labels.en.refresh }));
      await Promise.resolve();
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
    expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

for (const boundary of ["case", "account"] as const)
  test(`late case response after ${boundary} change cannot restore original request values`, async () => {
    const props = cardProps();
    const pending = deferred<unknown>();
    mocks.read.mockReturnValueOnce(pending.promise);
    const view = render(wrap(<ReviewerCaseCard {...props} />));
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1), { timeout: 1000 });
    const next =
      boundary === "case"
        ? { ...props, caseId: NEXT_CASE }
        : { ...props, securityStatus: { ...security, user: { ...security.user, id: OTHER } } };
    view.rerender(wrap(<ReviewerCaseCard {...next} />));
    await act(() => {
      pending.resolve(ok(row()));
      return Promise.resolve();
    });
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
    expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

test("unmount cancels the owned native-security observation and suppresses its late action", async () => {
  const props = cardProps();
  const pending = deferred<Awaited<ReturnType<typeof props.refreshSecurity>>>();
  let owned: AbortSignal | undefined;
  vi.mocked(props.refreshSecurity).mockImplementationOnce((signal) => {
    owned = signal;
    return pending.promise;
  });
  const view = render(wrap(<ReviewerCaseCard {...props} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(owned?.aborted).toBe(true);
  await act(() => {
    pending.resolve(ok(security));
    return Promise.resolve();
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
});
