import { describe, expect, it } from "vitest";
import {
  admitOperationsBatch,
  OPERATIONS_MAX_BODY_BYTES,
  OPERATIONS_MAX_CLOCK_SKEW_MS,
  operationsBatchSchema,
  operationsObservationSchema,
  operationsReceiptKeys,
} from "./contracts";

const now = 1_800_000_000_000;
const binding = {
  installationId: "fd419c17-cfda-477c-bb16-c57947cd05e0",
  sourceId: "a116d039-cb58-469a-9d6f-01ca984cb468",
  generationId: "540525de-7e2b-46ed-80f0-d914aa4d450b",
};
const eventId = "af571da2-b78c-4079-9cf9-7b629416eaee";
const component = {
  kind: "component",
  component: "web",
  state: "healthy",
  reason: "ok",
  installed: { evidence: "unchecked" },
  latencyMs: 7,
};
const queue = {
  kind: "queue",
  queue: "file.reaper",
  state: "unknown",
  reason: "not_reported",
  sampledAtMs: null,
  pendingCount: null,
  activeCount: null,
  readyOldestAgeMs: null,
  lastProgressAtMs: null,
};
const batch = (observations: unknown[] = [component]) => ({
  schemaVersion: 2,
  generationId: binding.generationId,
  sequence: 1,
  observedAtMs: now,
  observations,
});
const admit = (value: unknown) => admitOperationsBatch(JSON.stringify(value), binding, now);

describe("operations batch admission", () => {
  it("binds only authenticated server identity and gives replay namespaces without trusting body scope", () => {
    const admitted = admit(batch());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.value.binding).toEqual(binding);
    expect(operationsReceiptKeys(admitted.value)).toEqual({
      sequenceKey: `${binding.installationId}/${binding.sourceId}/${binding.generationId}/1`,
      eventKey: `${binding.installationId}/${binding.sourceId}/${binding.generationId}/1`,
    });
    expect(admit({ ...batch(), workspaceId: binding.installationId })).toEqual({
      ok: false,
      error: "invalid_payload",
    });
    expect(admit({ ...batch(), installationId: binding.installationId })).toEqual({
      ok: false,
      error: "invalid_payload",
    });
    expect(admit({ ...batch(), sourceId: binding.sourceId })).toEqual({
      ok: false,
      error: "invalid_payload",
    });
  });

  it("refuses generation changes and unsafe sequence/event identities", () => {
    expect(admit({ ...batch(), generationId: eventId })).toEqual({
      ok: false,
      error: "generation_mismatch",
    });
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(admit({ ...batch(), sequence })).toEqual({ ok: false, error: "invalid_payload" });
    }
    expect(admit({ ...batch(), eventId: "caller-defined-key" })).toEqual({
      ok: false,
      error: "invalid_payload",
    });
    expect(admit({ ...batch(), schemaVersion: 1, eventId })).toEqual({
      ok: false,
      error: "invalid_payload",
    });
    expect(
      admitOperationsBatch(JSON.stringify(batch()), { ...binding, sourceId: "invalid" }, now),
    ).toEqual({ ok: false, error: "invalid_source_binding" });
  });

  it("isolates installations, sources and server-enrolled generations in event identity", () => {
    const admitted = admit(batch());
    if (!admitted.ok) throw new Error("Expected fixture admission");
    const first = operationsReceiptKeys(admitted.value);
    const anotherGeneration = operationsReceiptKeys({
      ...admitted.value,
      binding: { ...binding, generationId: eventId },
      batch: { ...admitted.value.batch, generationId: eventId },
    });
    expect(anotherGeneration.sequenceKey).not.toBe(first.sequenceKey);
    expect(anotherGeneration.eventKey).not.toBe(first.eventKey);
    const anotherInstallation = operationsReceiptKeys({
      ...admitted.value,
      binding: { ...binding, installationId: eventId },
    });
    expect(anotherInstallation.sequenceKey).not.toBe(first.sequenceKey);
    expect(anotherInstallation.eventKey).not.toBe(first.eventKey);
  });

  it("bounds raw UTF-8 bytes before parsing and returns only finite safe errors", () => {
    const raw = "x".repeat(OPERATIONS_MAX_BODY_BYTES + 1);
    expect(admitOperationsBatch(raw, binding, now)).toEqual({
      ok: false,
      error: "payload_too_large",
    });
    const unicode = "界".repeat(Math.ceil(OPERATIONS_MAX_BODY_BYTES / 3));
    expect(unicode.length).toBeLessThan(OPERATIONS_MAX_BODY_BYTES);
    expect(admitOperationsBatch(unicode, binding, now)).toEqual({
      ok: false,
      error: "payload_too_large",
    });
    expect(admitOperationsBatch('{"credential":"do-not-echo"', binding, now)).toEqual({
      ok: false,
      error: "invalid_payload",
    });
    const body = JSON.stringify(batch());
    const exact = body + " ".repeat(OPERATIONS_MAX_BODY_BYTES - body.length);
    expect(admitOperationsBatch(exact, binding, now).ok).toBe(true);
    expect(admitOperationsBatch(`${exact} `, binding, now)).toEqual({
      ok: false,
      error: "payload_too_large",
    });
  });

  it("rejects empty/excessive batches and repeated targets instead of allowing last-writer-wins", () => {
    expect(admit(batch([])).ok).toBe(false);
    expect(admit(batch(Array.from({ length: 101 }, () => component))).ok).toBe(false);
    expect(
      admit(batch([component, { ...component, state: "failed", reason: "unavailable" }])).ok,
    ).toBe(false);
    expect(admit(batch([component, { ...component, component: "worker" }])).ok).toBe(true);
    const distinct = ["web", "worker", "realtime", "newsletter_engine"].map((component) => ({
      kind: "heartbeat",
      component,
      processGeneration: eventId,
      state: "healthy",
      reason: "ok",
      uptimeMs: 100,
      activeCallbacks: 0,
    }));
    expect(admit(batch(distinct)).ok).toBe(true);
    expect(
      admit(batch([distinct[0], { ...distinct[0], processGeneration: binding.generationId }])).ok,
    ).toBe(false);
  });

  it("admits bounded source skew and old evidence without renewing its timestamp", () => {
    const atBoundary = { ...batch(), observedAtMs: now + OPERATIONS_MAX_CLOCK_SKEW_MS };
    expect(admit(atBoundary).ok).toBe(true);
    expect(admit({ ...atBoundary, observedAtMs: atBoundary.observedAtMs + 1 })).toEqual({
      ok: false,
      error: "source_clock_ahead",
    });
    const old = admit({ ...batch(), observedAtMs: 1 });
    expect(old.ok && old.value.batch.observedAtMs).toBe(1);
  });
});

describe("finite operations observations", () => {
  it("retains unsampled queue metrics as null, separately from actual zero", () => {
    expect(operationsObservationSchema.parse(queue)).toEqual(queue);
    expect(operationsObservationSchema.parse({ ...queue, pendingCount: 0 }).kind).toBe("queue");
    expect(admit(batch([queue])).ok).toBe(true);
    expect(
      admit(batch([{ ...queue, sampledAtMs: now + OPERATIONS_MAX_CLOCK_SKEW_MS + 1 }])).ok,
    ).toBe(false);
  });

  it("distinguishes process heartbeat, queue progress and observer failure without fabricating component health", () => {
    const observations = [
      component,
      queue,
      {
        kind: "heartbeat",
        component: "worker",
        processGeneration: eventId,
        state: "healthy",
        reason: "ok",
        uptimeMs: 1000,
        activeCallbacks: null,
      },
      { kind: "observer", observer: "queue_sampler", state: "failed", reason: "check_failed" },
    ];
    const parsed = operationsBatchSchema.parse(batch(observations));
    expect(parsed.observations.map((item) => item.kind)).toEqual([
      "component",
      "queue",
      "heartbeat",
      "observer",
    ]);
    expect(parsed.observations[0]?.state).toBe("healthy");
    expect(parsed.observations[3]?.state).toBe("failed");
  });

  it("requires distinct backup, offhost and restore evidence and never infers later stages", () => {
    const recovery = {
      kind: "recovery",
      stage: "backup_created",
      state: "healthy",
      reason: "ok",
      recoverySetId: eventId,
      completedAtMs: now - 1000,
      durationMs: 300,
      bytes: 42,
      encrypted: true,
      contentSha256: "a".repeat(64),
    };
    const parsed = operationsBatchSchema.parse(batch([recovery]));
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]).toEqual(recovery);
    expect(
      admit(
        batch([
          recovery,
          { ...recovery, stage: "offhost_received" },
          { ...recovery, stage: "restore_tested" },
        ]),
      ).ok,
    ).toBe(true);
    for (const missing of [
      { encrypted: false },
      { contentSha256: null },
      { recoverySetId: null },
      { completedAtMs: null },
    ]) {
      expect(admit(batch([{ ...recovery, ...missing }])).ok).toBe(false);
    }
  });

  it("accepts inspected installed identity but rejects substituting latest release information", () => {
    const installed = {
      evidence: "inspected",
      imageDigest: `sha256:${"a".repeat(64)}`,
      sourceRevision: "b".repeat(40),
      configurationSha256: "c".repeat(64),
      schemaSha256: null,
    };
    expect(admit(batch([{ ...component, installed }])).ok).toBe(true);
    expect(
      admit(batch([{ ...component, installed: { evidence: "latest_release", version: "1.6.1" } }]))
        .ok,
    ).toBe(false);
    expect(
      admit(batch([{ ...component, installed: { ...installed, latestVersion: "1.6.1" } }])).ok,
    ).toBe(false);
  });

  it("rejects arbitrary features, unsafe payloads, reason contradictions and unbounded metrics", () => {
    const invalid = [
      { ...component, url: "https://private.invalid/secret" },
      { ...component, diagnostic: { credential: "private" } },
      { ...component, reason: "raw provider error" },
      { ...component, state: "healthy", reason: "unavailable" },
      { ...component, component: "caller-chosen-command" },
      { kind: "feature", feature: "custom-unsafe-feature", state: "healthy", reason: "ok" },
      { kind: "provider", provider: "smtp://secret", state: "failed", reason: "unavailable" },
      { ...queue, pendingCount: -1 },
      { ...queue, activeCount: 1_000_000_001 },
      { ...queue, readyOldestAgeMs: Number.POSITIVE_INFINITY },
      { ...component, latencyMs: 300_001 },
    ];
    for (const observation of invalid)
      expect(operationsObservationSchema.safeParse(observation).success).toBe(false);
  });
});
