import { vi } from "vitest";
import type { DeliveryObservationReaderScope } from "./deliveryObservationReader.types";
import {
  listDeliveryObservationReviewTargets,
  readDeliveryObservationReports,
  reviewDeliveryObservation,
} from "./deliveryObservationTransport.client";
import {
  transportAssociatedReport,
  transportIds,
  transportReport,
  transportTargets,
} from "./deliveryObservationTransport.fixtures";

export { transportAssociatedReport, transportIds, transportReport, transportTargets };
export const readerScope: DeliveryObservationReaderScope = {
  accountId: transportIds.account,
  messageId: transportIds.source,
  threadId: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e0b",
  reference: { kind: "source" as const, sourceMessageId: transportIds.source },
};
export const readerRead = vi.mocked(readDeliveryObservationReports);
export const readerTargets = vi.mocked(listDeliveryObservationReviewTargets);
export const readerReview = vi.mocked(reviewDeliveryObservation);

export function resetReaderTransport() {
  readerRead.mockReset().mockResolvedValue({ ok: true, value: [transportReport] });
  readerTargets.mockReset().mockResolvedValue({ ok: true, value: transportTargets });
  readerReview.mockReset();
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
