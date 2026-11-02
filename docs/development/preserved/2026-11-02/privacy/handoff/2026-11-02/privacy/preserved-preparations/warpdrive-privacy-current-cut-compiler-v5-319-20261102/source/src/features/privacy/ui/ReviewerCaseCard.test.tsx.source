// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "../__fixtures__/ReviewerCaseCardTestKit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { err, ok } from "@/types/result";
import {
  CASE,
  cardProps,
  DUE,
  dateLabel,
  labels,
  mocks,
  NEXT_CASE,
  numberLabel,
  ORIGINAL_EMAIL,
  ORIGINAL_ID,
  ORIGINAL_SUBJECT,
  RECEIVED,
  RECIPIENT_ID,
  REVIEWER,
  reset,
  row,
  SUMMARY,
  wrap,
} from "../__fixtures__/ReviewerCaseCardTestKit";
import { ReviewerCaseCard } from "./ReviewerCaseCard";

beforeEach(reset);
afterEach(cleanup);
async function load() {
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(SUMMARY, {}, { timeout: 1000 });
}

for (const locale of ["en", "de", "fa"] as const)
  test(`${locale}: explicit current security recheck loads separate current and original request context`, async () => {
    const props = cardProps();
    const view = render(wrap(<ReviewerCaseCard {...props} />, locale));
    const L = labels[locale];
    expect(screen.getByRole("heading", { name: L.title }).closest("[dir]")).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(props.refreshSecurity).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.load }));
    await screen.findByText(SUMMARY, {}, { timeout: 1000 });
    expect(mocks.read).toHaveBeenCalledWith("csrf", { caseId: CASE }, REVIEWER);
    expect(vi.mocked(props.refreshSecurity).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.read.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      within(screen.getByRole("group", { name: L.currentKind })).getByText(L.closure),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: L.currentStatus })).getByText(L.underReview),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: L.revision })).getByText(numberLabel(3, locale)),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: L.casePolicy })).getByText(numberLabel(8, locale)),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: L.activePolicy })).getByText(numberLabel(1, locale)),
    ).toBeInTheDocument();
    expect(screen.getByText(L.originalNotice)).toBeInTheDocument();
    const original = screen.getByRole("group", { name: L.original });
    expect(within(original).getByText(L.access)).toBeInTheDocument();
    expect(within(original).getByText(L.persian)).toBeInTheDocument();
    expect(within(original).getByText(ORIGINAL_SUBJECT)).toBeInTheDocument();
    expect(within(original).getByText(ORIGINAL_EMAIL)).toBeInTheDocument();
    expect(screen.getByText(L.current)).toBeInTheDocument();
    expect(screen.getByText(dateLabel(RECEIVED, locale))).toBeInTheDocument();
    expect(screen.getByText(dateLabel(DUE, locale))).toBeInTheDocument();
    for (const ref of screen.getAllByText(CASE))
      expect(ref.closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(view.container.textContent).not.toMatch(/generation|policyGeneration/iu);
    expect(
      screen.queryByRole("button", {
        name: /approve|export|transition|generate|genehmigen|exportieren|تأیید درخواست|خروجی/iu,
      }),
    ).not.toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(
      /scope complete|export ready|request fulfilled/iu,
    );
  });

for (const state of ["current", "review_required"] as const)
  test(`identity ${state} reports only current review state while preserving original subject/recipient`, async () => {
    const data = row();
    data.identity.state = state;
    mocks.read.mockResolvedValueOnce(ok(data));
    render(wrap(<ReviewerCaseCard {...cardProps()} />));
    await load();
    expect(
      screen.getByText(state === "current" ? labels.en.current : labels.en.reviewRequired),
    ).toBeInTheDocument();
    const original = screen.getByRole("group", { name: labels.en.original });
    expect(within(original).getByText(ORIGINAL_SUBJECT)).toBeInTheDocument();
    expect(within(original).getByText(ORIGINAL_EMAIL)).toBeInTheDocument();
    expect(screen.queryByText(REVIEWER)).not.toBeInTheDocument();
  });

test("missing case and active policy versions stay distinct and neutral while generation remains internal", async () => {
  const data = row();
  data.case.policyVersion = null;
  data.case.dueAt = null;
  data.policy = { activeVersion: null, generation: 7 };
  mocks.read.mockResolvedValueOnce(ok(data));
  const view = render(wrap(<ReviewerCaseCard {...cardProps()} />));
  await load();
  expect(
    within(screen.getByRole("group", { name: labels.en.casePolicy })).getByText(labels.en.absent),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: labels.en.activePolicy })).getByText(
      labels.en.unconfigured,
    ),
  ).toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/generation|disabled policy|policy approved/iu);
});

for (const shape of ["external", "contact", "user"] as const)
  test(`original ${shape} subject and its recipient use explicit labels and exact references`, async () => {
    const data = row();
    data.request.subject =
      shape === "external"
        ? { kind: "external", description: ORIGINAL_SUBJECT }
        : { kind: shape, referenceId: ORIGINAL_ID };
    data.request.recipient =
      shape === "external"
        ? { channel: "operator_assisted", description: "ORIGINAL-ASSISTED-RECIPIENT" }
        : shape === "contact"
          ? { channel: "email", address: ORIGINAL_EMAIL }
          : { channel: "in_app", userId: RECIPIENT_ID };
    mocks.read.mockResolvedValueOnce(ok(data));
    render(wrap(<ReviewerCaseCard {...cardProps()} />));
    await load();
    const original = screen.getByRole("group", { name: labels.en.original });
    expect(within(original).getByText(labels.en[shape])).toBeInTheDocument();
    if (shape !== "external")
      expect(within(original).getByText(ORIGINAL_ID).closest("bdi")).toHaveAttribute("dir", "ltr");
    if (shape === "user")
      expect(within(original).getByText(RECIPIENT_ID).closest("bdi")).toHaveAttribute("dir", "ltr");
    else
      expect(
        within(original).getByText(
          shape === "external" ? "ORIGINAL-ASSISTED-RECIPIENT" : ORIGINAL_EMAIL,
        ),
      ).toBeInTheDocument();
  });

test("original summary, subject and recipient are inert text and unexpected private fields are omitted", async () => {
  const data = row();
  const summary = '<img src="https://private.example.test/x"> https://private.example.test/summary';
  data.request.summary = summary;
  data.request.subject = { kind: "external", description: "<strong>ORIGINAL-SUBJECT</strong>" };
  data.request.recipient = {
    channel: "operator_assisted",
    description: "https://private.example.test/recipient",
  };
  mocks.read.mockResolvedValueOnce(
    ok({
      ...data,
      proof: { currentSubject: "PRIVATE-CURRENT-PROOF" },
      metadataEnc: "PRIVATE-ENCRYPTED-METADATA",
    }),
  );
  const view = render(wrap(<ReviewerCaseCard {...cardProps()} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(summary, {}, { timeout: 1000 });
  expect(screen.getByText("<strong>ORIGINAL-SUBJECT</strong>")).toBeInTheDocument();
  expect(view.container.querySelectorAll("img,iframe,script,object,embed")).toHaveLength(0);
  expect(view.container.querySelector('a[href*="private.example.test"]')).toBeNull();
  expect(view.container.textContent).not.toMatch(
    /PRIVATE-CURRENT-PROOF|PRIVATE-ENCRYPTED-METADATA/,
  );
});

test("case context blocks replay without raw server values in attributes or tooltips", async () => {
  const view = render(wrap(<ReviewerCaseCard {...cardProps()} />));
  await load();
  const boundary = screen.getByText(SUMMARY).closest(`.${BLOCK_CLASS}`);
  expect(boundary).not.toBeNull();
  expect(boundary).toHaveClass("ph-no-capture");
  for (const node of view.container.querySelectorAll("*"))
    for (const attribute of node.attributes) {
      for (const value of [CASE, SUMMARY, ORIGINAL_SUBJECT, ORIGINAL_EMAIL, RECEIVED, DUE])
        expect(attribute.value).not.toContain(value);
    }
  expect(view.container.querySelector('[role="tooltip"]')).toBeNull();
});

test("a completed response for another selected case never displays original request data", async () => {
  const data = row();
  data.case.id = NEXT_CASE;
  mocks.read.mockResolvedValueOnce(ok(data));
  render(wrap(<ReviewerCaseCard {...cardProps()} />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
    await Promise.resolve();
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: /^(Load request context|Refresh request context)$/u }),
  ).toBeEnabled();
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGINAL_SUBJECT)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
  expect(screen.queryByText(labels.en.unavailable)).toBeInTheDocument();
});

test("refresh discards original details before security I/O and keeps the frozen reviewer selector", async () => {
  const props = cardProps();
  render(wrap(<ReviewerCaseCard {...props} />));
  await load();
  let release!: (value: Awaited<ReturnType<typeof props.refreshSecurity>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof props.refreshSecurity>>>((resolve) => {
    release = resolve;
  });
  vi.mocked(props.refreshSecurity).mockReturnValueOnce(pending);
  fireEvent.click(screen.getByRole("button", { name: labels.en.refresh }));
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGINAL_EMAIL)).not.toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(() => {
    release(ok(props.securityStatus));
    return Promise.resolve();
  });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2), { timeout: 1000 });
  expect(mocks.read.mock.calls.map((call) => call.slice(1))).toEqual([
    [{ caseId: CASE }, REVIEWER],
    [{ caseId: CASE }, REVIEWER],
  ]);
});

test("storage failure requires explicit readonly retry and a new current-security check", async () => {
  const props = cardProps();
  mocks.read.mockResolvedValueOnce(err("storage_unavailable"));
  render(wrap(<ReviewerCaseCard {...props} />));
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(labels.en.unavailable, {}, { timeout: 1000 });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: labels.en.load }));
  await screen.findByText(SUMMARY, {}, { timeout: 1000 });
  expect(props.refreshSecurity).toHaveBeenCalledTimes(2);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
