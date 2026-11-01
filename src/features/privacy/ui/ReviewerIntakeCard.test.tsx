// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { err, ok } from "@/types/result";
import {
  CASE_ID,
  labels,
  load,
  mocks,
  PRIVATE,
  queue,
  REVIEWER_ID,
  reset,
  show,
} from "./ReviewerIntakeTestKit";

beforeEach(reset);
afterEach(cleanup);

test.each(["fa", "de", "en"] as const)(
  "reviewer intake uses localized %s controls and direction without prefetch",
  (locale) => {
    show(locale);
    const title = screen.getByRole("heading", { name: labels[locale].title });
    expect(title.closest("[dir]")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    expect(screen.getByRole("button", { name: labels[locale].load })).toBeEnabled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  },
);

test("explicit loading rechecks sign-in and shows only a minimal opaque live queue", async () => {
  const subject = show();
  await load();
  expect(subject.refreshSecurity).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith("csrf", { limit: 25 }, REVIEWER_ID);
  expect(screen.getByText(CASE_ID)).toHaveAttribute("dir", "ltr");
  expect(
    screen.getByText(
      "This queue changes as reviewers act. Taking a case rechecks its availability.",
    ),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(PRIVATE);
  expect(screen.queryByRole("link", { name: /View request status/ })).not.toBeInTheDocument();
});

test("claim sends the current version with one command and displays only a historical receipt", async () => {
  show();
  await load();
  fireEvent.click(screen.getByRole("button", { name: labels.en.claim }));
  await screen.findByText(
    "Assignment receipt recorded. Refresh the queue to check current availability.",
    {},
    { timeout: 1000 },
  );
  expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(
    "csrf",
    {
      caseId: CASE_ID,
      expectedVersion: 7,
      commandId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
    },
    REVIEWER_ID,
  );
  expect(screen.queryByText(/You are now|Case completed|Data erased/)).not.toBeInTheDocument();
});

test("a lost acknowledgement retries the frozen assignment despite a later queue version", async () => {
  show();
  await load();
  mocks.claim.mockResolvedValueOnce(err("storage_unavailable"));
  fireEvent.click(screen.getByRole("button", { name: labels.en.claim }));
  await screen.findByText(
    "It is unclear whether this assignment was recorded. Retry the same assignment.",
    {},
    { timeout: 1000 },
  );
  const original: unknown = mocks.claim.mock.calls[0]?.[1];
  expect(Object.isFrozen(original)).toBe(true);
  mocks.list.mockResolvedValueOnce(ok(queue(12)));
  fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2), { timeout: 1000 });
  await waitFor(
    () => expect(screen.getByRole("button", { name: "Retry this assignment" })).toBeEnabled(),
    { timeout: 1000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry this assignment" }));
  await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2), { timeout: 1000 });
  expect(mocks.claim.mock.calls[1]).toEqual(["csrf", original, REVIEWER_ID]);
  expect(original).toMatchObject({ caseId: CASE_ID, expectedVersion: 7 });
});
