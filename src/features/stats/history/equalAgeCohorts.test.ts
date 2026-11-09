import { describe, expect, test } from "vitest";
import {
  type CohortSubject,
  computeEqualAgeCohorts,
  type EqualAgeCohortInput,
  MAX_COHORT_SUBJECTS,
} from "./equalAgeCohorts";

const cutoff = "2026-03-31T12:00:00Z";
const jan = "2026-01-31T12:00:00Z";
const thirtyDays = "2592000000000000";
const base = {
  source: {
    definitionId: "deal-cohort:1",
    completeness: "complete",
    entryBasis: "observed-deal-insert",
    outcomeBasis: "qualified-win",
  },
  calendar: "gregory",
  timeZone: "UTC",
  observationCutoff: cutoff,
  horizon: { id: "30-elapsed-days", elapsedNanoseconds: thirtyDays },
} satisfies Omit<EqualAgeCohortInput, "subjects">;

function request(
  subjects: readonly unknown[],
  changes: Partial<Omit<EqualAgeCohortInput, "subjects">> = {},
) {
  return { ...base, ...changes, subjects };
}

function subject(
  id: string,
  enteredAt = jan,
  outcome: CohortSubject["outcome"] = { kind: "unknown" },
  bucketId = "2026-01",
): CohortSubject {
  return {
    subjectId: id,
    bucketId,
    enteredAt,
    entryBasis: "observed-deal-insert",
    entryEventId: `insert:${id}`,
    outcome,
  };
}

function win(eventId: string, at: string): CohortSubject["outcome"] {
  return { kind: "event", basis: "qualified-win", eventId, at };
}

function noEvent(observedThrough = cutoff): CohortSubject["outcome"] {
  return { kind: "no-event", basis: "qualified-win", observedThrough };
}

describe("exact equal-age cohort conversion", () => {
  test("does not attach a cohort comparison to an invalid reporting zone", () => {
    expect(
      computeEqualAgeCohorts(request([subject("a")], { timeZone: "not-a-zone" })),
    ).toMatchObject({
      state: "unavailable",
    });
  });
  test("compares hand-calculated January and February cohorts at the same horizon and withholds March early wins", () => {
    const input = request([
      subject(
        "mar-early",
        "2026-03-02T12:00:00Z",
        win("win:mar", "2026-03-03T12:00:00Z"),
        "2026-03",
      ),
      subject("jan-miss", jan, noEvent()),
      subject(
        "feb-exact",
        "2026-02-28T12:00:00Z",
        win("win:feb", "2026-03-30T12:00:00Z"),
        "2026-02",
      ),
      subject("jan-late", jan, win("win:late", "2026-03-02T12:00:00.000000001Z")),
      subject("jan-exact", jan, win("win:jan", "2026-03-02T12:00:00Z")),
      subject("mar-unknown", cutoff, { kind: "unknown" }, "2026-03"),
    ]);
    const result = computeEqualAgeCohorts(input);
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result).toMatchObject({
      observationCutoff: cutoff,
      horizon: base.horizon,
      uniqueSubjectCount: 6,
    });
    expect(result.cohorts).toMatchObject([
      {
        bucketId: "2026-01",
        entryCount: 3,
        notYetMatureCount: 0,
        matureUnknownCount: 0,
        matureNoConversionCount: 2,
        numerator: 1,
        denominator: 3,
        comparison: { state: "available" },
        contributors: [
          {
            subjectId: "jan-exact",
            entryEventId: "insert:jan-exact",
            status: "converted",
            conversion: { eventId: "win:jan", elapsedNanoseconds: thirtyDays },
          },
          {
            subjectId: "jan-late",
            status: "no-conversion",
            evidence: {
              kind: "after-horizon",
              eventId: "win:late",
              elapsedNanoseconds: "2592000000000001",
            },
          },
          { subjectId: "jan-miss", status: "no-conversion", evidence: { kind: "no-event" } },
        ],
      },
      { bucketId: "2026-02", numerator: 1, denominator: 1, comparison: { state: "available" } },
      {
        bucketId: "2026-03",
        entryCount: 2,
        notYetMatureCount: 2,
        numerator: 0,
        denominator: 0,
        matureUnknownCount: 0,
        matureNoConversionCount: 0,
        comparison: { state: "unavailable", reason: "no-mature-subjects" },
        contributors: [
          { subjectId: "mar-early", status: "not-yet-mature" },
          { subjectId: "mar-unknown", status: "not-yet-mature" },
        ],
      },
    ]);
    expect(result.cohorts[2]?.contributors[0]).not.toHaveProperty("conversion");
    expect(computeEqualAgeCohorts({ ...input, subjects: [...input.subjects].reverse() })).toEqual(
      result,
    );
  });

  test("keeps a mature unknown out of confirmed outcomes without shrinking the mature membership", () => {
    const result = computeEqualAgeCohorts(
      request([subject("a", jan, win("win:a", jan)), subject("b", jan, noEvent()), subject("c")]),
    );
    expect(result).toMatchObject({
      state: "available",
      cohorts: [
        {
          entryCount: 3,
          numerator: 1,
          denominator: 3,
          matureNoConversionCount: 1,
          matureUnknownCount: 1,
          comparison: { state: "unavailable", reason: "mature-history-unknown" },
          contributors: [
            { subjectId: "a", status: "converted", conversion: { elapsedNanoseconds: "0" } },
            { subjectId: "b", status: "no-conversion" },
            { subjectId: "c", status: "mature-unknown" },
          ],
        },
      ],
    });
  });

  test("reports a qualified zero and leaves immature unknowns out of the comparison", () => {
    expect(
      computeEqualAgeCohorts(
        request([subject("mature", jan, noEvent()), subject("immature", cutoff)]),
      ),
    ).toMatchObject({
      state: "available",
      cohorts: [
        {
          numerator: 0,
          denominator: 1,
          matureNoConversionCount: 1,
          notYetMatureCount: 1,
          matureUnknownCount: 0,
          comparison: { state: "available" },
        },
      ],
    });
    expect(computeEqualAgeCohorts(request([]))).toMatchObject({
      state: "available",
      uniqueSubjectCount: 0,
      cohorts: [],
    });
  });

  test("uses elapsed time across a DST boundary and carries collector calendar metadata", () => {
    const entry = "2026-03-28T12:00:00+01:00";
    const sameWallTime = "2026-03-29T12:00:00+02:00";
    const fullDay = "2026-03-29T13:00:00+02:00";
    const reporting = {
      calendar: "persian",
      timeZone: "Europe/Berlin",
      horizon: { id: "24-elapsed-hours", elapsedNanoseconds: "86400000000000" },
    } as const;
    expect(
      computeEqualAgeCohorts(
        request([subject("deal", entry, noEvent(sameWallTime), "collector-persian-bucket")], {
          ...reporting,
          observationCutoff: sameWallTime,
        }),
      ),
    ).toMatchObject({
      state: "available",
      calendar: "persian",
      timeZone: "Europe/Berlin",
      observationCutoff: "2026-03-29T10:00:00Z",
      cohorts: [{ bucketId: "collector-persian-bucket", notYetMatureCount: 1, denominator: 0 }],
    });
    expect(
      computeEqualAgeCohorts(
        request([subject("deal", entry, win("win:dst", fullDay), "collector-persian-bucket")], {
          ...reporting,
          observationCutoff: fullDay,
        }),
      ),
    ).toMatchObject({
      state: "available",
      observationCutoff: "2026-03-29T11:00:00Z",
      cohorts: [
        {
          numerator: 1,
          denominator: 1,
          contributors: [{ conversion: { elapsedNanoseconds: "86400000000000" } }],
        },
      ],
    });
  });

  test("uses an inclusive nanosecond horizon for both maturity and conversion", () => {
    const exactCutoff = "2026-11-05T12:00:00.000002Z";
    const result = computeEqualAgeCohorts(
      request(
        [
          subject("a", "2026-11-05T12:00:00.000001Z", win("win:a", exactCutoff), "explicit"),
          subject("b", "2026-11-05T12:00:00.000001001Z", win("win:b", exactCutoff), "explicit"),
          subject("c", "2026-11-05T12:00:00.000000999Z", win("win:c", exactCutoff), "explicit"),
        ],
        {
          observationCutoff: exactCutoff,
          horizon: { id: "one-microsecond", elapsedNanoseconds: "1000" },
        },
      ),
    );
    expect(result).toMatchObject({
      state: "available",
      cohorts: [
        {
          numerator: 1,
          denominator: 2,
          notYetMatureCount: 1,
          matureNoConversionCount: 1,
          contributors: [
            { status: "converted", conversion: { elapsedNanoseconds: "1000" } },
            { status: "not-yet-mature" },
            {
              status: "no-conversion",
              evidence: { kind: "after-horizon", elapsedNanoseconds: "1001" },
            },
          ],
        },
      ],
    });
  });

  test("admits a separately qualified acquisition-to-purchase cohort", () => {
    const acquired: CohortSubject = {
      ...subject("account:one"),
      entryBasis: "qualified-acquisition",
      entryEventId: "acquisition:one",
      outcome: {
        kind: "event",
        basis: "qualified-purchase",
        eventId: "purchase:one",
        at: "2026-02-01T12:00:00Z",
      },
    };
    expect(
      computeEqualAgeCohorts(
        request([acquired], {
          source: {
            definitionId: "acquisition-cohort:1",
            completeness: "complete",
            entryBasis: "qualified-acquisition",
            outcomeBasis: "qualified-purchase",
          },
        }),
      ),
    ).toMatchObject({
      state: "available",
      definitionId: "acquisition-cohort:1",
      outcomeBasis: "qualified-purchase",
      cohorts: [
        {
          numerator: 1,
          denominator: 1,
          contributors: [
            { entryEventId: "acquisition:one", conversion: { eventId: "purchase:one" } },
          ],
        },
      ],
    });
  });

  test("deduplicates stable subjects whose instants have equivalent offset spellings", () => {
    const first = subject("subject", jan, noEvent());
    const second = subject(
      "subject",
      "2026-01-31T13:00:00+01:00",
      noEvent("2026-03-31T14:00:00+02:00"),
    );
    expect(computeEqualAgeCohorts(request([first, second, first]))).toMatchObject({
      state: "available",
      uniqueSubjectCount: 1,
      duplicateDeliveries: 2,
      cohorts: [{ denominator: 1, matureNoConversionCount: 1 }],
    });
  });

  test("refuses conflicting repeat subjects and evidence assigned to multiple subjects", () => {
    const first = subject("subject", jan, win("win:one", jan));
    expect(computeEqualAgeCohorts(request([first, { ...first, bucketId: "another" }]))).toEqual({
      state: "unavailable",
      reason: "conflicting-subject",
    });
    expect(computeEqualAgeCohorts(request([first, { ...first, outcome: noEvent() }]))).toEqual({
      state: "unavailable",
      reason: "conflicting-subject",
    });
    expect(
      computeEqualAgeCohorts(request([first, subject("other", jan, win("win:one", jan))])),
    ).toEqual({
      state: "unavailable",
      reason: "conflicting-evidence",
    });
    expect(
      computeEqualAgeCohorts(
        request([first, { ...subject("other"), entryEventId: first.entryEventId }]),
      ),
    ).toEqual({
      state: "unavailable",
      reason: "conflicting-evidence",
    });
  });

  test("rejects one evidence ID asserted at two instants for the same subject", () => {
    const first = subject("subject", jan, win("insert:subject", "2026-02-01T12:00:00Z"));
    expect(computeEqualAgeCohorts(request([first]))).toEqual({
      state: "unavailable",
      reason: "conflicting-evidence",
    });
  });

  test("refuses incomplete membership and mixed entry/outcome definitions", () => {
    expect(
      computeEqualAgeCohorts(
        request([subject("a")], { source: { ...base.source, completeness: "incomplete" } }),
      ),
    ).toEqual({
      state: "unavailable",
      reason: "incomplete-source",
    });
    expect(
      computeEqualAgeCohorts(
        request([subject("a")], { source: { ...base.source, outcomeBasis: "qualified-purchase" } }),
      ),
    ).toEqual({
      state: "unavailable",
      reason: "mixed-basis",
    });
    expect(
      computeEqualAgeCohorts(
        request([subject("a"), { ...subject("b"), entryBasis: "qualified-acquisition" }]),
      ),
    ).toEqual({
      state: "unavailable",
      reason: "mixed-basis",
    });
    expect(
      computeEqualAgeCohorts(
        request([
          subject("a", jan, {
            kind: "event",
            basis: "qualified-purchase",
            eventId: "purchase:one",
            at: jan,
          }),
        ]),
      ),
    ).toEqual({ state: "unavailable", reason: "mixed-basis" });
  });

  test("rejects qualified no-win evidence for an acquisition-to-purchase cohort", () => {
    const acquired: CohortSubject = {
      ...subject("account:one", jan, noEvent()),
      entryBasis: "qualified-acquisition",
      entryEventId: "acquisition:one",
    };
    expect(
      computeEqualAgeCohorts(
        request([acquired], {
          source: {
            definitionId: "acquisition-cohort:1",
            completeness: "complete",
            entryBasis: "qualified-acquisition",
            outcomeBasis: "qualified-purchase",
          },
        }),
      ),
    ).toEqual({ state: "unavailable", reason: "mixed-basis" });
  });

  test("refuses future entries, future outcomes, pre-entry outcomes and mismatched no-event coverage", () => {
    const future = "2026-03-31T12:00:00.000000001Z";
    for (const invalid of [
      subject("future-entry", future),
      subject("future-outcome", jan, win("win:future", future)),
      subject("pre-entry", jan, win("win:early", "2026-01-31T11:59:59.999999999Z")),
      subject("short-proof", jan, noEvent("2026-03-31T11:59:59.999999999Z")),
      subject("later-proof", jan, noEvent(future)),
    ]) {
      expect(computeEqualAgeCohorts(request([invalid]))).toEqual({
        state: "unavailable",
        reason: "inconsistent-source",
      });
    }
  });

  test("rejects missing outcome proof and inferred or malformed entry fields", () => {
    for (const invalid of [
      { ...subject("a"), outcome: { kind: "no-event", basis: "qualified-win" } },
      { ...subject("a"), outcome: { kind: "no-event", observedThrough: cutoff } },
      { ...subject("a"), outcome: undefined },
      { ...subject("a"), entryBasis: "activation-baseline" },
      { ...subject("a"), enteredAt: "2026-01-31T12:00:00" },
      { ...subject("a"), enteredAt: "2026-01-31T12:00:00.0000000001Z" },
      { ...subject("a"), enteredAt: "2026-02-30T12:00:00Z" },
      { ...subject("a"), entryEventId: " " },
    ]) {
      expect(computeEqualAgeCohorts(request([invalid]))).toEqual({
        state: "unavailable",
        reason: "invalid-subject",
      });
    }
  });

  test.each(["0", "-1", "1.5", "1e9", "0001", "17280000000000000000001", "9".repeat(1000)])(
    "rejects malformed or out-of-domain elapsed horizon %s",
    (elapsedNanoseconds) => {
      expect(
        computeEqualAgeCohorts(request([], { horizon: { id: "invalid", elapsedNanoseconds } })),
      ).toEqual({
        state: "unavailable",
        reason: "invalid-request",
      });
    },
  );

  test("rejects an invalid observation instant and oversized membership before walking subjects", () => {
    expect(computeEqualAgeCohorts(request([], { observationCutoff: "2026-03-31" }))).toEqual({
      state: "unavailable",
      reason: "invalid-request",
    });
    const oversized = Array.from({ length: MAX_COHORT_SUBJECTS + 1 }, () => null);
    expect(computeEqualAgeCohorts(request(oversized))).toEqual({
      state: "unavailable",
      reason: "bounded-limit",
    });
  });
});
