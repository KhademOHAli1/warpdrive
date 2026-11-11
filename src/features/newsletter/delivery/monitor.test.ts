import { expect, it, vi } from "vitest";
import { createNewsletterReadinessMonitor } from "./monitor";
import type { EngineReadiness } from "./readiness";

const ready: EngineReadiness = {
  ready: true,
  database: { status: "ready" },
  scheduler: { status: "ready", lastScanAt: null },
  relay: { status: "ready", checkedAt: null },
  media: { status: "ready", checkedAt: null },
  limits: {
    workers: 1,
    perWorkerMessagesPerSecond: 2,
    messagesPerSecond: 2,
    batchSize: 20,
    queueCapacity: 4,
    clamped: false,
  },
  feedback: { status: "disabled", lastEventAt: null },
};

it("logs an outage and recovery once per observed readiness transition", async () => {
  const outage: EngineReadiness = {
    ...ready,
    ready: false,
    relay: { ...ready.relay, status: "unavailable" },
  };
  const read = vi
    .fn<() => Promise<EngineReadiness>>()
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce(outage)
    .mockResolvedValueOnce(outage)
    .mockRejectedValueOnce(new Error("Synthetic engine outage"))
    .mockResolvedValueOnce(ready);
  const report = vi.fn();
  const check = createNewsletterReadinessMonitor(read, report);
  const signal = AbortSignal.timeout(5_000);
  for (let index = 0; index < 5; index += 1) await check(signal);
  expect(report.mock.calls).toEqual([
    ["ready/ready/unavailable/ready/disabled", "warn"],
    ["unreachable", "warn"],
    ["ready", "info"],
  ]);
});
