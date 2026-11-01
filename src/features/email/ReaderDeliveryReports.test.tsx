// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import type {
  readDeliveryObservationReports,
  reviewDeliveryObservation,
} from "./deliveryObservationTransport.client";
import { deliveryUiLabels } from "./deliveryObservationUiFixtures";
import { ReaderDeliveryReports } from "./ReaderDeliveryReports";

const { invalidations, utils } = vi.hoisted(() => {
  const invalidations = Array.from({ length: 9 }, () => vi.fn(() => Promise.resolve()));
  const endpoint = (index: number) => ({ invalidate: invalidations[index] });
  return {
    invalidations,
    utils: {
      email: {
        thread: { get: endpoint(0) },
        message: { get: endpoint(1) },
        inbox: { list: endpoint(2), unreadCount: endpoint(3) },
        folders: { sent: endpoint(4), archive: endpoint(5) },
        search: endpoint(6),
        listMessagesForDeal: endpoint(7),
        listMessagesForContact: endpoint(8),
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
  for (const invalidate of invalidations) invalidate.mockClear();
});
afterEach(cleanup);
const locales = ["fa", "de", "en"] as const;
function ui(locale: (typeof locales)[number] = "en") {
  return (
    <LocaleProvider locale={locale}>
      <ReaderDeliveryReports {...readerScope} />
    </LocaleProvider>
  );
}

describe.each(locales)("native reader report integration in %s", (locale) => {
  const L = deliveryUiLabels[locale];
  it("keeps the existing localized report surface and mixed-address direction", async () => {
    render(ui(locale));
    const region = await screen.findByRole("region", { name: L.title });
    expect(region).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    expect(screen.getByText(L.warning)).toBeVisible();
    expect(screen.getByText("Kunde@example.test").closest("bdi")).toHaveAttribute("dir", "ltr");
    expect(readerReview).not.toHaveBeenCalled();
  });

  it("opens the real review by keyboard and invalidates every reader/feed only after save", async () => {
    const save = deferred<Awaited<ReturnType<typeof reviewDeliveryObservation>>>();
    readerReview.mockReturnValueOnce(save.promise);
    render(ui(locale));
    const review = await screen.findByRole("button", { name: L.review });
    review.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: L.review })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
    expect(readerReview).toHaveBeenCalledExactlyOnceWith(
      {
        accountId: readerScope.accountId,
        input: expect.objectContaining({ decision: "dismiss", expectedRevision: 0 }),
      },
      expect.any(AbortSignal),
    );
    for (const invalidate of invalidations) expect(invalidate).not.toHaveBeenCalled();
    readerRead.mockResolvedValue({
      ok: true,
      value: [
        {
          ...transportReport,
          recipients: transportReport.recipients.map((r) => ({
            ...r,
            review: { revision: 1, decision: "dismissed", target: null },
          })),
        },
      ],
    });
    await act(async () => {
      save.resolve({ ok: true, value: { revision: 1, decision: "dismissed", target: null } });
      await save.promise;
    });
    await waitFor(() => {
      for (const invalidate of invalidations) expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(2));
  });
});

it.each(["permission", "conflict"] as const)(
  "preserves %s lockout across dialog close and equivalent reader reprops",
  async (error) => {
    const L = deliveryUiLabels.en;
    readerReview.mockResolvedValue({ ok: false, error });
    const view = render(ui());
    fireEvent.click(await screen.findByRole("button", { name: L.review }));
    fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
    fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
    expect(await screen.findByRole("alert")).toHaveTextContent(L[error]);
    fireEvent.click(screen.getByRole("button", { name: L.cancel }));
    view.rerender(ui());
    fireEvent.click(screen.getByRole("button", { name: L.review }));
    expect(screen.getByRole("alert")).toHaveTextContent(L[error]);
    expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeDisabled();
    expect(readerRead).toHaveBeenCalledTimes(1);
    expect(readerReview).toHaveBeenCalledTimes(1);
  },
);

it("clears a fixed lockout only after the explicit refresh finishes its private read", async () => {
  const L = deliveryUiLabels.en;
  readerReview.mockResolvedValueOnce({ ok: false, error: "conflict" });
  render(ui());
  fireEvent.click(await screen.findByRole("button", { name: L.review }));
  fireEvent.click(screen.getByRole("checkbox", { name: L.confirmation }));
  fireEvent.click(screen.getByRole("button", { name: L.dismiss }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: L.cancel }));
  const fresh = deferred<Awaited<ReturnType<typeof readDeliveryObservationReports>>>();
  readerRead.mockReturnValueOnce(fresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh reports" }));
  expect(screen.queryByRole("button", { name: L.review })).not.toBeInTheDocument();
  await act(async () => {
    fresh.resolve({ ok: true, value: [transportReport] });
    await fresh.promise;
  });
  fireEvent.click(await screen.findByRole("button", { name: L.review }));
  expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does no report request from an initially hidden mounted reader stack", async () => {
  const view = render(
    <div hidden inert>
      {ui()}
    </div>,
  );
  expect(readerRead).not.toHaveBeenCalled();
  view.rerender(<div>{ui()}</div>);
  await screen.findByRole("button", { name: deliveryUiLabels.en.review });
  expect(readerRead).toHaveBeenCalledTimes(1);
});

it("aborts a visible stack when its ancestor becomes inert and discards the late read", async () => {
  const old = deferred<Awaited<ReturnType<typeof readDeliveryObservationReports>>>();
  readerRead.mockReturnValueOnce(old.promise);
  const view = render(<div>{ui()}</div>);
  await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(1));
  const signal = readerRead.mock.calls[0]?.[1];
  view.rerender(
    <div inert aria-hidden="true">
      {ui()}
    </div>,
  );
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => {
    old.resolve({ ok: true, value: [transportReport] });
    await old.promise;
  });
  expect(
    screen.queryByRole("button", { name: deliveryUiLabels.en.review }),
  ).not.toBeInTheDocument();
});

it("keeps a modal alive when Radix hides the background from assistive technology", async () => {
  const L = deliveryUiLabels.en;
  render(ui());
  fireEvent.click(await screen.findByRole("button", { name: L.review }));
  const signal = readerRead.mock.calls[0]?.[1];
  expect(screen.getByRole("dialog", { name: L.review })).toBeVisible();
  await act(() => Promise.resolve());
  expect(signal?.aborted).toBe(false);
  expect(screen.getByRole("checkbox", { name: L.confirmation })).toBeEnabled();
});

it("shows a localized finite read failure without rendering hidden provider exceptions", async () => {
  readerRead.mockRejectedValueOnce(new DOMException("hidden-provider-response", "NetworkError"));
  const { container } = render(ui("de"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Die Zustellberichte konnten nicht geladen werden. Laden Sie sie erneut.",
  );
  expect(container).not.toHaveTextContent("hidden-provider-response");
  expect(readerRead).toHaveBeenCalledTimes(1);
});
