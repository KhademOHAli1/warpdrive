// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  clientLabels,
  clientName,
  clientReview,
  historyContextKey,
  historyView,
  occurredAt,
  recordedAt,
  secondClientId,
  secondClientName,
  staffName,
  transition,
  userLabels,
} from "./ReviewDecisionHistory.test-support";
import { changeVersion, newerVersion, version } from "./reviewDecisions.test-support";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
afterEach(cleanup);

function expectPrivateHistoryHidden() {
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  for (const privateText of [
    staffName,
    clientName,
    version,
    "client-note/2026-11-01",
    "Recording employee unavailable",
    "Client contact unavailable",
  ]) {
    expect(document.body).not.toHaveTextContent(privateText);
  }
  expect(screen.getByRole("alert")).toHaveTextContent("Review history is unavailable.");
  expect(screen.getByRole("alert")).toHaveClass("ph-block-email", "ph-no-capture");
}

it("does not render private rows or identity fallbacks without current read permission", () => {
  render(historyView(clientReview(), undefined, undefined, { canRead: false }));
  expectPrivateHistoryHidden();
});

it("removes already visible history on read loss and does not retain it while a new read is absent", () => {
  const review = clientReview();
  const view = render(historyView(review));
  expect(screen.getByText(clientName)).toBeInTheDocument();
  view.rerender(historyView(review, undefined, undefined, { canRead: false }));
  expectPrivateHistoryHidden();
  view.rerender(historyView(review, undefined, undefined, { data: null }));
  expectPrivateHistoryHidden();
  view.unmount();
  expect(document.body).not.toHaveTextContent(clientName);
});

it("hides an old authorized read after the current session or workspace context changes", () => {
  const review = clientReview();
  const view = render(historyView(review));
  view.rerender(
    historyView(review, undefined, undefined, {
      contextKey: `${historyContextKey}:replacement`,
    }),
  );
  expectPrivateHistoryHidden();
});

it.each(["projectId", "deliverableId"] as const)(
  "hides old private history when the selected %s differs from the read target",
  (field) => {
    const review = clientReview();
    const view = render(historyView(review));
    view.rerender(
      historyView(review, undefined, undefined, {
        target: {
          projectId: review.projectId,
          deliverableId: review.deliverableId,
          [field]: "11111111-1111-4111-8111-111111111111",
        },
      }),
    );
    expectPrivateHistoryHidden();
  },
);

it.each(["", "   "])("requires a nonblank current context (%j)", (contextKey) => {
  const review = clientReview();
  render(
    historyView(review, undefined, undefined, {
      contextKey,
      data: { contextKey, review, userLabels, clientLabels },
    }),
  );
  expectPrivateHistoryHidden();
});

it("hides private history when there is no selected review target", () => {
  render(historyView(clientReview(), undefined, undefined, { target: null }));
  expectPrivateHistoryHidden();
});

it("keeps historical and current approvals tied to each row's own recorder and timestamps", () => {
  const first = clientReview();
  const changed = transition(first, changeVersion(first.revision));
  const secondStaffId = "01234567-89ab-4cde-8f01-234567890abc";
  const secondStaffName = "Nima Müller";
  const secondOccurredAt = "2026-11-01T07:30:00Z";
  const secondRecordedAt = "2026-11-01T08:00:00Z";
  const current = clientReview(changed, {
    clientContactId: secondClientId,
    recordedByUserId: secondStaffId,
    occurredAt: secondOccurredAt,
    recordedAt: secondRecordedAt,
    method: "phone",
    evidenceReference: "client-note/second-version",
  });
  render(
    historyView(current, undefined, {
      userLabels: { ...userLabels, [secondStaffId]: secondStaffName },
      clientLabels,
    }),
  );

  const region = screen.getByRole("region", { name: "Review decision history" });
  expect(region.querySelectorAll("li")).toHaveLength(2);
  const historical = screen.getByText(clientName).closest("li");
  const fresh = screen.getByText(secondClientName).closest("li");
  expect(historical).not.toBe(fresh);
  expect(historical).toHaveTextContent("Historical review");
  expect(historical).not.toHaveTextContent("Current review");
  expect(historical).toHaveTextContent(`Client approval recorded by ${staffName}`);
  expect(historical).not.toHaveTextContent(secondStaffName);
  expect(historical).toHaveTextContent("Email");
  expect(historical).toHaveTextContent(version);
  expect(historical).not.toHaveTextContent(newerVersion);
  expect(fresh).toHaveTextContent("Current review");
  expect(fresh).not.toHaveTextContent("Historical review");
  expect(fresh).toHaveTextContent(`Client approval recorded by ${secondStaffName}`);
  expect(fresh).not.toHaveTextContent(staffName);
  expect(fresh).toHaveTextContent("Phone");
  expect(fresh).toHaveTextContent(newerVersion);
  expect(fresh).toHaveTextContent("client-note/second-version");
  expect(
    Array.from(historical?.querySelectorAll("time") ?? []).map((time) => time.dateTime),
  ).toEqual([occurredAt, recordedAt]);
  expect(Array.from(fresh?.querySelectorAll("time") ?? []).map((time) => time.dateTime)).toEqual([
    secondOccurredAt,
    secondRecordedAt,
  ]);
});
