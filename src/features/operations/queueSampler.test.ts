import { expect, it, vi } from "vitest";
import { operationsQueues } from "./contracts";
import { type OperationsQueueCacheRow, sampleOperationsQueues } from "./queueSampler";

const old = new Date("2026-11-13T11:00:00Z");
const row: OperationsQueueCacheRow = {
  name: "file.reaper",
  sampled_at: old,
  pending_count: 2,
  active_count: 1,
  ready_oldest_seconds: 350,
  last_progress_at: null,
  ready_count: 1,
  sampled_age_ms: 400_000,
};

it("reads one bounded queue cache query and preserves the original observation time", async () => {
  const query = vi.fn(() => Promise.resolve({ rows: [row] }));
  const result = await sampleOperationsQueues({ query }, new AbortController().signal);
  expect(query).toHaveBeenCalledExactlyOnceWith({
    text: expect.stringMatching(/FROM pgboss\.queue\s+WHERE name = ANY/u),
    values: [operationsQueues],
    query_timeout: 2000,
  });
  expect(result).toHaveLength(operationsQueues.length);
  expect(result).toContainEqual({
    kind: "queue",
    queue: "file.reaper",
    state: "degraded",
    reason: "queue_backlog",
    sampledAtMs: old.getTime(),
    pendingCount: 2,
    activeCount: 1,
    readyOldestAgeMs: 350_000,
    lastProgressAtMs: null,
  });
  expect(result).toContainEqual(
    expect.objectContaining({
      state: "unknown",
      reason: "not_reported",
      sampledAtMs: null,
      pendingCount: null,
    }),
  );
});

it("keeps missing, invalid and future cache rows unknown", async () => {
  for (const candidate of [
    { ...row, sampled_at: null },
    { ...row, ready_oldest_seconds: -1 },
    { ...row, sampled_age_ms: -31_000 },
  ]) {
    const query = () => Promise.resolve({ rows: [candidate] });
    const result = await sampleOperationsQueues({ query }, new AbortController().signal);
    expect(result.find((item) => item.kind === "queue" && item.queue === row.name)).toMatchObject({
      state: "unknown",
      sampledAtMs: null,
      readyOldestAgeMs: null,
    });
  }
  const query = vi.fn();
  await expect(sampleOperationsQueues({ query }, AbortSignal.abort())).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
