// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { DeliveryReportsPanel } from "./DeliveryReportsPanel";
import type { DeliveryReportsPanelProps } from "./deliveryObservationTypes";
import {
  deliveryUiLabels,
  deliveryUiPrimaryTarget,
  deliveryUiReport,
  deliveryUiTargets,
} from "./deliveryObservationUiFixtures";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

const recoveryHint = {
  en: "We could not confirm that your review was saved. Close this dialog and refresh the report before trying again.",
  fa: "ثبت نتیجهٔ بررسی تأیید نشد. این پنجره را ببندید و پیش از تلاش دوباره، گزارش را تازه‌سازی کنید.",
  de: "Wir konnten nicht bestätigen, dass Ihre Prüfung gespeichert wurde. Schließen Sie das Fenster und aktualisieren Sie den Bericht, bevor Sie es erneut versuchen.",
};
const uncertainCases = [
  { outcome: "unknown", decision: "associate" },
  { outcome: "unknown", decision: "dismiss" },
  { outcome: "rejected", decision: "associate" },
  { outcome: "rejected", decision: "dismiss" },
] as const;

describe.each(["fa", "de", "en"] as const)("unconfirmed delivery review in %s", (locale) => {
  const L = deliveryUiLabels[locale];
  function ui(onReview: DeliveryReportsPanelProps["onReview"]) {
    return (
      <LocaleProvider locale={locale}>
        <DeliveryReportsPanel
          isOwner
          reports={[
            { ...deliveryUiReport, recipients: deliveryUiReport.recipients.map((r) => ({ ...r })) },
          ]}
          targets={deliveryUiTargets}
          onReview={onReview}
        />
      </LocaleProvider>
    );
  }
  function confirm() {
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    fireEvent.click(screen.getByRole("combobox", { name: L.sentEmail }));
    fireEvent.click(screen.getByRole("option", { name: /Angebot zur Zusammenarbeit/u }));
    fireEvent.click(screen.getByRole("combobox", { name: L.recipient }));
    fireEvent.click(screen.getByRole("option", { name: /Kunde@example\.test/u }));
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
  }
  function expectLockedDraft() {
    expect(screen.getByRole("button", { name: L.save })).toBeDisabled();
    expect(screen.getByRole("button", { name: L.dismiss })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeChecked();
    expect(screen.getByRole("combobox", { name: L.sentEmail })).toHaveTextContent(
      deliveryUiPrimaryTarget.subject,
    );
    expect(screen.getByRole("combobox", { name: L.recipient })).toHaveTextContent(
      "Kunde@example.test",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(recoveryHint[locale]);
  }

  it.each(uncertainCases)(
    "locks both decisions after $decision has an $outcome response across close and equivalent reprops",
    async ({ outcome, decision }) => {
      const onReview = vi.fn<DeliveryReportsPanelProps["onReview"]>();
      if (outcome === "unknown") onReview.mockResolvedValue({ ok: false, error: "unknown" });
      else onReview.mockRejectedValue(new DOMException("private-review-response", "NetworkError"));
      const view = render(ui(onReview));
      confirm();
      fireEvent.click(
        screen.getByRole("button", { name: decision === "associate" ? L.save : L.dismiss }),
      );
      await screen.findByRole("alert");
      expectLockedDraft();
      expect(screen.queryByText(/private-review-response/u)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: L.cancel }));
      view.rerender(ui(onReview));
      fireEvent.click(screen.getByRole("button", { name: L.review }));
      expectLockedDraft();
      fireEvent.click(screen.getByRole("button", { name: L.save }));
      fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
      expect(onReview).toHaveBeenCalledTimes(1);
      expect(onReview).toHaveBeenCalledWith(
        expect.objectContaining({ decision, expectedRevision: 0 }),
      );
    },
  );

  it.each(["invalid_input", "rate_limit"] as const)(
    "keeps an explicit %s outcome editable without requiring a fresh read",
    async (error) => {
      const onReview = vi
        .fn<DeliveryReportsPanelProps["onReview"]>()
        .mockResolvedValueOnce({ ok: false, error })
        .mockResolvedValueOnce({
          ok: true,
          value: { revision: 1, decision: "dismissed", target: null },
        });
      render(ui(onReview));
      confirm();
      fireEvent.click(screen.getByRole("button", { name: L.save }));
      expect(await screen.findByRole("alert")).toHaveTextContent(L.failure);
      expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeEnabled();
      expect(screen.getByRole("button", { name: L.save })).toBeEnabled();
      expect(screen.getByRole("button", { name: L.dismiss })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
      expect(onReview).toHaveBeenCalledTimes(2);
      expect(onReview).toHaveBeenLastCalledWith(
        expect.objectContaining({ decision: "dismiss", expectedRevision: 0 }),
      );
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
    },
  );
});
