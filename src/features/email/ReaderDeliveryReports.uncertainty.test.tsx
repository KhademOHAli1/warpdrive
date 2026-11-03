// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import {
  deferred,
  readerRead,
  readerReview,
  readerScope,
  resetReaderTransport,
  transportReport,
} from "./deliveryObservationReader.fixtures";
import type { readDeliveryObservationReports } from "./deliveryObservationTransport.client";
import { deliveryUiLabels } from "./deliveryObservationUiFixtures";
import { ReaderDeliveryReports } from "./ReaderDeliveryReports";

const { utils } = vi.hoisted(() => {
  const endpoint = () => ({ invalidate: vi.fn(() => Promise.resolve()) });
  return {
    utils: {
      email: {
        thread: { get: endpoint() },
        message: { get: endpoint() },
        inbox: { list: endpoint(), unreadCount: endpoint() },
        folders: { sent: endpoint(), archive: endpoint() },
        search: endpoint(),
        listMessagesForDeal: endpoint(),
        listMessagesForContact: endpoint(),
      },
    },
  };
});
vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => utils } }));
vi.mock("./deliveryObservationTransport.client", () => ({
  readDeliveryObservationReports: vi.fn(),
  listDeliveryObservationReviewTargets: vi.fn(),
  reviewDeliveryObservation: vi.fn(),
}));
beforeEach(() => {
  configure({ asyncUtilTimeout: 500 });
  resetReaderTransport();
});
afterEach(cleanup);

const refreshLabel = {
  en: "Refresh reports",
  fa: "تازه‌سازی گزارش‌ها",
  de: "Berichte aktualisieren",
};

describe.each(["fa", "de", "en"] as const)("uncertain reader recovery in %s", (locale) => {
  const L = deliveryUiLabels[locale];
  function ui() {
    return (
      <LocaleProvider locale={locale}>
        <ReaderDeliveryReports {...readerScope} />
      </LocaleProvider>
    );
  }

  it("requires a successful fresh read to recover, even when its revision is unchanged", async () => {
    readerReview.mockResolvedValue({ ok: false, error: "unknown" });
    const view = render(ui());
    fireEvent.click(await screen.findByRole("button", { name: L.review }));
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: L.dismiss })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: L.cancel }));
    view.rerender(ui());
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeDisabled();
    expect(readerRead).toHaveBeenCalledTimes(1);
    expect(readerReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: L.cancel }));

    const failed = deferred<Awaited<ReturnType<typeof readDeliveryObservationReports>>>();
    readerRead.mockReturnValueOnce(failed.promise);
    fireEvent.click(screen.getByRole("button", { name: refreshLabel[locale] }));
    expect(screen.queryByRole("button", { name: L.review })).not.toBeInTheDocument();
    await act(async () => {
      failed.resolve({ ok: false, error: "unknown" });
      await failed.promise;
    });
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: L.review })).not.toBeInTheDocument();
    expect(readerReview).toHaveBeenCalledTimes(1);

    const fresh = deferred<Awaited<ReturnType<typeof readDeliveryObservationReports>>>();
    readerRead.mockReturnValueOnce(fresh.promise);
    fireEvent.click(screen.getByRole("button", { name: refreshLabel[locale] }));
    expect(screen.queryByRole("button", { name: L.review })).not.toBeInTheDocument();
    await act(async () => {
      fresh.resolve({ ok: true, value: [transportReport] });
      await fresh.promise;
    });
    fireEvent.click(await screen.findByRole("button", { name: L.review }));
    expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: L.confirmation })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    expect(screen.getByRole("button", { name: L.dismiss })).toBeEnabled();
    expect(readerRead).toHaveBeenCalledTimes(3);
    expect(readerReview).toHaveBeenCalledTimes(1);
  });
});
