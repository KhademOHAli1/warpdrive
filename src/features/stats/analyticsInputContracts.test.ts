import { describe, expect, test } from "vitest";
import {
  ANALYTICS_INPUT_CONTRACT_VERSION,
  ANALYTICS_INPUT_QUALIFICATION,
  analyticsInputBatch,
  analyticsObservationWindow,
  analyticsOriginalMoney,
  analyticsSourceEvent,
  analyticsSourceProvenance,
} from "./analyticsInputContracts";

const MONEY = { amount: "99999999999999.1234", currency: "IRR", unit: "currency-major" };
const WINDOW = { kind: "civil-days", from: "2026-03-21", toExclusive: "2026-04-21" };
const IDENTITY = {
  personId: "person-1",
  accountId: "account-1",
  opportunityId: "opportunity-1",
  purchaseId: "purchase-1",
};
function provenance(id = "1", patch: Record<string, unknown> = {}) {
  return {
    producer: "recorded-source",
    sourceRecordId: `record-${id}`,
    eventId: `event-${id}`,
    revision: 1,
    capturedAt: "2026-11-05T12:00:00Z",
    effectiveAt: "2026-11-04T20:30:00.123456Z",
    calendar: "persian",
    storage: "gregorian-iso8601",
    timeZone: "Asia/Tehran",
    ...patch,
  };
}
function touchpoint(id = "1", patch: Record<string, unknown> = {}) {
  return {
    kind: "touchpoint",
    provenance: provenance(id),
    identity: IDENTITY,
    identityState: "recorded",
    channel: "referral",
    sourceState: "captured",
    campaignId: "campaign-1",
    interaction: "referral",
    ...patch,
  };
}
function batch(events: unknown[]) {
  return { contractVersion: ANALYTICS_INPUT_CONTRACT_VERSION, batchId: "import-1", events };
}
function geo(patch: Record<string, unknown> = {}) {
  return {
    kind: "geo-outcome",
    provenance: provenance(),
    experimentId: "experiment-1",
    variantId: "control",
    geoId: "geo-1",
    window: WINDOW,
    countUnit: "accounts",
    eligibleUnits: 10,
    exposedUnits: 0,
    convertedUnits: 2,
    ...patch,
  };
}

describe("governed analytics source input contracts", () => {
  test("validates payloads while keeping source qualification and server authority explicitly outstanding", () => {
    const input = batch([touchpoint()]);
    expect(analyticsInputBatch.parse(input)).toEqual(input);
    expect(ANALYTICS_INPUT_QUALIFICATION.state).toBe("unqualified");
    expect(ANALYTICS_INPUT_QUALIFICATION.required).toContain("Authenticate the producer");
    expect(ANALYTICS_INPUT_QUALIFICATION.required).toContain("reapply viewer permissions");
    expect(analyticsInputBatch.safeParse({ ...input, qualified: true }).success).toBe(false);
  });

  test("preserves distinct source identities and multiple contacts linked to one purchase", () => {
    const input = batch([
      touchpoint("1"),
      touchpoint("2", { identity: { ...IDENTITY, personId: "person-2" } }),
    ]);
    const parsed = analyticsInputBatch.parse(input);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events).toEqual(input.events);
    expect(ANALYTICS_INPUT_QUALIFICATION.identity).toContain("No fuzzy identity merging");
  });

  test("permits explicit unresolved identity but refuses fabricated recorded links", () => {
    expect(
      analyticsSourceEvent.safeParse(touchpoint("1", { identity: {}, identityState: "unresolved" }))
        .success,
    ).toBe(true);
    expect(analyticsSourceEvent.safeParse(touchpoint("1", { identity: {} })).success).toBe(false);
    expect(
      analyticsSourceEvent.safeParse(touchpoint("1", { identityState: "unresolved" })).success,
    ).toBe(false);
    expect(
      analyticsSourceEvent.safeParse(
        touchpoint("1", { identity: { fuzzyMatchName: "Account name" } }),
      ).success,
    ).toBe(false);
  });

  test("retains exact original money and rejects floats, invalid currencies and missing or alternate units", () => {
    expect(analyticsOriginalMoney.parse(MONEY)).toEqual(MONEY);
    for (const patch of [
      { amount: 99999999999999.12 },
      { amount: "1.00001" },
      { amount: "100000000000000.0000" },
      { amount: "-1" },
      { currency: "XYZ" },
      { unit: "toman" },
      { unit: undefined },
    ]) {
      expect(analyticsOriginalMoney.safeParse({ ...MONEY, ...patch }).success).toBe(false);
    }
    expect(
      analyticsOriginalMoney.parse({ ...MONEY, amount: "0.0001", currency: "EUR" }).amount,
    ).toBe("0.0001");
  });

  test("requires source provenance and rejects payload permission claims", () => {
    for (const field of [
      "producer",
      "sourceRecordId",
      "eventId",
      "revision",
      "capturedAt",
      "effectiveAt",
      "calendar",
      "storage",
      "timeZone",
    ]) {
      expect(
        analyticsSourceProvenance.safeParse({ ...provenance(), [field]: undefined }).success,
      ).toBe(false);
    }
    expect(
      analyticsSourceProvenance.safeParse({ ...provenance(), timeZone: "Invalid/Zone" }).success,
    ).toBe(false);
    expect(
      analyticsSourceProvenance.safeParse({ ...provenance(), permissionGroupIds: ["admin"] })
        .success,
    ).toBe(false);
    expect(
      analyticsSourceEvent.safeParse({ ...touchpoint(), viewerUserId: "trusted-actor" }).success,
    ).toBe(false);
    expect(
      analyticsInputBatch.safeParse({ ...batch([touchpoint()]), actorId: "trusted-actor" }).success,
    ).toBe(false);
  });

  test("keeps civil dates distinct from offset instants and preserves a declared source calendar", () => {
    expect(analyticsObservationWindow.parse(WINDOW)).toEqual(WINDOW);
    expect(analyticsObservationWindow.safeParse({ ...WINDOW, from: "1405/01/01" }).success).toBe(
      false,
    );
    expect(
      analyticsObservationWindow.safeParse({ ...WINDOW, from: "2026-03-21T00:00:00Z" }).success,
    ).toBe(false);
    expect(
      analyticsSourceProvenance.safeParse({ ...provenance(), effectiveAt: "2026-11-04" }).success,
    ).toBe(false);
    expect(
      analyticsSourceProvenance.safeParse({ ...provenance(), effectiveAt: "2026-11-04T12:00:00" })
        .success,
    ).toBe(false);
    expect(analyticsSourceProvenance.parse(provenance()).calendar).toBe("persian");
    expect(ANALYTICS_INPUT_QUALIFICATION.calendar).toContain("Gregorian ISO dates");
  });

  test("rejects reversed or empty windows and compares offset instants without losing microseconds", () => {
    for (const toExclusive of [WINDOW.from, "2026-03-20"]) {
      expect(analyticsObservationWindow.safeParse({ ...WINDOW, toExclusive }).success).toBe(false);
    }
    expect(
      analyticsObservationWindow.safeParse({
        kind: "instants",
        from: "2026-06-01T12:00:00+02:00",
        toExclusive: "2026-06-01T10:00:00Z",
      }).success,
    ).toBe(false);
    const narrow = {
      kind: "instants",
      from: "2026-06-01T10:00:00.000001Z",
      toExclusive: "2026-06-01T10:00:00.000002Z",
    };
    expect(analyticsObservationWindow.parse(narrow)).toEqual(narrow);
  });

  test("rejects duplicate batch event IDs at a deterministic item path", () => {
    const duplicate = touchpoint("2", { provenance: provenance("2", { eventId: "event-1" }) });
    const result = analyticsInputBatch.safeParse(batch([touchpoint(), duplicate]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "events",
        1,
        "provenance",
        "eventId",
      ]);
    }
  });

  test("rejects a duplicate producer/source-record revision even when the event IDs differ", () => {
    const duplicate = touchpoint("2", {
      provenance: provenance("2", { sourceRecordId: "record-1" }),
    });
    const result = analyticsInputBatch.safeParse(batch([touchpoint(), duplicate]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "events",
        1,
        "provenance",
        "revision",
      ]);
    }
    expect(
      analyticsInputBatch.safeParse(
        batch([
          touchpoint(),
          touchpoint("2", {
            provenance: provenance("2", { producer: "other-source", sourceRecordId: "record-1" }),
          }),
        ]),
      ).success,
    ).toBe(true);
  });

  test("requires explicit correction links and retains both original and correction events", () => {
    const correction = touchpoint("2", {
      provenance: provenance("2", {
        sourceRecordId: "record-1",
        revision: 2,
        supersedes: { eventId: "event-1", revision: 1 },
        correctionReason: "Recorded source correction",
      }),
      channel: "event",
    });
    const input = batch([touchpoint(), correction]);
    expect(analyticsInputBatch.parse(input).events).toEqual(input.events);
    expect(analyticsSourceProvenance.safeParse(provenance("2", { revision: 2 })).success).toBe(
      false,
    );
    expect(
      analyticsSourceProvenance.safeParse(
        provenance("2", { supersedes: { eventId: "event-1", revision: 1 } }),
      ).success,
    ).toBe(false);
    expect(
      analyticsSourceProvenance.safeParse(
        provenance("2", {
          revision: 2,
          supersedes: { eventId: "event-2", revision: 1 },
          correctionReason: "Self reference",
        }),
      ).success,
    ).toBe(false);
    expect(
      analyticsSourceProvenance.safeParse(
        provenance("2", {
          revision: 2,
          supersedes: { eventId: "event-1", revision: 1 },
          correctionReason: " \n\t ",
        }),
      ).success,
    ).toBe(false);
  });

  test("namespaces event IDs and correction lookup by producer", () => {
    const otherOriginal = touchpoint("1", {
      provenance: provenance("1", { producer: "other-source" }),
    });
    const otherCorrection = touchpoint("2", {
      provenance: provenance("2", {
        producer: "other-source",
        sourceRecordId: "record-1",
        revision: 2,
        supersedes: { eventId: "event-1", revision: 1 },
        correctionReason: "Other source correction",
      }),
    });
    const input = batch([touchpoint(), otherOriginal, otherCorrection]);
    expect(analyticsInputBatch.parse(input).events).toEqual(input.events);
  });

  test("rejects a correction that rewrites a different source record present in the batch", () => {
    const correction = touchpoint("2", {
      provenance: provenance("2", {
        revision: 2,
        supersedes: { eventId: "event-1", revision: 1 },
        correctionReason: "Wrong target",
      }),
    });
    const result = analyticsInputBatch.safeParse(batch([touchpoint(), correction]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
        "events",
        1,
        "provenance",
        "supersedes",
      ]);
    }
  });

  test("requires bounded counts and denominators without assuming control conversions require exposure", () => {
    expect(analyticsSourceEvent.parse(geo())).toMatchObject({ exposedUnits: 0, convertedUnits: 2 });
    for (const patch of [
      { eligibleUnits: -1 },
      { exposedUnits: 1.5 },
      { convertedUnits: -1 },
      { exposedUnits: 11 },
      { convertedUnits: 11 },
      { eligibleUnits: Number.MAX_SAFE_INTEGER + 1 },
      { countUnit: undefined },
      { window: undefined },
    ]) {
      expect(analyticsSourceEvent.safeParse(geo(patch)).success).toBe(false);
    }
  });

  test("requires the original purchase identity for purchases and refunds and explicit quantity units", () => {
    const commerce = {
      kind: "commerce",
      provenance: provenance(),
      event: "refund",
      orderId: "order-1",
      identity: IDENTITY,
      originalMoney: MONEY,
      quantity: 1,
      quantityUnit: "items",
    };
    expect(analyticsSourceEvent.parse(commerce)).toEqual(commerce);
    for (const event of ["purchase", "refund"]) {
      expect(
        analyticsSourceEvent.safeParse({ ...commerce, event, identity: { accountId: "account-1" } })
          .success,
      ).toBe(false);
    }
    expect(analyticsSourceEvent.safeParse({ ...commerce, quantity: -1 }).success).toBe(false);
    expect(analyticsSourceEvent.safeParse({ ...commerce, quantityUnit: undefined }).success).toBe(
      false,
    );
  });

  test("covers source costs, billing, delivery time, experiment provenance and governed customer signals", () => {
    const events = [
      {
        kind: "campaign-cost",
        campaignId: "campaign-1",
        channel: "search",
        window: WINDOW,
        originalMoney: MONEY,
        costBasis: "media",
      },
      {
        kind: "billing",
        event: "invoice",
        contractId: "contract-1",
        identity: IDENTITY,
        billingBasis: "recurring",
        coverageWindow: WINDOW,
        originalMoney: MONEY,
      },
      {
        kind: "delivery-cost",
        identity: IDENTITY,
        serviceId: "service-1",
        costBasis: "labor",
        window: WINDOW,
        originalMoney: MONEY,
        quantity: 1.25,
        quantityUnit: "hours",
      },
      {
        kind: "experiment-assignment",
        experimentId: "experiment-1",
        variantId: "control",
        unit: { kind: "account", sourceId: "account-1" },
        assignmentMethod: "randomized",
      },
      {
        kind: "experiment-exposure",
        experimentId: "experiment-1",
        variantId: "control",
        assignmentEventId: "event-3",
        unit: { kind: "account", sourceId: "account-1" },
      },
      {
        kind: "customer-signal",
        signal: "survey",
        identity: IDENTITY,
        categoryId: "satisfaction",
        state: "response",
      },
      {
        kind: "customer-signal",
        signal: "ticket",
        identity: IDENTITY,
        categoryId: "support",
        state: "resolved",
      },
    ].map((event, index) => ({
      ...event,
      provenance: provenance(String(index), {
        governance: { agreementRef: "agreement-1", retentionPolicyRef: "policy-1" },
      }),
    }));
    expect(analyticsInputBatch.parse(batch(events)).events).toEqual(events);
    const delivery = events[2];
    expect(analyticsSourceEvent.safeParse({ ...delivery, quantityUnit: undefined }).success).toBe(
      false,
    );
    expect(analyticsSourceEvent.safeParse({ ...delivery, window: undefined }).success).toBe(false);
  });
});
