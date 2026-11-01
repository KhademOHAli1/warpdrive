import { vi } from "vitest";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

export const intakeTransportIds = {
  account: "b6a71bd0-51d2-41bf-813c-1a971b175af2",
  otherAccount: "e6a63351-a0a3-4dca-8819-c8bc832c95a1",
  intake: "a8d28be9-67aa-46ef-9509-74d47f9ac45f",
  otherIntake: "67d449f1-01f9-4f99-947f-00154f60cdfc",
};
export const intakeTransportRead = {
  accountId: intakeTransportIds.account,
  intakeId: intakeTransportIds.intake,
};
export const intakeTransportReview = {
  ...intakeTransportRead,
  expectedRevision: 4,
  decision: "keep_private" as const,
};
export const intakeTransportSummary: PrivateIntakeSummary = {
  id: intakeTransportIds.intake,
  revision: 4,
  state: "unverified",
  contentState: "retained",
  decision: null,
};
export const malformedIntakeSuccess = [
  ["extra envelope", { ok: true, value: intakeTransportSummary, debug: "private" }],
  [
    "extra evidence",
    { ok: true, value: { ...intakeTransportSummary, observedPayload: "private" } },
  ],
  [
    "foreign ID",
    { ok: true, value: { ...intakeTransportSummary, id: intakeTransportIds.otherIntake } },
  ],
  ["negative revision", { ok: true, value: { ...intakeTransportSummary, revision: -1 } }],
  ["fractional revision", { ok: true, value: { ...intakeTransportSummary, revision: 0.5 } }],
  [
    "overflow revision",
    { ok: true, value: { ...intakeTransportSummary, revision: 2_147_483_648 } },
  ],
  ["unknown state", { ok: true, value: { ...intakeTransportSummary, state: "accepted" } }],
  [
    "unknown content state",
    { ok: true, value: { ...intakeTransportSummary, contentState: "restored" } },
  ],
  [
    "unknown decision",
    { ok: true, value: { ...intakeTransportSummary, decision: "confirm_delivery" } },
  ],
  ["missing field", { ok: true, value: { ...intakeTransportRead, revision: 0 } }],
  ["error on success", { ok: false, error: "forbidden" }],
  ["unknown error", { ok: false, error: "private stack" }],
  ["extra error", { ok: false, error: "unavailable", detail: "private" }],
] as const;

export function intakeTransportResponse(body: unknown, status = 200) {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(body, { status })));
  vi.stubGlobal("fetch", request);
  return request;
}

export function deferredIntakeTransport<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function boundedIntakeTransport<T>(pending: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 500);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
