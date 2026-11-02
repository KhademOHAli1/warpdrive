// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime } from "@/lib/localeFormatting";
import {
  clientName,
  clientReview,
  historyView,
  internalReviewHistory,
  languageCases,
  occurredAt,
  recordedAt,
  renderHistory,
  secondClientId,
  secondClientName,
  staffName,
  transition,
} from "./ReviewDecisionHistory.test-support";
import {
  changeVersion,
  clientContactId,
  nativeRecorder,
  newerVersion,
  reopenReview,
  snapshot,
  version,
} from "./reviewDecisions.test-support";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function historyRegion() {
  return screen.getByRole("region", { name: "Review decision history" });
}

function decisionTimes(row: HTMLElement) {
  return Array.from(row.querySelectorAll("time"));
}

it("shows staff-recorded client provenance, resolved identities and distinct source timestamps", () => {
  const review = clientReview();
  const before = structuredClone(review);
  renderHistory(review);
  const row = within(historyRegion()).getByRole("listitem");
  expect(row).toHaveTextContent(`Client approval recorded by ${staffName}`);
  expect(row).toHaveTextContent(clientName);
  expect(row).toHaveTextContent("Email");
  expect(row).toHaveTextContent("Current review");
  expect(row).toHaveTextContent("Approval reported at");
  expect(row).toHaveTextContent("Recorded at");
  expect(row).toHaveTextContent("client-note/2026-11-01");
  const times = decisionTimes(row);
  expect(times.map((time) => time.dateTime)).toEqual([occurredAt, recordedAt]);
  expect(times[0]?.textContent).not.toBe(times[1]?.textContent);
  expect(screen.queryByText("Authenticated client approval")).not.toBeInTheDocument();
  expect(screen.queryByText("Client signed")).not.toBeInTheDocument();
  expect(review).toEqual(before);
});

it("labels an internal review separately without inventing a client approval", () => {
  renderHistory(internalReviewHistory());
  const row = within(historyRegion()).getByRole("listitem");
  expect(row).toHaveTextContent("Internal approval");
  expect(row).toHaveTextContent(staffName);
  expect(row).toHaveTextContent(version);
  expect(row).toHaveTextContent("Internal review");
  expect(row).not.toHaveTextContent("Client approval recorded by");
  expect(row).not.toHaveTextContent(clientName);
});

it.each([
  ["phone", "Phone"],
  ["meeting", "Meeting"],
  ["message", "Message"],
] as const)("retains the recorded %s method without claiming delivery", (method, label) => {
  renderHistory(clientReview(snapshot(), { method }));
  const row = within(historyRegion()).getByRole("listitem");
  expect(row).toHaveTextContent(label);
  expect(row).toHaveTextContent(`Client approval recorded by ${staffName}`);
  expect(row).not.toHaveTextContent("Delivered");
});

it("retains the old version approval as history when the version changes", () => {
  const first = clientReview();
  const view = renderHistory(first);
  const next = transition(first, changeVersion(first.revision));
  view.rerender(historyView(next));
  const region = historyRegion();
  expect(within(region).getByText("This version needs a new review.")).toBeInTheDocument();
  expect(region).toHaveTextContent(newerVersion);
  const row = within(region).getByRole("listitem");
  expect(row).toHaveTextContent(version);
  expect(row).toHaveTextContent("Historical review");
  expect(within(row).queryByText("Current review")).not.toBeInTheDocument();
  expect(row).toHaveTextContent(`Client approval recorded by ${staffName}`);
});

it("makes the earlier epoch historical even when the same version is reopened", () => {
  const first = clientReview();
  const reopened = transition(first, reopenReview(first.revision));
  renderHistory(reopened);
  const region = historyRegion();
  expect(within(region).getByText("This version needs a new review.")).toBeInTheDocument();
  const row = within(region).getByRole("listitem");
  expect(row).toHaveTextContent(version);
  expect(row).toHaveTextContent("Historical review");
  expect(within(row).queryByText("Current review")).not.toBeInTheDocument();
});

it("keeps multiple client records separate without declaring universal approval", () => {
  const first = clientReview();
  renderHistory(clientReview(first, { clientContactId: secondClientId }));
  const region = historyRegion();
  const rows = within(region).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  const firstRow = within(region).getByText(clientName).closest("li");
  const secondRow = within(region).getByText(secondClientName).closest("li");
  expect(firstRow).not.toBe(secondRow);
  expect(firstRow).not.toHaveTextContent(secondClientName);
  expect(secondRow).not.toHaveTextContent(clientName);
  expect(within(region).getAllByText("Current review")).toHaveLength(2);
  expect(within(region).queryByText("All clients approved")).not.toBeInTheDocument();
});

it("shows an explicit empty state without a fabricated approval", () => {
  renderHistory(snapshot());
  const region = historyRegion();
  expect(within(region).getByText("No decisions recorded yet.")).toBeInTheDocument();
  expect(within(region).queryByRole("listitem")).not.toBeInTheDocument();
  expect(within(region).getByText("This version needs a new review.")).toBeInTheDocument();
  expect(region.querySelector("time")).toBeNull();
});

it("renders authored version and evidence as isolated plain text without an active remote surface", () => {
  const authoredVersion = '<img src="https://example.invalid/private.png"> نسخه / V2';
  const authoredEvidence = "<script>alert('private')</script> https://example.invalid/evidence";
  const remote = vi.fn();
  vi.stubGlobal("fetch", remote);
  const review = clientReview(
    { ...snapshot(), currentVersionReference: authoredVersion },
    { evidenceReference: authoredEvidence },
  );
  renderHistory(review);
  const region = historyRegion();
  for (const text of [authoredVersion, authoredEvidence]) {
    for (const element of within(region).getAllByText(text)) {
      expect(element.closest("bdi")).not.toBeNull();
    }
  }
  expect(region.querySelector("a, img, iframe, script")).toBeNull();
  expect(remote).not.toHaveBeenCalled();
});

it("blocks the full sensitive history boundary from replay and autocapture", () => {
  renderHistory(clientReview());
  const region = historyRegion();
  expect(region).toHaveClass(BLOCK_CLASS, "ph-no-capture");
  expect(within(region).getByText(clientName)).toBeInTheDocument();
  expect(within(region).getByText("client-note/2026-11-01")).toBeInTheDocument();
});

it("retains an explicit unresolved identity without exposing raw identity IDs", () => {
  render(historyView(clientReview(), undefined, { userLabels: {}, clientLabels: {} }));
  const row = within(historyRegion()).getByRole("listitem");
  expect(row).toHaveTextContent("Recording employee unavailable");
  expect(row).toHaveTextContent("Client contact unavailable");
  expect(row).not.toHaveTextContent(nativeRecorder.recordedByUserId);
  expect(row).not.toHaveTextContent(clientContactId);
});

it.each(languageCases)(
  "$locale preserves provenance and independently selected calendar, digits and zone",
  (profile) => {
    renderHistory(clientReview(), profile);
    const region = screen.getByRole("region", { name: profile.title });
    const row = within(region).getByRole("listitem");
    expect(row).toHaveTextContent(profile.provenance);
    expect(row).toHaveTextContent(profile.method);
    expect(row).toHaveTextContent(profile.occurred);
    expect(row).toHaveTextContent(profile.recorded);
    expect(region).toHaveTextContent(profile.timeZone);
    expect(row).toHaveTextContent(clientName);
    const times = decisionTimes(row);
    expect(times.map((time) => time.dateTime)).toEqual([occurredAt, recordedAt]);
    expect(times.map((time) => time.textContent)).toEqual([
      formatDateTime(occurredAt, profile),
      formatDateTime(recordedAt, profile),
    ]);
  },
);
