// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { resolveLocalePreferences } from "@/features/i18n/preferences";
import { formatDateTime } from "@/lib/localeFormatting";
import { DeliveryReportsPanel } from "./DeliveryReportsPanel";
import type {
  DeliveryObservationView,
  DeliveryReportsPanelProps,
  DeliveryReviewState,
} from "./deliveryObservationTypes";
import {
  deliveryUiLabels,
  deliveryUiPrimaryTarget,
  deliveryUiRecipient,
  deliveryUiReport,
  deliveryUiSecondTarget,
  deliveryUiTargets,
  deliveryUiIds as ids,
} from "./deliveryObservationUiFixtures";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function choose(label: string, name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name }));
}
function canonicalReport(revision: number): DeliveryObservationView {
  return {
    ...deliveryUiReport,
    recipients: [
      { ...deliveryUiRecipient, review: { revision, decision: "dismissed", target: null } },
    ],
  };
}
const associated = (revision: number): DeliveryReviewState => ({
  revision,
  decision: "associated",
  target: { attemptId: ids.attempt, recipient: "Kunde@example.test", kind: "to" },
});

describe.each(["fa", "de", "en"] as const)("delivery review authority refresh in %s", (locale) => {
  const L = deliveryUiLabels[locale];
  const calendar = locale === "fa" ? "persian" : "gregory";
  const preferences = resolveLocalePreferences({ locale, calendar, timeZone: "Europe/Berlin" });
  function ui(
    onReview: DeliveryReportsPanelProps["onReview"],
    report: DeliveryObservationView = deliveryUiReport,
    targets = deliveryUiTargets,
  ) {
    return (
      <LocaleProvider locale={locale} calendar={calendar} timeZone="Europe/Berlin">
        <DeliveryReportsPanel isOwner reports={[report]} targets={targets} onReview={onReview} />
      </LocaleProvider>
    );
  }
  function confirm() {
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    choose(L.sentEmail, /Angebot zur Zusammenarbeit/u);
    choose(L.recipient, /Kunde@example\.test/u);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
  }

  it("pins revision at open and invalidates confirmation when canonical review changes", async () => {
    const onReview = vi.fn<DeliveryReportsPanelProps["onReview"]>(() =>
      Promise.resolve({ ok: true, value: associated(2) }),
    );
    const view = render(ui(onReview));
    confirm();
    expect(screen.getByRole("button", { name: L.save })).toBeEnabled();
    view.rerender(ui(onReview, canonicalReport(1)));
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(L.conflict);
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(onReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: L.cancel }));
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    expect(screen.getByRole("checkbox", { name: L.confirmation })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toHaveTextContent(
      L.chooseSentEmail,
    );
    choose(L.sentEmail, /Angebot zur Zusammenarbeit/u);
    choose(L.recipient, /Kunde@example\.test/u);
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ expectedRevision: 1 }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
  });

  it("does not acknowledge stale async success after a newer canonical review arrives", async () => {
    let finish!: (value: Awaited<ReturnType<DeliveryReportsPanelProps["onReview"]>>) => void;
    const onReview = vi.fn<DeliveryReportsPanelProps["onReview"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(ui(onReview));
    confirm();
    fireEvent.click(screen.getByRole("button", { name: L.save }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ expectedRevision: 0 }),
    );
    view.rerender(ui(onReview, canonicalReport(1)));
    await act(() => {
      finish({ ok: true, value: associated(1) });
      return Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(L.conflict);
    expect(screen.queryByText(L.saved)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
  });

  it.each(["permission", "conflict"] as const)(
    "keeps %s lockout across close/reopen until canonical refresh",
    async (error) => {
      const onReview = vi
        .fn<DeliveryReportsPanelProps["onReview"]>()
        .mockResolvedValueOnce({ ok: false, error })
        .mockResolvedValue({ ok: true, value: associated(2) });
      const view = render(ui(onReview));
      confirm();
      fireEvent.click(screen.getByRole("button", { name: L.save }));
      expect(await screen.findByRole("alert")).toHaveTextContent(L[error]);
      fireEvent.click(screen.getByRole("button", { name: L.cancel }));
      fireEvent.click(screen.getByRole("button", { name: L.review }));
      expect(screen.getByRole("alert")).toHaveTextContent(L[error]);
      expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeDisabled();
      expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
      expect(onReview).toHaveBeenCalledTimes(1);
      view.rerender(ui(onReview, canonicalReport(1)));
      fireEvent.click(screen.getByRole("button", { name: L.cancel }));
      confirm();
      fireEvent.click(screen.getByRole("button", { name: L.save }));
      expect(onReview).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 1 }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
    },
  );

  it("explains empty target lists and still permits an explicitly confirmed dismissal", async () => {
    const onReview = vi.fn<DeliveryReportsPanelProps["onReview"]>(() =>
      Promise.resolve({ ok: true, value: { revision: 1, decision: "dismissed", target: null } }),
    );
    render(ui(onReview, deliveryUiReport, []));
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    expect(screen.getByText(L.noTargets)).toBeVisible();
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
    expect(onReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ decision: "dismiss", expectedRevision: 0 }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
  });

  it("distinguishes same-subject sends to the second and exposes an immutable owner-only reference", () => {
    const first = { ...deliveryUiPrimaryTarget, sentAt: "2026-10-31T10:00:00.000Z" };
    const second = {
      ...deliveryUiSecondTarget,
      subject: first.subject,
      sentAt: "2026-10-31T10:00:45.000Z",
    };
    render(ui(vi.fn(), deliveryUiReport, [first, second]));
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    fireEvent.click(screen.getByRole("combobox", { name: L.sentEmail }));
    const expectedTime = (iso: string) =>
      formatDateTime(new Date(iso), preferences, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    const options = screen.getAllByRole("option");
    const firstOption = options.find((option) =>
      option.textContent?.includes(expectedTime(first.sentAt)),
    );
    const secondOption = options.find((option) =>
      option.textContent?.includes(expectedTime(second.sentAt)),
    );
    expect(firstOption).toBeDefined();
    expect(secondOption).toBeDefined();
    expect(firstOption).not.toBe(secondOption);
    if (secondOption === undefined) throw new Error("Missing exact-time target option");
    fireEvent.click(secondOption);
    const details = screen.getByRole("group", { name: L.targetDetails });
    expect(within(details).getByText(L.reference)).toBeVisible();
    expect(within(details).getByText(second.attemptId).closest("bdi")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(within(details).getByText(expectedTime(second.sentAt))).toBeVisible();
    expect(within(details).queryByRole("link")).not.toBeInTheDocument();
  });
});
