import { expect, it, vi } from "vitest";
import { OPERATIONS_WORKER_INSTANCE_NAME, sampleWorkerHeartbeat } from "./workerHeartbeat";

const processGeneration = "0ef58494-f52a-49b6-b5d6-0fb5e3aad25c";
const started = new Date("2026-11-13T11:00:00.000Z");
const beat = new Date("2026-11-13T11:01:00.123Z");
const fresh = {
  capped: false,
  live_count: 1,
  process_generation: processGeneration,
  started_at: started,
  sampled_at: beat,
};
const unknown = {
  kind: "heartbeat",
  component: "worker",
  state: "unknown",
  processGeneration: null,
  uptimeMs: null,
  activeCallbacks: null,
};
const signal = () => new AbortController().signal;

it("reads one bounded registry sample and reports the original Worker beat", async () => {
  const query = vi.fn(() => Promise.resolve({ rows: [fresh] }));
  expect(await sampleWorkerHeartbeat({ query }, signal())).toEqual({
    kind: "heartbeat",
    component: "worker",
    state: "healthy",
    reason: "ok",
    processGeneration,
    sampledAtMs: beat.getTime(),
    uptimeMs: beat.getTime() - started.getTime(),
    activeCallbacks: null,
  });
  expect(query).toHaveBeenCalledExactlyOnceWith({
    text: expect.stringMatching(
      /MATERIALIZED[\s\S]+FROM pgboss\.instance\s+LIMIT \(\$3::int \+ 1\)/u,
    ),
    values: [OPERATIONS_WORKER_INSTANCE_NAME, "12.38.2", 1024, 3, 30],
    query_timeout: 2000,
  });
});

it("does not report a process or timestamp when no eligible live row remains", async () => {
  const query = () => Promise.resolve({ rows: [{ ...fresh, live_count: 0 }] });
  expect(await sampleWorkerHeartbeat({ query }, signal())).toEqual({
    ...unknown,
    reason: "not_reported",
  });
});

it("rejects ambiguous, capped and malformed registry facts", async () => {
  for (const rows of [
    [],
    [fresh, fresh],
    [{ ...fresh, live_count: 2 }],
    [{ ...fresh, capped: true }],
    [{ ...fresh, process_generation: "unreviewed-value" }],
    [{ ...fresh, process_generation: null }],
    [{ ...fresh, sampled_at: null }],
    [{ ...fresh, sampled_at: started, started_at: beat }],
  ]) {
    expect(
      await sampleWorkerHeartbeat({ query: () => Promise.resolve({ rows }) }, signal()),
    ).toEqual({
      ...unknown,
      reason: "sample_failed",
    });
  }
});

it("propagates query and abort errors for the collector to hold the tick", async () => {
  const failure = new Error("Synthetic registry query failure");
  const query = vi.fn(() => Promise.reject(failure));
  await expect(sampleWorkerHeartbeat({ query }, AbortSignal.abort())).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  await expect(sampleWorkerHeartbeat({ query }, signal())).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(
    sampleWorkerHeartbeat(
      {
        query: () => {
          controller.abort();
          return Promise.resolve({ rows: [fresh] });
        },
      },
      controller.signal,
    ),
  ).rejects.toThrow();
});
