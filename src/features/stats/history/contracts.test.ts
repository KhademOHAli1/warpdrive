import { describe, expect, test } from "vitest";
import {
  analyticsHistoryEvent,
  historyActivation,
  historyOrdinal,
  historyVisibilitySnapshot,
} from "./contracts";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function state(patch: Record<string, unknown> = {}) {
  return {
    status: "open",
    value: "99999999999999.1234",
    currency: "IRR",
    pipelineId: uuid(10),
    stageId: uuid(11),
    ownerId: uuid(12),
    wonTime: null,
    lostTime: null,
    expectedCloseDate: null,
    archivedAt: null,
    deletedAt: null,
    visibilityLevel: "owner",
    visibilityGroupId: null,
    visibleToUserIds: [],
    ...patch,
  };
}

function event(patch: Record<string, unknown> = {}) {
  return {
    eventId: uuid(1),
    ordinal: "1",
    activationId: uuid(2),
    entityKind: "deal",
    entityId: uuid(3),
    incarnationId: uuid(4),
    eventKind: "insert",
    schemaVersion: 2,
    transactionId: "100",
    observationSnapshot: "100:200:150,175",
    observedAt: "2026-11-05T12:00:00.123456Z",
    beforeState: null,
    afterState: state(),
    beforeWriteVersion: null,
    afterWriteVersion: uuid(5),
    actorId: null,
    commandId: null,
    ...patch,
  };
}

describe("lossless analytics history envelope", () => {
  test("retains canonical PostgreSQL IDs with legacy non-RFC variant bits", () => {
    const legacy = "00000000-0000-0000-0000-000000000001";
    expect(
      analyticsHistoryEvent.parse(
        event({ entityId: legacy, afterState: state({ pipelineId: legacy }) }),
      ),
    ).toMatchObject({ entityId: legacy, afterState: { pipelineId: legacy } });
  });
  test.each(["9007199254740993", "9223372036854775807", 9007199254740993n])(
    "retains the exact ordinal %s without a JavaScript number",
    (ordinal) => {
      expect(historyOrdinal.parse(ordinal)).toBe(String(ordinal));
      expect(analyticsHistoryEvent.parse(event({ ordinal })).ordinal).toBe(String(ordinal));
    },
  );

  test.each([0, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "rejects a numeric ordinal even when its apparent value is %s",
    (ordinal) => {
      expect(historyOrdinal.safeParse(ordinal).success).toBe(false);
    },
  );

  test.each([
    "not-an-integer",
    "1.5",
    "-1",
    "0",
    "01",
    "1e3",
    "",
    "9223372036854775808",
    "9".repeat(128),
  ])("rejects malformed or out-of-range ordinal %s without throwing", (ordinal) => {
    expect(() => historyOrdinal.safeParse(ordinal)).not.toThrow();
    expect(historyOrdinal.safeParse(ordinal).success).toBe(false);
  });

  test("supports the unsigned xid8 range independently of the signed event ordinal", () => {
    const parsed = analyticsHistoryEvent.parse(event({ transactionId: "18446744073709551615" }));
    expect(parsed.transactionId).toBe("18446744073709551615");
  });

  test.each(["not-an-xid", "-1", "0", "01", "1.5", "18446744073709551616", "9".repeat(128)])(
    "rejects malformed or out-of-range transaction ID %s without throwing",
    (transactionId) => {
      const input = event({ transactionId });
      expect(() => analyticsHistoryEvent.safeParse(input)).not.toThrow();
      expect(analyticsHistoryEvent.safeParse(input).success).toBe(false);
    },
  );

  test.each([
    "100:200:150,175",
    "100:200:",
    "100:100:",
    "9007199254740992:9007199254740995:9007199254740992,9007199254740993",
    "18446744073709551615:18446744073709551615:",
  ])(
    "retains database observation snapshot text without deriving authority: %s",
    (observationSnapshot) => {
      const parsed = analyticsHistoryEvent.parse(event({ observationSnapshot }));
      expect(historyVisibilitySnapshot.parse(observationSnapshot)).toBe(observationSnapshot);
      expect(parsed.observationSnapshot).toBe(observationSnapshot);
      expect(parsed.actorId).toBeNull();
      expect(parsed.commandId).toBeNull();
      expect(
        analyticsHistoryEvent.safeParse({
          ...event({ observationSnapshot }),
          snapshotAuthorized: true,
        }).success,
      ).toBe(false);
    },
  );

  test.each([
    undefined,
    null,
    100,
    "",
    "100:200",
    "100:200:150,",
    "100:200:,150",
    "100:200:150 175",
    "not-a-snapshot",
    "100:200:-1",
    " 100:200:",
  ])(
    "rejects a missing or malformed observation snapshot without throwing: %s",
    (observationSnapshot) => {
      const input = event({ observationSnapshot });
      expect(() => analyticsHistoryEvent.safeParse(input)).not.toThrow();
      expect(analyticsHistoryEvent.safeParse(input).success).toBe(false);
    },
  );

  test.each([
    "200:100:",
    "0:200:",
    "100:0:",
    "18446744073709551616:18446744073709551616:",
    "100:18446744073709551616:",
    "100:200:18446744073709551616",
    "100:200:99",
    "100:200:200",
    "100:100:100",
    "100:200:175,150",
    "100:200:150,150",
    "0100:200:",
    "100:0200:",
    "100:200:0150",
    "9007199254740993:9007199254740995:9007199254740992",
    "9007199254740992:9007199254740993:9007199254740993",
  ])(
    "rejects noncanonical snapshot bounds or active transaction lists safely: %s",
    (observationSnapshot) => {
      expect(() => historyVisibilitySnapshot.safeParse(observationSnapshot)).not.toThrow();
      expect(historyVisibilitySnapshot.safeParse(observationSnapshot).success).toBe(false);
      expect(analyticsHistoryEvent.safeParse(event({ observationSnapshot })).success).toBe(false);
    },
  );

  test.each(["99999999999999.1234", "0.0001", "0.0000", "-1.0001", null])(
    "preserves recorded decimal text or null exactly: %s",
    (value) => {
      const parsed = analyticsHistoryEvent.parse(event({ afterState: state({ value }) }));
      expect(parsed.afterState?.value).toBe(value);
    },
  );

  test.each([99999999999999.12, 0, "1.00001", "100000000000000.0000", "NaN", "1e3", undefined])(
    "refuses lost-precision or unsupported recorded money: %s",
    (value) => {
      expect(analyticsHistoryEvent.safeParse(event({ afterState: state({ value }) })).success).toBe(
        false,
      );
    },
  );

  test.each([
    { eventKind: "baseline", beforeState: null, afterState: state() },
    { eventKind: "insert", beforeState: null, afterState: state() },
    { eventKind: "update", beforeState: state(), afterState: state({ value: "1.0000" }) },
    { eventKind: "delete", beforeState: state(), afterState: null },
  ])("accepts the required state shape for $eventKind", (patch) => {
    expect(analyticsHistoryEvent.safeParse(event(patch)).success).toBe(true);
  });

  test.each([
    { eventKind: "baseline", beforeState: state(), afterState: state() },
    { eventKind: "baseline", beforeState: null, afterState: null },
    { eventKind: "insert", beforeState: state(), afterState: state() },
    { eventKind: "insert", beforeState: null, afterState: null },
    { eventKind: "update", beforeState: null, afterState: state() },
    { eventKind: "update", beforeState: state(), afterState: null },
    { eventKind: "delete", beforeState: null, afterState: null },
    { eventKind: "delete", beforeState: state(), afterState: state() },
  ])("rejects an incompatible $eventKind state shape", (patch) => {
    expect(analyticsHistoryEvent.safeParse(event(patch)).success).toBe(false);
  });

  test.each([
    { status: "pending" },
    { pipelineId: "not-a-pipeline" },
    { stageId: null },
    { ownerId: "not-an-owner" },
    { currency: "" },
    { currency: null },
  ])("rejects an unsupported deal projection: %s", (patch) => {
    expect(analyticsHistoryEvent.safeParse(event({ afterState: state(patch) })).success).toBe(
      false,
    );
  });

  test.each([
    "title",
    "personId",
    "orgId",
    "lostReason",
    "sourceChannelId",
    "createdAt",
    "stageEnteredAt",
  ])("rejects excluded version 2 deal key %s rather than dropping it silently", (key) => {
    expect(
      analyticsHistoryEvent.safeParse(event({ afterState: state({ [key]: uuid(30) }) })).success,
    ).toBe(false);
  });

  test("requires historical visibility fields and the expected-close fact", () => {
    const incomplete = state();
    delete (incomplete as Record<string, unknown>).visibleToUserIds;
    expect(analyticsHistoryEvent.safeParse(event({ afterState: incomplete })).success).toBe(false);
    expect(
      analyticsHistoryEvent.safeParse(
        event({ afterState: state({ expectedCloseDate: "unknown" }) }),
      ).success,
    ).toBe(false);
  });

  test("does not infer actor or command from recorded owner or write UUID", () => {
    const parsed = analyticsHistoryEvent.parse(event());
    expect(parsed.afterState?.ownerId).toBe(uuid(12));
    expect(parsed.afterWriteVersion).toBe(uuid(5));
    expect(parsed.actorId).toBeNull();
    expect(parsed.commandId).toBeNull();
  });

  test.each(["native-create/operation-42:replay-v1", "workflow.run:customer:step:42"])(
    "preserves opaque command text without inferring an actor or authority: %s",
    (commandId) => {
      const parsed = analyticsHistoryEvent.parse(event({ commandId }));
      expect(parsed.commandId).toBe(commandId);
      expect(parsed.actorId).toBeNull();
      expect(
        analyticsHistoryEvent.safeParse({ ...event({ commandId }), commandAuthorized: true })
          .success,
      ).toBe(false);
    },
  );

  test.each([
    { commandId: "" },
    { commandId: undefined },
    { commandId: 42 },
    { commandId: {} },
    { commandId: [] },
  ])("rejects an empty or nontext command ID: $commandId", ({ commandId }) => {
    expect(analyticsHistoryEvent.safeParse(event({ commandId })).success).toBe(false);
  });

  test("keeps actor identity UUID-constrained independently of opaque command text", () => {
    expect(
      analyticsHistoryEvent.safeParse(
        event({ actorId: "service:42", commandId: "native-create/42" }),
      ).success,
    ).toBe(false);
  });

  test("retains explicit actor metadata without accepting an authority or commit-visibility claim", () => {
    const explicit = event({ actorId: uuid(20), commandId: uuid(21) });
    expect(analyticsHistoryEvent.parse(explicit)).toMatchObject({
      actorId: uuid(20),
      commandId: uuid(21),
    });
    expect(analyticsHistoryEvent.safeParse({ ...explicit, authorized: true }).success).toBe(false);
    expect(analyticsHistoryEvent.safeParse({ ...explicit, committed: true }).success).toBe(false);
  });

  test.each([
    { schemaVersion: 1 },
    { entityKind: "contact" },
    { eventKind: "inferred-stage-entry" },
    { observedAt: "2026-11-05" },
  ])("fails closed for unsupported event metadata: %s", (patch) => {
    expect(analyticsHistoryEvent.safeParse(event(patch)).success).toBe(false);
  });

  test("preserves microsecond observation precision and recorded currency rather than converting it", () => {
    const parsed = analyticsHistoryEvent.parse(
      event({ observedAt: "2026-11-05T15:30:00.123456+03:30" }),
    );
    expect(parsed.observedAt).toBe("2026-11-05T15:30:00.123456+03:30");
    expect(parsed.afterState?.currency).toBe("IRR");
    expect(parsed.afterState?.value).toBe("99999999999999.1234");
  });

  test("validates activation as a current database observation, without a creation/stage event", () => {
    const activation = {
      activationId: uuid(2),
      schemaVersion: 2,
      activatedAt: "2026-11-05T12:00:00.123456Z",
      captureSemantics: "database-row-observation-v1",
    };
    expect(historyActivation.parse(activation)).toEqual(activation);
    expect(historyActivation.safeParse({ ...activation, schemaVersion: 1 }).success).toBe(false);
    expect(
      historyActivation.safeParse({ ...activation, createdAt: "2010-01-01T00:00:00Z" }).success,
    ).toBe(false);
    expect(
      historyActivation.safeParse({
        ...activation,
        captureSemantics: "complete-historical-backfill",
      }).success,
    ).toBe(false);
  });
});
