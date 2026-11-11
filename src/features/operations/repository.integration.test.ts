import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  operationsCurrent,
  operationsIncidents,
  operationsReceipts,
  operationsSources,
  operationsTransitions,
} from "@/db/schema";
import { withTestDb } from "@/db/testing";
import type { OperationsBatch, OperationsObservation, OperationsSourceBinding } from "./contracts";
import { projectOperationsCurrent } from "./projection";
import {
  pruneOperationsHistory,
  reconcileOperationsIncidents,
  recordOperationsBatch,
} from "./repository";
import { sampleOperationsStorage } from "./resources";
import { OPERATIONS_RECEIPT_LIMIT, OPERATIONS_RECEIPT_RETENTION_MS } from "./retention";
import { enrollOperationsSource, rotateOperationsSource } from "./storage";

const signal = () => AbortSignal.timeout(20_000);
const component = (state: "healthy" | "failed" = "failed"): OperationsObservation => ({
  kind: "component",
  component: "web",
  state,
  reason: state === "healthy" ? "ok" : "unavailable",
  installed: { evidence: "unchecked" },
  latencyMs: null,
});
const frame = (
  binding: OperationsSourceBinding,
  sequence: number,
  observations: OperationsObservation[] = [component()],
  observedAtMs = Date.now(),
): OperationsBatch => ({
  schemaVersion: 2,
  generationId: binding.generationId,
  sequence,
  observedAtMs,
  observations,
});
const record = (db: Db, binding: OperationsSourceBinding, batch: OperationsBatch) =>
  recordOperationsBatch(db, binding, JSON.stringify(batch), signal());

it("commits one receipt/current/incident transition under concurrent replay and canonical JSON reordering", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const batch = frame(binding, 1);
    const results = await Promise.all(Array.from({ length: 8 }, () => record(db, binding, batch)));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && !result.value.replayed)).toHaveLength(1);
    expect(await db.select().from(operationsReceipts)).toHaveLength(1);
    expect(await db.select().from(operationsCurrent)).toHaveLength(1);
    expect(await db.select().from(operationsIncidents)).toHaveLength(1);
    expect(await db.select().from(operationsTransitions)).toHaveLength(1);
    const reordered = JSON.stringify(
      {
        observations: batch.observations,
        sequence: batch.sequence,
        observedAtMs: batch.observedAtMs,
        generationId: batch.generationId,
        schemaVersion: 2,
      },
      null,
      2,
    );
    const replay = await recordOperationsBatch(db, binding, reordered, signal());
    expect(replay.ok && replay.value.replayed).toBe(true);
  });
});

it("rejects conflicting retained sequence payloads and atomically resolves concurrent conflicts", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const batch = frame(binding, 1);
    const conflicts = await Promise.all([
      record(db, binding, batch),
      record(db, binding, { ...batch, observations: [component("healthy")] }),
    ]);
    expect(conflicts.filter((result) => result.ok)).toHaveLength(1);
    expect(conflicts.filter((result) => !result.ok)).toEqual([
      { ok: false, error: "identity_conflict" },
    ]);
    expect(await db.select().from(operationsReceipts)).toHaveLength(1);
    const [source] = await db.select().from(operationsSources);
    expect(source?.highestSequence).toBe(1);
    expect(source?.receiptOrdinal).toBe(1);
  });
});

it("never applies absent old sequences or regresses current facts from later sequence with older sample time", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const at = Date.now() - 1000;
    expect((await record(db, binding, frame(binding, 2, [component("healthy")], at))).ok).toBe(
      true,
    );
    expect(await record(db, binding, frame(binding, 1, [component()], at - 1000))).toEqual({
      ok: false,
      error: "expired_or_out_of_order",
    });
    const old = await record(db, binding, frame(binding, 3, [component()], at - 1000));
    expect(old.ok && old.value.appliedObservations).toBe(0);
    const [current] = await db.select().from(operationsCurrent);
    expect(current?.sequence).toBe(2);
    expect(current?.observation.state).toBe("healthy");
    expect((await db.select().from(operationsSources))[0]?.highestSequence).toBe(3);
    expect(await db.select().from(operationsIncidents)).toHaveLength(0);
  });
});

it("keeps failed/recovered incident revisions deduplicated across repeat samples and recovery", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    for (const [sequence, state] of [
      [1, "failed"],
      [2, "failed"],
      [3, "healthy"],
      [4, "healthy"],
    ] as const) {
      expect((await record(db, binding, frame(binding, sequence, [component(state)]))).ok).toBe(
        true,
      );
    }
    const incidents = await db.select().from(operationsIncidents);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.recoveredAt).not.toBeNull();
    expect(incidents[0]?.revision).toBe(2);
    expect((await db.select().from(operationsTransitions)).map((row) => row.kind).sort()).toEqual([
      "opened",
      "recovered",
    ]);
    expect((await reconcileOperationsIncidents(db, signal())).transitions).toEqual([]);
  });
});

it("persists stale incident state without turning a failed observer into a failed component", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const first = frame(binding, 1, [
      component("healthy"),
      { kind: "observer", observer: "host_collector", state: "failed", reason: "check_failed" },
    ]);
    expect((await record(db, binding, first)).ok).toBe(true);
    expect((await db.select().from(operationsIncidents)).map((row) => row.observationKey)).toEqual([
      "observer:host_collector",
    ]);
    const old = new Date(Date.now() - 10 * 60_000);
    await db
      .update(operationsCurrent)
      .set({ batchObservedAt: old, orderingAt: old, receivedAt: old })
      .where(eq(operationsCurrent.observationKey, "component:web"));
    expect((await reconcileOperationsIncidents(db, signal())).transitions).toHaveLength(1);
    expect((await reconcileOperationsIncidents(db, signal())).transitions).toHaveLength(0);
    const [row] = await db
      .select()
      .from(operationsCurrent)
      .where(eq(operationsCurrent.observationKey, "component:web"));
    const [source] = await db.select().from(operationsSources);
    if (!row || !source) throw new Error("Missing fixture current state");
    expect(projectOperationsCurrent(row, source, new Date()).state).toBe("stale");
    expect(row.observation.state).toBe("healthy");
    const healthy = await record(db, binding, frame(binding, 2, [component("healthy")]));
    expect(healthy.ok && healthy.value.transitions.length).toBe(1);
  });
});

it("rejects retired generation and forged installation/source scope after server-only generation replacement", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    expect((await record(db, binding, frame(binding, 1))).ok).toBe(true);
    const next = await rotateOperationsSource(db, binding, signal());
    if (!next) throw new Error("Expected replacement generation");
    expect(next.generationId).not.toBe(binding.generationId);
    expect(await record(db, binding, frame(binding, 2))).toEqual({
      ok: false,
      error: "generation_retired",
    });
    expect(await record(db, { ...next, installationId: randomUUID() }, frame(next, 1))).toEqual({
      ok: false,
      error: "source_unavailable",
    });
    expect(await record(db, { ...next, sourceId: randomUUID() }, frame(next, 1))).toEqual({
      ok: false,
      error: "source_unavailable",
    });
    const [current] = await db.select().from(operationsCurrent);
    const [source] = await db.select().from(operationsSources);
    if (!current || !source) throw new Error("Missing fixture current state");
    expect(projectOperationsCurrent(current, source, new Date()).state).toBe("unknown");
    expect((await record(db, next, frame(next, 1, [component("healthy")]))).ok).toBe(true);
    expect((await db.select().from(operationsSources))[0]?.receiptOrdinal).toBe(2);
  });
});

it("retains source high-water and current provenance after concurrent expiry purge/replay", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const batch = frame(binding, 1);
    expect((await record(db, binding, batch)).ok).toBe(true);
    const [before] = await db.select().from(operationsCurrent);
    await db
      .update(operationsReceipts)
      .set({ receivedAt: new Date(Date.now() - OPERATIONS_RECEIPT_RETENTION_MS - 1000) });
    const [purge, replay] = await Promise.all([
      pruneOperationsHistory(db, signal()),
      record(db, binding, batch),
    ]);
    expect(purge.pressured).toBe(false);
    expect(replay).toEqual({ ok: false, error: "expired_or_out_of_order" });
    expect(await db.select().from(operationsReceipts)).toHaveLength(0);
    const [after] = await db.select().from(operationsCurrent);
    expect(after).toEqual(before);
    expect((await db.select().from(operationsSources))[0]?.highestSequence).toBe(1);
    expect(await db.select().from(operationsTransitions)).toHaveLength(1);
  });
});

it("keeps exactly the bounded receipt window and one heartbeat slot despite changing process generations", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const at = Date.now();
    let latest: OperationsBatch | undefined;
    for (let sequence = 1; sequence <= OPERATIONS_RECEIPT_LIMIT + 1; sequence++) {
      latest = frame(
        binding,
        sequence,
        [
          {
            kind: "heartbeat",
            component: "worker",
            processGeneration: randomUUID(),
            state: "healthy",
            reason: "ok",
            uptimeMs: sequence,
            activeCallbacks: 0,
          },
        ],
        at,
      );
      expect((await record(db, binding, latest)).ok).toBe(true);
    }
    const receipts = await db.select().from(operationsReceipts);
    expect(receipts).toHaveLength(OPERATIONS_RECEIPT_LIMIT);
    expect(Math.min(...receipts.map((row) => row.sequence))).toBe(2);
    expect(await db.select().from(operationsCurrent)).toHaveLength(1);
    if (!latest) throw new Error("Missing fixture latest batch");
    expect((await record(db, binding, latest)).ok).toBe(true);
    expect(await record(db, binding, { ...latest, sequence: 1 })).toEqual({
      ok: false,
      error: "expired_or_out_of_order",
    });
    const measured = await sampleOperationsStorage(db, signal());
    expect(measured.counts?.receipts).toBe(OPERATIONS_RECEIPT_LIMIT);
    expect(measured.logicalPolicy.retainedPayloadBytesUpperBound).toBe(256 * 1024 * 1024);
    expect(measured.relations).toHaveLength(6);
    expect(
      measured.relations.every(
        (row) => row.totalBytes >= row.tableBytes && row.totalBytes >= row.indexBytes,
      ),
    ).toBe(true);
    console.warn(JSON.stringify({ fixture: "operations-receipt-window-storage", measured }));
  });
});

it("rolls receipt, high-water and projection back together when real projection SQL fails", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    await db.execute(
      sql`CREATE FUNCTION operations_fixture_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture projection rejection'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER operations_fixture_reject BEFORE INSERT ON operations_current FOR EACH ROW EXECUTE FUNCTION operations_fixture_reject()`,
    );
    await expect(record(db, binding, frame(binding, 1))).rejects.toBeDefined();
    expect(await db.select().from(operationsReceipts)).toHaveLength(0);
    expect(await db.select().from(operationsCurrent)).toHaveLength(0);
    const [source] = await db.select().from(operationsSources);
    expect(source?.highestSequence).toBe(0);
    expect(source?.receiptOrdinal).toBe(0);
  });
});

it("keeps component facts outside application sampler scope and preserves unsampled queue age as null", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "application_sampler", signal());
    expect(await record(db, binding, frame(binding, 1))).toEqual({
      ok: false,
      error: "source_scope_denied",
    });
    const queue: OperationsObservation = {
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
    expect((await record(db, binding, frame(binding, 1, [queue]))).ok).toBe(true);
    const [current] = await db.select().from(operationsCurrent);
    const [source] = await db.select().from(operationsSources);
    if (!current || !source) throw new Error("Missing fixture current state");
    const projected = projectOperationsCurrent(current, source, new Date());
    expect(projected.freshness.ageMs).toBeNull();
    expect(projected.state).toBe("unchecked");
    expect(projected.reason).toBe("not_observed");
  });
});

it("holds over-budget history as unknown and automatically recovers through bounded cleanup passes", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const at = Date.now();
    expect((await record(db, binding, frame(binding, 1, [component("healthy")], at))).ok).toBe(
      true,
    );
    const rows = Array.from({ length: 1300 }, (_, index) => {
      const sequence = index + 2;
      const payload = frame(binding, sequence, [component("healthy")], at);
      return {
        sourceId: binding.sourceId,
        generationId: binding.generationId,
        sequence,
        ordinal: sequence,
        payload,
        payloadSha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        observedAt: new Date(at),
        receivedAt: new Date(at),
        observationCount: 1,
      };
    });
    await db.insert(operationsReceipts).values(rows);
    await db
      .update(operationsSources)
      .set({ highestSequence: 1301, receiptOrdinal: 1301 })
      .where(eq(operationsSources.id, binding.sourceId));
    const latest = frame(binding, 1302, [component("healthy")], at);
    expect(await record(db, binding, latest)).toEqual({ ok: false, error: "storage_pressure" });
    expect(await db.select().from(operationsReceipts)).toHaveLength(301);
    const [held] = await db.select().from(operationsSources);
    const [current] = await db.select().from(operationsCurrent);
    if (!held || !current) throw new Error("Missing fixture current state");
    expect(held.highestSequence).toBe(1301);
    expect(projectOperationsCurrent(current, held, new Date()).state).toBe("unknown");
    expect(projectOperationsCurrent(current, held, new Date()).reason).toBe("storage_pressure");
    const recovered = await record(db, binding, latest);
    expect(recovered.ok && recovered.value.admissionState).toBe("ready");
    expect(await db.select().from(operationsReceipts)).toHaveLength(OPERATIONS_RECEIPT_LIMIT);
    expect((await db.select().from(operationsCurrent))[0]?.sequence).toBe(1302);
  });
});

it("retains open incident revision dedup after transition-window and receipt deletion", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const at = Date.now();
    let latest: OperationsBatch | undefined;
    for (let sequence = 1; sequence <= 69; sequence++) {
      const observation = component();
      latest = frame(
        binding,
        sequence,
        [sequence % 2 ? observation : { ...observation, state: "degraded", reason: "limited" }],
        at,
      );
      expect((await record(db, binding, latest)).ok).toBe(true);
    }
    expect(await db.select().from(operationsTransitions)).toHaveLength(64);
    const [incident] = await db.select().from(operationsIncidents);
    expect(incident?.revision).toBe(69);
    await db
      .update(operationsReceipts)
      .set({ receivedAt: new Date(Date.now() - OPERATIONS_RECEIPT_RETENTION_MS - 1000) });
    await pruneOperationsHistory(db, signal());
    if (!latest) throw new Error("Missing fixture latest batch");
    expect(await record(db, binding, latest)).toEqual({
      ok: false,
      error: "expired_or_out_of_order",
    });
    const unchanged = await record(db, binding, frame(binding, 70, [component()], at));
    expect(unchanged.ok && unchanged.value.transitions).toEqual([]);
    expect((await db.select().from(operationsIncidents))[0]?.revision).toBe(69);
    expect(await db.select().from(operationsTransitions)).toHaveLength(64);
  });
});

it("prunes closed incident history while retaining current open incident and transition identity", async () => {
  await withTestDb(async (db) => {
    const binding = await enrollOperationsSource(db, "host_collector", signal());
    const batch = frame(binding, 1);
    expect((await record(db, binding, batch)).ok).toBe(true);
    const [open] = await db.select().from(operationsIncidents);
    const old = new Date(Date.now() - 1000);
    const closed = await db
      .insert(operationsIncidents)
      .values(
        Array.from({ length: 257 }, () => ({
          sourceId: binding.sourceId,
          observationKey: "component:web",
          state: "failed" as const,
          reason: "unavailable",
          fingerprint: "a".repeat(64),
          revision: 2,
          openedAt: old,
          updatedAt: old,
          recoveredAt: old,
        })),
      )
      .returning({ id: operationsIncidents.id });
    await db.insert(operationsTransitions).values(
      closed.flatMap((row) => [
        {
          incidentId: row.id,
          revision: 1,
          kind: "opened" as const,
          state: "failed",
          reason: "unavailable",
          recordedAt: old,
        },
        {
          incidentId: row.id,
          revision: 2,
          kind: "recovered" as const,
          state: "healthy",
          reason: "ok",
          recordedAt: old,
        },
      ]),
    );
    const pruned = await pruneOperationsHistory(db, signal());
    expect(pruned.deletedIncidents).toBe(1);
    expect(await db.select().from(operationsIncidents)).toHaveLength(257);
    expect(
      (await db.select().from(operationsIncidents).where(eq(operationsIncidents.id, open!.id)))[0]
        ?.recoveredAt,
    ).toBeNull();
    expect((await record(db, binding, batch)).ok).toBe(true);
    expect(
      await db
        .select()
        .from(operationsTransitions)
        .where(eq(operationsTransitions.incidentId, open!.id)),
    ).toHaveLength(1);
  });
});
