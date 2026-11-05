import { describe, expect, it } from "vitest";
import {
  ANALYTICS_HISTORY_SCHEMA_VERSION,
  type AnalyticsHistoryEvent,
  type HistoryState,
} from "./contracts";
import {
  classifySettledForecastOutcome,
  type OutcomeFence,
  type SavedOpenForecastMember,
} from "./settledForecastOutcomes";

function id(number: number): string {
  return `10000000-1111-4111-8111-${String(number).padStart(12, "0")}`;
}

function at(day: number, fraction = "000000"): string {
  return `2026-08-${String(day).padStart(2, "0")}T00:00:00.${fraction}Z`;
}

const fence: OutcomeFence = {
  from: at(4),
  toExclusive: at(8),
  predictionCutoff: at(2),
  observedAt: at(10),
  activationId: id(1),
  ownerId: id(2),
  pipelineId: id(3),
  currency: "EUR",
};

const saved: SavedOpenForecastMember = {
  dealId: id(4),
  incarnationId: id(5),
  tipOrdinal: "1",
  status: "open",
  currency: "EUR",
  value: "99999999999999.1234",
  expectedCloseDate: null,
};

const open: HistoryState = {
  status: "open",
  ownerId: fence.ownerId,
  pipelineId: fence.pipelineId,
  stageId: id(6),
  currency: saved.currency,
  value: saved.value,
  expectedCloseDate: null,
  archivedAt: null,
  deletedAt: null,
  wonTime: null,
  lostTime: null,
  visibilityLevel: "owner",
  visibilityGroupId: null,
  visibleToUserIds: [],
};
const won: HistoryState = { ...open, status: "won" };
const lost: HistoryState = { ...open, status: "lost" };

function row(
  ordinal: number,
  observedAt: string,
  beforeState: HistoryState | null,
  afterState: HistoryState,
  transaction = ordinal,
) {
  const event: AnalyticsHistoryEvent = {
    eventId: id(100 + ordinal),
    entityId: saved.dealId,
    incarnationId: saved.incarnationId,
    ordinal: String(ordinal),
    activationId: fence.activationId,
    entityKind: "deal",
    eventKind: beforeState === null ? "baseline" : "update",
    schemaVersion: ANALYTICS_HISTORY_SCHEMA_VERSION,
    transactionId: String(100 + transaction),
    observationSnapshot: "300:300:",
    observedAt,
    beforeState,
    afterState,
    beforeWriteVersion: beforeState === null ? null : id(200 + ordinal),
    afterWriteVersion: id(201 + ordinal),
    actorId: null,
    commandId: null,
  };
  return { event, inPrediction: beforeState === null };
}

const anchor = row(1, at(1), null, open);

function classify(...later: ReturnType<typeof row>[]) {
  return classifySettledForecastOutcome([anchor, ...later], saved, fence);
}

describe("settled forecast outcome labels", () => {
  it("distinguishes a still-open no-win from closed-lost with an observed suffix", () => {
    expect(classify()).toEqual({
      kind: "no-win",
      stateAtEnd: "still-open",
      witnessId: anchor.event.eventId,
    });
    const loss = row(2, at(5), open, lost);
    expect(classify(loss)).toEqual({
      kind: "no-win",
      stateAtEnd: "closed-lost",
      witnessId: loss.event.eventId,
    });
  });

  it("uses half-open native row observation and exact value from the first net win", () => {
    const win = row(2, at(4), open, won);
    expect(classify(win, row(3, at(5), won, { ...won, value: "0.0100" }))).toEqual({
      kind: "won",
      eventId: win.event.eventId,
      occurredAt: at(4),
      observedAt: at(10),
      value: saved.value,
    });
    expect(classify(row(2, at(8), open, won))).toEqual({
      kind: "no-win",
      stateAtEnd: "still-open",
      witnessId: anchor.event.eventId,
    });
    expect(classify(row(2, at(3), open, won))).toMatchObject({
      kind: "no-win",
      stateAtEnd: "closed-won-before-target",
    });
  });

  it("folds transient same-transaction wins and withholds a change straddling the end", () => {
    expect(
      classify(row(2, at(5), open, won, 2), row(3, at(5, "000001"), won, open, 2)),
    ).toMatchObject({ kind: "no-win", stateAtEnd: "still-open" });
    expect(
      classify(row(2, at(7), open, won, 2), row(3, at(8), won, { ...won, value: "0.0100" }, 2)),
    ).toBeNull();
  });

  it("honors a committed loss and reopen before the first observed in-period win", () => {
    const win = row(4, at(7), open, won);
    expect(classify(row(2, at(5), open, lost), row(3, at(6), lost, open), win)).toMatchObject({
      kind: "won",
      eventId: win.event.eventId,
    });
  });

  it("refuses in-period direct outcome corrections and scoped lifecycle or ownership gaps", () => {
    expect(classify(row(2, at(5), open, lost), row(3, at(6), lost, won))).toBeNull();
    expect(classify(row(2, at(5), open, { ...open, ownerId: id(99) }))).toBeNull();
    expect(classify(row(2, at(5), open, { ...open, archivedAt: at(5) }))).toBeNull();
    expect(classify(row(2, at(5), open, { ...open, currency: "USD" }))).toBeNull();
  });

  it("refuses missing members, anchor mismatch, wrong incarnation and disconnected suffix", () => {
    const change = row(2, at(5), open, won);
    expect(classifySettledForecastOutcome([], saved, fence)).toBeNull();
    expect(
      classifySettledForecastOutcome([{ ...anchor, inPrediction: false }], saved, fence),
    ).toBeNull();
    expect(classify({ ...change, event: { ...change.event, incarnationId: id(98) } })).toBeNull();
    expect(classify(row(3, at(6), lost, won))).toBeNull();
    expect(
      classifySettledForecastOutcome([anchor], saved, { ...fence, observedAt: at(7) }),
    ).toBeNull();
  });
});
