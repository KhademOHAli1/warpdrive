// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  clientName,
  clientReview,
  clientLabels,
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
  render(historyView(current, undefined, {
    userLabels: { ...userLabels, [secondStaffId]: secondStaffName },
    clientLabels,
  }));

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
  expect(Array.from(historical?.querySelectorAll("time") ?? []).map((time) => time.dateTime))
    .toEqual([occurredAt, recordedAt]);
  expect(Array.from(fresh?.querySelectorAll("time") ?? []).map((time) => time.dateTime))
    .toEqual([secondOccurredAt, secondRecordedAt]);
});
