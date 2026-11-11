import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { PermSetUser } from "@/features/permissions/effective";
import { admitOperationsBatch, OPERATIONS_MAX_TIMESTAMP_MS } from "./contracts";
import {
  operationsDisplayState,
  operationsFreshness,
  operationsObservationFreshness,
  requireOperationsAdmin,
} from "./policy";

const admin: PermSetUser = {
  id: "admin",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const now = 1_800_000_000_000;
const interval = 60_000;

describe("current operations authority policy", () => {
  it("admits only the current active real admin", () => {
    expect(requireOperationsAdmin(admin)).toEqual({ ok: true, value: admin });
    expect(requireOperationsAdmin(null)).toEqual({
      ok: false,
      error: { id: ERROR_IDS.AUTH_SESSION_DEAD },
    });
    expect(requireOperationsAdmin({ ...admin, isActive: false })).toEqual({
      ok: false,
      error: { id: ERROR_IDS.AUTH_SESSION_DEAD },
    });
    const downgraded: PermSetUser = {
      ...admin,
      type: "regular",
      flags: new Set(["permissions.manage"]),
    };
    expect(requireOperationsAdmin(downgraded)).toEqual({
      ok: false,
      error: { id: ERROR_IDS.PERM_DENIED },
    });
  });
});

describe("operations freshness projection", () => {
  it("leaves never-observed state unchecked with unknown age", () => {
    const freshness = operationsFreshness(undefined, now, interval);
    expect(freshness).toEqual({
      status: "unchecked",
      reason: "not_observed",
      ageMs: null,
      staleAtMs: null,
    });
    expect(operationsDisplayState("healthy", freshness)).toBe("unchecked");
  });

  it("expires exactly at its deadline and never displays historical success as current health", () => {
    const timing = { observedAtMs: now, receivedAtMs: now + 500 };
    const before = operationsFreshness(timing, now + interval - 1, interval);
    expect(before).toEqual({
      status: "current",
      reason: "current",
      ageMs: interval - 1,
      staleAtMs: now + interval,
    });
    expect(operationsDisplayState("healthy", before)).toBe("healthy");
    const expired = operationsFreshness(timing, now + interval, interval);
    expect(expired).toEqual({
      status: "stale",
      reason: "expired",
      ageMs: interval,
      staleAtMs: now + interval,
    });
    expect(operationsDisplayState("healthy", expired)).toBe("stale");
  });

  it("does not renew old evidence when its receipt arrives later", () => {
    const freshness = operationsFreshness(
      { observedAtMs: now - 300_000, receivedAtMs: now },
      now,
      interval,
    );
    expect(freshness.status).toBe("stale");
    expect(freshness.ageMs).toBe(300_000);
  });

  it("does not renew cached queue gauges or old recovery success through a fresh poll", () => {
    const generationId = "540525de-7e2b-46ed-80f0-d914aa4d450b";
    const identity = "af571da2-b78c-4079-9cf9-7b629416eaee";
    const observations = [
      {
        kind: "queue",
        queue: "file.reaper",
        state: "healthy",
        reason: "ok",
        sampledAtMs: now - 300_000,
        pendingCount: 0,
        activeCount: 0,
        readyOldestAgeMs: 0,
        lastProgressAtMs: null,
      },
      {
        kind: "recovery",
        stage: "restore_tested",
        state: "healthy",
        reason: "ok",
        recoverySetId: identity,
        completedAtMs: now - 300_000,
        durationMs: 20,
        bytes: 10,
        encrypted: true,
        contentSha256: "a".repeat(64),
      },
    ];
    const admitted = admitOperationsBatch(
      JSON.stringify({
        schemaVersion: 1,
        generationId,
        sequence: 1,
        eventId: identity,
        observedAtMs: now,
        observations,
      }),
      { installationId: identity, sourceId: identity, generationId },
      now,
    );
    if (!admitted.ok) throw new Error("Expected fixture admission");
    for (const observation of admitted.value.batch.observations) {
      expect(
        operationsObservationFreshness(observation, admitted.value, now, interval).status,
      ).toBe("stale");
    }
    const sampled = admitted.value.batch.observations[0];
    if (sampled?.kind !== "queue") throw new Error("Expected queue fixture");
    expect(
      operationsObservationFreshness(
        { ...sampled, sampledAtMs: null },
        admitted.value,
        now,
        interval,
      ),
    ).toEqual({ status: "unchecked", reason: "not_observed", ageMs: null, staleAtMs: null });
  });

  it("keeps a fresh failed observer separate from healthy observed components", () => {
    const current = operationsFreshness({ observedAtMs: now, receivedAtMs: now }, now, interval);
    expect(operationsDisplayState("failed", current)).toBe("failed");
    expect(operationsDisplayState("unknown", current)).toBe("unknown");
    expect(operationsDisplayState("healthy", current)).toBe("healthy");
  });

  it("reports future/skewed clocks as unknown with null age, never clamps them to zero", () => {
    for (const timing of [
      { observedAtMs: now + 1, receivedAtMs: now },
      { observedAtMs: now, receivedAtMs: now + 1 },
      { observedAtMs: now, receivedAtMs: now - 30_001 },
    ]) {
      const freshness = operationsFreshness(timing, now, interval);
      expect(freshness).toEqual({
        status: "unknown",
        reason: "clock_ahead",
        ageMs: null,
        staleAtMs: null,
      });
      expect(operationsDisplayState("healthy", freshness)).toBe("unknown");
    }
  });

  it("rejects invalid/internal clock values and unbounded sampling policies", () => {
    for (const invalid of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(
        operationsFreshness({ observedAtMs: invalid, receivedAtMs: now }, now, interval).status,
      ).toBe("unknown");
    }
    for (const staleAfterMs of [0, -1, 1.5, 31 * 24 * 60 * 60 * 1000]) {
      expect(
        operationsFreshness({ observedAtMs: now, receivedAtMs: now }, now, staleAfterMs).status,
      ).toBe("unknown");
    }
    expect(
      operationsFreshness(
        { observedAtMs: OPERATIONS_MAX_TIMESTAMP_MS, receivedAtMs: OPERATIONS_MAX_TIMESTAMP_MS },
        OPERATIONS_MAX_TIMESTAMP_MS,
        interval,
      ).status,
    ).toBe("unknown");
  });
});
