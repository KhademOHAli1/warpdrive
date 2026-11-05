import { describe, expect, test } from "vitest";
import { type AnalyticsHistoryEvent, HISTORY_OBSERVATION_BASIS } from "./contracts";
import { currentStageEpisodesFromHistory } from "./currentStageEpisodes";
import type { CurrentDealHistory } from "./repository";

const id = "11111111-1111-4111-8111-111111111111";
const stage = "22222222-2222-4222-8222-222222222222";
const observedAt = "2026-11-05T12:00:00.000001Z";
const cutoff = "2026-11-05T12:00:01.000002Z";

function availableHistory(): Extract<CurrentDealHistory, { state: "available" | "partial" }> {
  const event: AnalyticsHistoryEvent = {
    eventId: id,
    ordinal: "1",
    activationId: id,
    entityKind: "deal",
    entityId: id,
    incarnationId: id,
    eventKind: "baseline",
    schemaVersion: 2,
    transactionId: "10",
    observationSnapshot: "10:12:10",
    observedAt,
    beforeState: null,
    afterState: {
      status: "open",
      value: "0.0001",
      currency: "EUR",
      pipelineId: id,
      stageId: stage,
      ownerId: id,
      wonTime: null,
      lostTime: null,
      expectedCloseDate: null,
      archivedAt: null,
      deletedAt: null,
      visibilityLevel: "owner",
      visibilityGroupId: null,
      visibleToUserIds: [],
    },
    beforeWriteVersion: null,
    afterWriteVersion: id,
    actorId: null,
    commandId: null,
  };
  return {
    state: "available",
    complete: true,
    limit: 5_000,
    activation: {
      activationId: id,
      schemaVersion: 2,
      activatedAt: observedAt,
      captureSemantics: HISTORY_OBSERVATION_BASIS,
    },
    observation: { databaseSnapshot: "20:20:", observedAt: cutoff },
    current: { id, incarnationId: id, activationId: id },
    events: [event],
  };
}

describe("current stage episode completeness adapter", () => {
  test.each([
    { state: "missing", reason: "capture-not-installed" },
    { state: "unavailable", reason: "history-permission-limited" },
    { state: "unavailable", reason: "source-writes-pending" },
  ] as const)("preserves the reader's $reason outcome", (history) => {
    expect(currentStageEpisodesFromHistory(history)).toEqual(history);
  });

  test.each([
    { state: "partial", complete: false },
    { state: "partial", complete: true },
    { state: "available", complete: false },
  ] as const)(
    "refuses $state with complete=$complete before computing an apparent current stage",
    (status) => {
      expect(currentStageEpisodesFromHistory({ ...availableHistory(), ...status })).toEqual({
        state: "unavailable",
        reason: "history-limit",
      });
    },
  );

  test("returns censored aging facts without forwarding raw history, contact IDs or snapshot metadata", () => {
    const report = currentStageEpisodesFromHistory(availableHistory());
    expect(report.state).toBe("available");
    if (report.state !== "available") throw new Error("Expected available aging facts");
    expect(report.episodes.currentOpenStage).toMatchObject({
      stageId: stage,
      enteredAt: null,
      ageNanoseconds: null,
      observedSpanNanoseconds: "1000001000",
      leftCensored: true,
      rightCensored: true,
    });
    expect(report).not.toHaveProperty("events");
    expect(report).not.toHaveProperty("databaseSnapshot");
    expect(report.episodes).not.toHaveProperty("personId");
    expect(JSON.stringify(report)).not.toContain('"personId"');
  });

  test("keeps invalid fold input unavailable", () => {
    const history = availableHistory();
    history.events = history.events.map((event) => ({ ...event, ordinal: "0" }));
    expect(currentStageEpisodesFromHistory(history)).toEqual({
      state: "unavailable",
      reason: "history-fold-invalid",
    });
  });

  test("uses transaction-final state for an archive and restoration within the same transaction", () => {
    const history = availableHistory();
    const baseline = history.events[0];
    if (baseline === undefined || baseline.afterState === null)
      throw new Error("Missing fixture baseline");
    const original = baseline.afterState;
    const archived = { ...original, archivedAt: "2026-11-05T12:00:00.100001Z" };
    history.events.push(
      {
        ...baseline,
        eventId: stage,
        ordinal: "2",
        transactionId: "11",
        eventKind: "update",
        observedAt: "2026-11-05T12:00:00.100001Z",
        beforeState: original,
        afterState: archived,
      },
      {
        ...baseline,
        eventId: "33333333-3333-4333-8333-333333333333",
        ordinal: "3",
        transactionId: "11",
        eventKind: "update",
        observedAt: "2026-11-05T12:00:00.200001Z",
        beforeState: archived,
        afterState: original,
      },
    );
    const report = currentStageEpisodesFromHistory(history);
    expect(report.state).toBe("available");
    if (report.state !== "available") throw new Error("Expected transaction-final aging facts");
    expect(report.episodes.completedStays).toEqual([]);
    expect(report.episodes.currentOpenStage).toMatchObject({
      enteredAt: null,
      observedSpanNanoseconds: "1000001000",
    });
  });

  test("refuses an observation cutoff earlier than captured evidence", () => {
    const history = availableHistory();
    history.observation.observedAt = "2026-11-05T11:59:59.999999Z";
    expect(currentStageEpisodesFromHistory(history)).toEqual({
      state: "unavailable",
      reason: "aging-evidence-unavailable",
      detail: "cutoff-before-evidence",
    });
  });
});
