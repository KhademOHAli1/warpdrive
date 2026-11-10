// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "./NativeSubjectReviewCardTestKit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@/types/result";
import { NativeSubjectReviewCard } from "./NativeSubjectReviewCard";
import {
  CASE,
  cardProps,
  deferred,
  EMAIL,
  labels,
  mocks,
  NAME,
  NEXT_CASE,
  OTHER,
  reset,
  security,
  source,
  wrap,
} from "./NativeSubjectReviewCardTestKit";

beforeEach(reset);
afterEach(cleanup);
async function load() {
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(NAME, {}, { timeout: 1000 });
}
const sourceBoundaries = [
  "case",
  "account",
  "freshness",
  "MFA",
  "enrollment",
  "security unavailable",
] as const;
function propsForSourceBoundary(
  boundary: (typeof sourceBoundaries)[number],
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
    case "security unavailable":
      return { ...props, securityUnavailable: true };
  }
}

test("email verification loss cannot commit cached source values", async () => {
  const props = cardProps();
  const committed = vi.fn<(text: string) => void>();
  const view = render(wrap(<NativeSubjectReviewCard {...props} />, "en", committed));
  await load();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  committed.mockClear();
  view.rerender(
    wrap(
      <NativeSubjectReviewCard {...props} securityStatus={{ ...security, emailVerified: false }} />,
      "en",
      committed,
    ),
  );
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
  expect(committed).toHaveBeenCalled();
  for (const [text] of committed.mock.calls) {
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(EMAIL);
  }
  expect(mocks.load).toHaveBeenCalledTimes(1);
});

test("fresh native security with unverified email denies source action with verification guidance", async () => {
  const props = cardProps();
  vi.mocked(props.refreshSecurity).mockResolvedValueOnce(ok({ ...security, emailVerified: false }));
  render(wrap(<NativeSubjectReviewCard {...props} />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await Promise.resolve();
  });
  expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
  expect(screen.getByText(labels.en.verifyEmail)).toBeInTheDocument();
});

for (const boundary of sourceBoundaries)
  test(`${boundary} change cannot commit stale source data while effects catch up`, async () => {
    const props = cardProps();
    const committed = vi.fn<(text: string) => void>();
    const view = render(wrap(<NativeSubjectReviewCard {...props} />, "en", committed));
    await load();
    committed.mockClear();
    const next = propsForSourceBoundary(boundary, props);
    view.rerender(wrap(<NativeSubjectReviewCard {...next} />, "en", committed));
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
    expect(committed).toHaveBeenCalled();
    for (const [text] of committed.mock.calls) expect(text).not.toContain(NAME);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

for (const boundary of ["signed out", "stale", "MFA", "enrollment", "unavailable"] as const)
  test(`explicit load denies current ${boundary} security before the action`, async () => {
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
    render(wrap(<NativeSubjectReviewCard {...props} />));
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await waitFor(() => expect(props.refreshSecurity).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    if (boundary === "stale" || boundary === "MFA" || boundary === "enrollment") {
      expect(screen.getByText(labels.en.fresh)).toBeInTheDocument();
    }
  });

for (const failure of [
  "forbidden",
  "reviewer_changed",
  "policy_unconfigured",
  "policy_stale",
  "policy_disabled",
  "source_invalid",
  "request_failed",
] as const)
  test(`${failure} on refresh clears all displayed source values`, async () => {
    render(wrap(<NativeSubjectReviewCard {...cardProps()} />));
    await load();
    mocks.load.mockResolvedValueOnce(err(failure));
    fireEvent.click(screen.getByRole("button", { name: labels.en.refresh }));
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
  });

for (const boundary of ["case", "account"] as const)
  test(`a late action response after ${boundary} change cannot restore source values`, async () => {
    const props = cardProps();
    const pending = deferred<unknown>();
    mocks.load.mockReturnValueOnce(pending.promise);
    const view = render(wrap(<NativeSubjectReviewCard {...props} />));
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1), { timeout: 1000 });
    const next =
      boundary === "case"
        ? { ...props, caseId: NEXT_CASE }
        : { ...props, securityStatus: { ...security, user: { ...security.user, id: OTHER } } };
    view.rerender(wrap(<NativeSubjectReviewCard {...next} />));
    await act(() => {
      pending.resolve(ok(source()));
      return Promise.resolve();
    });
    expect(screen.queryByText(NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(EMAIL)).not.toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

test("unmount aborts the owned security check and ignores its late result", async () => {
  const props = cardProps();
  const pending = deferred<Awaited<ReturnType<typeof props.refreshSecurity>>>();
  let owned: AbortSignal | undefined;
  vi.mocked(props.refreshSecurity).mockImplementationOnce((signal) => {
    owned = signal;
    return pending.promise;
  });
  const view = render(wrap(<NativeSubjectReviewCard {...props} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  expect(props.refreshSecurity).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(owned?.aborted).toBe(true);
  await act(() => {
    pending.resolve(ok(security));
    return Promise.resolve();
  });
  expect(mocks.load).not.toHaveBeenCalled();
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
});

test("an interrupted shared security refresh clears values and requires an explicit recheck", async () => {
  const props = cardProps();
  render(wrap(<NativeSubjectReviewCard {...props} />));
  await load();
  vi.mocked(props.refreshSecurity).mockRejectedValueOnce(
    new DOMException("Synthetic shared refresh interruption", "AbortError"),
  );
  fireEvent.click(screen.getByRole("button", { name: labels.en.refresh }));
  await screen.findByText(labels.en.unavailable, {}, { timeout: 1000 });
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(NAME, {}, { timeout: 1000 });
  expect(props.refreshSecurity).toHaveBeenCalledTimes(3);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

test("same-reviewer security recovery never automatically reloads cleared values", async () => {
  const props = cardProps();
  const view = render(wrap(<NativeSubjectReviewCard {...props} />));
  await load();
  view.rerender(wrap(<NativeSubjectReviewCard {...props} securityUnavailable />));
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  view.rerender(wrap(<NativeSubjectReviewCard {...props} />));
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(NAME)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(NAME, {}, { timeout: 1000 });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load.mock.calls.map((call) => call.slice(1))).toEqual([
    [{ caseId: CASE }, security.user.id],
    [{ caseId: CASE }, security.user.id],
  ]);
});
