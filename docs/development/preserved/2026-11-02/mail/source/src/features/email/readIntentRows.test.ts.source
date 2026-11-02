import { describe, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { readIntentReceipt, readIntentRow } from "./readIntentRows";

// Timestamp strings observed in the actual native26-r1 driver receipt. Reuse
// those values as DTO inputs here, without asserting any database behavior.
const RAW_TIMESTAMP = "2026-11-02 00:16:07.009205+00";
const RAW_TERMINAL_TIMESTAMP = "2026-11-02 00:16:07.010003+00";
const PUBLIC_TIMESTAMP = "2026-11-02T00:16:07.009Z";

function rawIntent() {
  return {
    actorId: "10000000-0000-4000-8000-000000000001",
    operationId: "10000000-0000-4000-8000-000000000002",
    accountId: "10000000-0000-4000-8000-000000000003",
    threadId: "10000000-0000-4000-8000-000000000004",
    mailboxOwnerId: "10000000-0000-4000-8000-000000000001",
    accountProvider: "gmail",
    connectionGeneration: 1,
    privateCopy: true,
    desiredRead: true,
    readMode: "local",
    state: "applied",
    createdAt: RAW_TIMESTAMP,
    admitBefore: RAW_TIMESTAMP,
    admittedAt: RAW_TIMESTAMP,
    terminalAt: RAW_TERMINAL_TIMESTAMP,
    dispatchClaim: "70d7d4d1-4637-4db7-8325-90e82faa6284",
    errorId: null,
  };
}

function storedIntent(raw: Record<string, unknown>) {
  const intent = readIntentRow([raw]);
  if (intent === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Nonempty DTO fixture was not mapped");
  return intent;
}

describe("read intent receipt timestamp mapping", () => {
  it("serializes raw SQL timestamp strings without changing stored timestamp precision", () => {
    const raw = rawIntent();
    const intent = storedIntent(raw);

    expect(readIntentReceipt(intent)).toEqual({
      operationId: raw.operationId,
      threadId: raw.threadId,
      desiredRead: true,
      state: "applied",
      admitBefore: PUBLIC_TIMESTAMP,
    });
    expect(intent.admitBefore).toBe(RAW_TIMESTAMP);
    expect(intent.admittedAt).toBe(RAW_TIMESTAMP);
    expect(intent.terminalAt).toBe(RAW_TERMINAL_TIMESTAMP);
    expect(raw.admitBefore).toBe(RAW_TIMESTAMP);
  });

  it("continues to serialize native Date values as a positive control", () => {
    const timestamp = new Date(PUBLIC_TIMESTAMP);
    const intent = storedIntent({
      ...rawIntent(),
      createdAt: timestamp,
      admitBefore: timestamp,
      admittedAt: timestamp,
      terminalAt: new Date("2026-11-02T00:16:07.010Z"),
    });

    expect(readIntentReceipt(intent).admitBefore).toBe(PUBLIC_TIMESTAMP);
    expect(intent.admitBefore).toBe(timestamp);
  });

  it("rejects invalid timestamps with an opaque DB_INVARIANT rather than a native error", () => {
    const invalidTimestamp = "private-invalid-sql-timestamp";
    for (const admitBefore of [invalidTimestamp, new Date(Number.NaN)]) {
      let failure: unknown;
      try {
        readIntentReceipt(storedIntent({ ...rawIntent(), admitBefore }));
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AppError);
      expect(failure).toMatchObject({ id: ERROR_IDS.DB_INVARIANT });
      expect(failure).not.toBeInstanceOf(TypeError);
      expect(failure).not.toBeInstanceOf(RangeError);
      expect(String(failure)).not.toContain(invalidTimestamp);
    }
  });
});
