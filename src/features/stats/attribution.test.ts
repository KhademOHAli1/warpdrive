import { assert, describe, expect, test } from "vitest";
import { type AttributionRequest, compareAttributionModels } from "./attribution";

const identity = {
  identityDefinition: "verified-scope-person-v1",
  kind: "person",
  id: "person-A",
} as const;
const conversion = {
  id: "conversion-01",
  basis: "qualified-purchase",
  at: "2026-11-05T12:00:00Z",
  subject: identity,
} as const;
const frame = {
  source: {
    definitionId: "qualified-source-v1",
    snapshotId: "source-cut-01",
    coverage: "complete",
    observedFrom: "2026-11-05T08:00:00Z",
    observedThrough: "2026-11-05T12:00:00Z",
  },
  conversion,
  lookbackNanoseconds: "14400000000000",
  halfLifeNanoseconds: "3600000000000",
} satisfies Omit<AttributionRequest, "touches">;
type Touch = AttributionRequest["touches"][number];
const touch = (id: string, at: string, channel: Touch["channel"] = { kind: "direct" }): Touch => ({
  subject: identity,
  interactionId: id,
  sourceRevisionId: `${id}:revision:1`,
  at,
  channel,
});

function available(input: AttributionRequest) {
  const result = compareAttributionModels(input);
  assert(result.state === "available");
  return result;
}

describe("descriptive touch attribution", () => {
  test("uses exact lookback endpoints, honors offset equivalence, and keeps decay credit conserved", () => {
    const report = available({
      ...frame,
      touches: [
        touch("too-early", "2026-11-05T07:59:59.999999999Z"),
        touch("boundary", "2026-11-05T09:00:00+01:00", { kind: "captured", channelId: "search" }),
        touch("middle", "2026-11-05T10:00:00Z", { kind: "unknown" }),
        touch("recent", "2026-11-05T11:59:59.999999999Z", { kind: "uncaptured" }),
        touch("at-conversion", conversion.at),
      ],
    });
    expect(report.window).toEqual({
      fromInclusive: "2026-11-05T08:00:00Z",
      toExclusive: conversion.at,
    });
    expect(report.touchesInWindow).toBe(3);
    expect(report.models["first-touch"][0]).toMatchObject({
      interactionId: "boundary",
      channel: { kind: "captured", channelId: "search" },
      creditParts: 1_000_000,
    });
    expect(report.models["last-touch"][0]).toMatchObject({
      interactionId: "recent",
      channel: { kind: "uncaptured" },
      creditParts: 1_000_000,
    });
    expect(report.models["half-life-buckets"].map(({ creditParts }) => creditParts)).toEqual([
      47619, 190476, 761905,
    ]);
    for (const rows of Object.values(report.models)) {
      expect(rows.reduce((sum, row) => sum + row.creditParts, 0)).toBe(report.creditScale);
    }
  });

  test("pins deterministic equal-time ordering and integer remainder across input order", () => {
    const at = "2026-11-05T10:00:00Z";
    const touches = [touch("B", at, { kind: "unknown" }), touch("C", at), touch("A", at)];
    const report = available({ ...frame, touches });
    expect(available({ ...frame, touches: [...touches].reverse() })).toEqual(report);
    expect(report.models["first-touch"][0]?.interactionId).toBe("A");
    expect(report.models["last-touch"][0]?.interactionId).toBe("C");
    expect(
      report.models.linear.map(({ interactionId, channel, creditParts }) => [
        interactionId,
        channel.kind,
        creditParts,
      ]),
    ).toEqual([
      ["A", "direct", 333334],
      ["B", "unknown", 333333],
      ["C", "direct", 333333],
    ]);
  });

  test("distinguishes no observed interaction from direct and an incomplete source window", () => {
    const complete = available({ ...frame, touches: [] });
    expect(complete.models.linear).toEqual([
      {
        interactionId: null,
        sourceRevisionId: null,
        channel: { kind: "no-observed-touch" },
        creditParts: 1_000_000,
      },
    ]);
    expect(
      compareAttributionModels({
        ...frame,
        source: { ...frame.source, coverage: "partial" },
        touches: [],
      }),
    ).toEqual({ state: "unavailable", reason: "incomplete-window" });
    expect(
      compareAttributionModels({
        ...frame,
        source: { ...frame.source, observedFrom: "2026-11-05T08:00:00.000000001Z" },
        touches: [],
      }),
    ).toEqual({ state: "unavailable", reason: "incomplete-window" });
    expect(
      compareAttributionModels({
        ...frame,
        source: { ...frame.source, observedThrough: "2026-11-05T11:59:59.999999999Z" },
        touches: [],
      }),
    ).toEqual({ state: "unavailable", reason: "incomplete-window" });
  });

  test("keeps correction snapshots reproducible and rejects two revisions of one interaction", () => {
    const original = touch("purchase-intro", "2026-11-05T10:00:00Z");
    const correction: Touch = {
      ...original,
      channel: { kind: "captured", channelId: "referral", campaignId: "launch" },
      sourceRevisionId: "purchase-intro:revision:2",
    };
    const before = available({ ...frame, touches: [original] });
    const after = available({
      ...frame,
      source: { ...frame.source, snapshotId: "source-cut-02" },
      touches: [correction],
    });
    expect(before.source.snapshotId).toBe("source-cut-01");
    expect(before.models.linear[0]?.channel.kind).toBe("direct");
    expect(after.models.linear[0]).toMatchObject({
      sourceRevisionId: correction.sourceRevisionId,
      channel: { kind: "captured", channelId: "referral", campaignId: "launch" },
    });
    expect(compareAttributionModels({ ...frame, touches: [original, correction] })).toEqual({
      state: "unavailable",
      reason: "duplicate-interaction",
    });
  });

  test("rejects incompatible identity, unsupported time precision and excessive decay tiers", () => {
    const interaction = touch("intro", "2026-11-05T10:00:00Z");
    for (const touches of [
      [{ ...interaction, subject: { ...identity, kind: "account" as const } }],
      [{ ...interaction, at: "2026-11-05T10:00:00.0000000001Z" }],
    ]) {
      expect(compareAttributionModels({ ...frame, touches })).toEqual({
        state: "unavailable",
        reason: "invalid-evidence",
      });
    }
    expect(compareAttributionModels({ ...frame, halfLifeNanoseconds: "1", touches: [] })).toEqual({
      state: "unavailable",
      reason: "invalid-evidence",
    });
  });
});
