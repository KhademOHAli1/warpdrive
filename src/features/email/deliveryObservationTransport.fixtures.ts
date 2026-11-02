import { vi } from "vitest";
import type {
  DeliveryObservationView,
  DeliveryReviewInput,
  DeliveryReviewState,
} from "./deliveryObservationTypes";
import {
  deliveryUiIds,
  deliveryUiReport,
  deliveryUiTargets,
} from "./deliveryObservationUiFixtures";

export const transportIds = {
  ...deliveryUiIds,
  account: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e09",
  otherAccount: "601e4ee6-caa2-4cd4-81ae-d7ce96f53e0a",
};
export const transportReview: DeliveryReviewInput = {
  reportId: transportIds.report,
  recipientIndex: 0,
  expectedRevision: 0,
  confirmUnverified: true,
  decision: "associate",
  target: { attemptId: transportIds.attempt, recipient: "Kunde@example.test" },
};
export const transportSaved: DeliveryReviewState = {
  revision: 1,
  decision: "associated",
  target: {
    attemptId: transportIds.attempt,
    recipient: "Kunde@example.test",
    kind: "to",
  },
};
export const transportReport = deliveryUiReport;
export const transportTargets = deliveryUiTargets;
export const transportAssociatedReport: DeliveryObservationView = {
  ...deliveryUiReport,
  recipients: deliveryUiReport.recipients.map((recipient) => ({
    ...recipient,
    review: transportSaved,
  })),
};

export function transportResponse(body: unknown, status = 200) {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", request);
  return request;
}

export async function expectCallerAbort<T>(pending: Promise<T>, reason: DOMException) {
  const observed = pending.then(
    (value) => ({ kind: "resolved", value }),
    (error: unknown) => ({ kind: "rejected", error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      observed,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), 500);
      }),
    ]);
    return { outcome, reason };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
