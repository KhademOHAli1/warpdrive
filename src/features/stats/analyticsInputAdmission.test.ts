import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  ANALYTICS_INPUT_FINGERPRINT_VERSION,
  type AnalyticsInputAdmission,
  type AnalyticsInputReceipt,
  fingerprintAnalyticsInputEvent,
  MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS,
  planAnalyticsInputAdmission,
} from "./analyticsInputAdmission";
import { analyticsInputBatch, analyticsSourceEvent } from "./analyticsInputContracts";

interface PointOptions {
  producer?: string;
  sourceRecordId?: string;
  channel?: string;
}

function provenance(
  eventId: string,
  revision = 1,
  target?: { eventId: string; revision: number },
  options: PointOptions = {},
) {
  return {
    producer: options.producer ?? "producer-1",
    sourceRecordId: options.sourceRecordId ?? "record-1",
    eventId,
    revision,
    capturedAt: "2026-11-05T12:00:00Z",
    effectiveAt: "2026-11-05T12:00:00.000001Z",
    calendar: "gregory",
    storage: "gregorian-iso8601",
    timeZone: "UTC",
    ...(target === undefined
      ? {}
      : { supersedes: target, correctionReason: "Correct recorded source" }),
  };
}

function point(
  eventId = "event-1",
  revision = 1,
  target?: { eventId: string; revision: number },
  options: PointOptions = {},
) {
  return {
    kind: "touchpoint",
    provenance: provenance(eventId, revision, target, options),
    identity: { personId: "p-1", accountId: "a-1" },
    identityState: "recorded",
    channel: options.channel ?? "referral",
    sourceState: "captured",
    interaction: "referral",
  };
}

function campaign(amount: string, revision = 1, target?: { eventId: string; revision: number }) {
  return {
    kind: "campaign-cost",
    provenance: provenance(`event-${revision}`, revision, target),
    campaignId: "campaign-1",
    channel: "media",
    costBasis: "media",
    window: { kind: "civil-days", from: "2026-10-01", toExclusive: "2026-11-01" },
    originalMoney: { amount, currency: "EUR", unit: "currency-major" },
  };
}

const original = point();
const second = point("event-2", 2, { eventId: "event-1", revision: 1 }, { channel: "event" });
const third = point("event-3", 3, { eventId: "event-2", revision: 2 });

function batch(events: unknown[], batchId = "delivery-1") {
  return analyticsInputBatch.parse({ contractVersion: 1, batchId, events });
}

function prior(receipts: readonly unknown[] = []) {
  return { completeness: "complete", receipts };
}

function planned(result: AnalyticsInputAdmission) {
  expect(result.state).toBe("planned");
  if (result.state !== "planned") throw new Error(`Expected a plan, received ${result.reason}`);
  return result;
}

function receipts(events: unknown[]): AnalyticsInputReceipt[] {
  return planned(planAnalyticsInputAdmission(batch(events), prior())).appends.map(
    ({ receipt }) => receipt,
  );
}

describe("governed analytics event admission plans", () => {
  test("pins the versioned canonical fingerprint without depending on field order or absent optionals", () => {
    const parsed = analyticsSourceEvent.parse(original);
    if (parsed.kind !== "touchpoint") throw new Error("Expected a touchpoint fixture");
    const reordered = {
      ...parsed,
      provenance: { ...parsed.provenance, governance: undefined },
      identity: { accountId: "a-1", personId: "p-1", purchaseId: undefined },
      campaignId: undefined,
    };
    const canonical = JSON.stringify({
      channel: "referral",
      identity: { accountId: "a-1", personId: "p-1" },
      identityState: "recorded",
      interaction: "referral",
      kind: "touchpoint",
      provenance: {
        calendar: "gregory",
        capturedAt: "2026-11-05T12:00:00Z",
        effectiveAt: "2026-11-05T12:00:00.000001Z",
        eventId: "event-1",
        producer: "producer-1",
        revision: 1,
        sourceRecordId: "record-1",
        storage: "gregorian-iso8601",
        timeZone: "UTC",
      },
      sourceState: "captured",
    });
    const fingerprint = fingerprintAnalyticsInputEvent(parsed);
    expect(fingerprint).toEqual({
      version: ANALYTICS_INPUT_FINGERPRINT_VERSION,
      digest: createHash("sha256")
        .update(`analytics-input-event-v1:sha256\n${canonical}`, "utf8")
        .digest("hex"),
    });
    expect(fingerprintAnalyticsInputEvent(reordered)).toEqual(fingerprint);
  });

  test("plans original and linear corrections in revision order without mutating delivery order", () => {
    const input = batch([third, original, second]);
    const originalOrder = structuredClone(input);
    const result = planned(planAnalyticsInputAdmission(input, prior()));
    expect(
      result.appends.map(({ inputIndex, receipt }) => [
        inputIndex,
        receipt.revision,
        receipt.supersedes,
      ]),
    ).toEqual([
      [1, 1, null],
      [2, 2, { eventId: "event-1", revision: 1 }],
      [0, 3, { eventId: "event-2", revision: 2 }],
    ]);
    expect(result.retries).toEqual([]);
    expect(input).toEqual(originalOrder);
  });

  test("uses immutable cross-batch receipts and replays older exact events without moving the tip", () => {
    const first = receipts([original]);
    const next = planned(planAnalyticsInputAdmission(batch([second]), prior(first)));
    expect(next.appends.map(({ receipt }) => receipt.revision)).toEqual([2]);
    const stored = [...next.appends.map(({ receipt }) => receipt), ...first];
    const frozenView = structuredClone(stored);
    const replay = planned(
      planAnalyticsInputAdmission(
        batch([third, second, original], "retry-delivery"),
        prior(stored),
      ),
    );
    expect(replay.batchId).toBe("retry-delivery");
    expect(replay.appends.map(({ inputIndex, receipt }) => [inputIndex, receipt.revision])).toEqual(
      [[0, 3]],
    );
    expect(replay.retries.map(({ inputIndex, receipt }) => [inputIndex, receipt.revision])).toEqual(
      [
        [2, 1],
        [1, 2],
      ],
    );
    expect(stored).toEqual(frozenView);
  });

  test("namespaces both event and revision keys by producer", () => {
    const existing = receipts([original]);
    const other = point("event-1", 1, undefined, { producer: "another-producer" });
    const result = planned(planAnalyticsInputAdmission(batch([other]), prior(existing)));
    expect(result.appends[0]?.receipt).toMatchObject({
      producer: "another-producer",
      sourceRecordId: "record-1",
      eventId: "event-1",
    });
    const foreignTarget = point(
      "event-2",
      2,
      { eventId: "event-1", revision: 1 },
      { producer: "another-producer" },
    );
    expect(planAnalyticsInputAdmission(batch([foreignTarget]), prior(existing))).toEqual({
      state: "rejected",
      reason: "unknown-correction-target",
      inputIndex: 0,
    });
  });

  test("distinguishes reused event, revision and changed-payload keys", () => {
    const existing = prior(receipts([original]));
    const cases = [
      [point("event-1", 1, undefined, { sourceRecordId: "other-record" }), "event-key-conflict"],
      [point("alternate-event"), "revision-key-conflict"],
      [point("event-1", 1, undefined, { channel: "email" }), "fingerprint-conflict"],
    ] as const;
    for (const [event, reason] of cases) {
      expect(planAnalyticsInputAdmission(batch([event]), existing)).toEqual({
        state: "rejected",
        reason,
        inputIndex: 0,
      });
    }
    expect(
      planAnalyticsInputAdmission(batch([campaign("1.0000")]), prior(receipts([campaign("1.0")]))),
    ).toEqual({
      state: "rejected",
      reason: "fingerprint-conflict",
      inputIndex: 0,
    });
  });

  test("rejects missing, wrong-record, wrong-family and wrong-revision correction targets", () => {
    expect(planAnalyticsInputAdmission(batch([second]), prior())).toEqual({
      state: "rejected",
      reason: "unknown-correction-target",
      inputIndex: 0,
    });
    const existing = prior(receipts([original]));
    const wrongRecord = point(
      "event-2",
      2,
      { eventId: "event-1", revision: 1 },
      { sourceRecordId: "other-record" },
    );
    const wrongFamily = campaign("10", 2, { eventId: "event-1", revision: 1 });
    const wrongRevision = point("event-3", 3, { eventId: "event-1", revision: 2 });
    for (const correction of [wrongRecord, wrongFamily, wrongRevision]) {
      expect(planAnalyticsInputAdmission(batch([correction]), existing)).toEqual({
        state: "rejected",
        reason: "invalid-correction-target",
        inputIndex: 0,
      });
    }
  });

  test("rejects a fork inside one batch or across batches and enforces consecutive revisions", () => {
    const fork = point("event-3", 3, { eventId: "event-1", revision: 1 });
    expect(planAnalyticsInputAdmission(batch([fork, original, second]), prior())).toEqual({
      state: "rejected",
      reason: "stale-correction-target",
      inputIndex: 0,
    });
    expect(planAnalyticsInputAdmission(batch([fork]), prior(receipts([second, original])))).toEqual(
      {
        state: "rejected",
        reason: "stale-correction-target",
        inputIndex: 0,
      },
    );
    expect(planAnalyticsInputAdmission(batch([fork]), prior(receipts([original])))).toEqual({
      state: "rejected",
      reason: "revision-gap",
      inputIndex: 0,
    });
  });

  test("returns one atomic rejection even after a valid independent event can be planned", () => {
    const independent = point("independent", 1, undefined, { sourceRecordId: "a-independent" });
    const existing = receipts([original]);
    const before = structuredClone(existing);
    expect(
      planAnalyticsInputAdmission(
        batch([independent, point("revision-conflict")]),
        prior(existing),
      ),
    ).toEqual({
      state: "rejected",
      reason: "revision-key-conflict",
      inputIndex: 1,
    });
    expect(existing).toEqual(before);
  });

  test("refuses incomplete, malformed, duplicate and oversized prior receipt views", () => {
    const [first, correction] = receipts([original, second]);
    if (first === undefined || correction === undefined)
      throw new Error("Expected both prior receipts");
    const input = batch([third]);
    expect(
      planAnalyticsInputAdmission(input, { completeness: "incomplete", receipts: [first] }),
    ).toEqual({
      state: "rejected",
      reason: "incomplete-prior",
    });
    for (const malformed of [
      [correction],
      [first, first],
      [{ ...first, fingerprint: { ...first.fingerprint, version: "unknown-version" } }],
      [{ ...first, supersedes: { eventId: "unrelated", revision: 1 } }],
    ]) {
      expect(planAnalyticsInputAdmission(input, prior(malformed))).toEqual({
        state: "rejected",
        reason: "invalid-prior",
      });
    }
    const oversized = Array.from({ length: MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS + 1 }, () => first);
    expect(planAnalyticsInputAdmission(input, prior(oversized))).toEqual({
      state: "rejected",
      reason: "bounded-limit",
    });
  });
});
