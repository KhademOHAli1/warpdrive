import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err } from "@/types/result";
import { readIntentRemoteFailureResult } from "./readIntentRemoteResult";
import type { ReadIntentReceipt } from "./readIntentTypes";

const receipt: ReadIntentReceipt = {
  operationId: "2cde200d-7657-431e-afdc-14266512dd9b",
  threadId: "721026cf-490f-48e8-922d-1280070402a5",
  desiredRead: true,
  state: "applied",
  admitBefore: "2026-11-02T01:00:00.000Z",
};

it("keeps a dispatched operation unconfirmed when recording its outcome also fails", () => {
  const failure = err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
  expect(readIntentRemoteFailureResult(failure, null)).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.MAIL_WRITE_UNKNOWN },
  });
});

it("preserves a recorded denial before any provider operation was attempted", () => {
  const failure = err(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox unavailable"));
  expect(
    readIntentRemoteFailureResult(failure, {
      ...receipt,
      state: "denied",
      errorId: ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE,
    }),
  ).toBe(failure);
});

it("keeps an admitted operation unconfirmed if its pre-provider denial cannot be recorded", () => {
  const failure = err(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox unavailable"));
  expect(readIntentRemoteFailureResult(failure, null)).toMatchObject({
    ok: false,
    error: { id: ERROR_IDS.MAIL_WRITE_UNKNOWN },
  });
});

it("preserves a recorded definitive rejection without turning it into unknown", () => {
  const failure = err(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "read only"));
  expect(
    readIntentRemoteFailureResult(failure, {
      ...receipt,
      state: "denied",
      errorId: ERROR_IDS.MAIL_CAPABILITY_DENIED,
    }),
  ).toBe(failure);
});

it("recovers the exact applied receipt after an acknowledgement failure without replay", () => {
  const failure = err(new AppError(ERROR_IDS.MAIL_WRITE_UNKNOWN, "receipt unavailable"));
  expect(readIntentRemoteFailureResult(failure, receipt)).toEqual({
    ok: true,
    value: { threadId: receipt.threadId, readIntent: receipt },
  });
});
