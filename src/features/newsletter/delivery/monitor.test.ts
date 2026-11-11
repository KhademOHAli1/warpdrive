import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { checkNewsletterDelivery, createNewsletterReadinessMonitor } from "./monitor";
import type { EngineReadiness } from "./readiness";

const engine = vi.hoisted(() => ({
  env: { NEWSLETTER_DELIVERY_ENABLED: true },
  configured: vi.fn(() => true),
  createClient: vi.fn(() => ({})),
  read: vi.fn(),
  drain: vi.fn(),
  health: vi.fn(),
}));
vi.mock("@/config/env", () => ({ env: engine.env }));
vi.mock("../listmonkClient", () => ({
  createListmonkClient: engine.createClient,
  newsletterConfigured: engine.configured,
}));
vi.mock("./readiness", () => ({ readEngineReadiness: engine.read }));
vi.mock("./operationalSync", () => ({ drainOperationalEvents: engine.drain }));
vi.mock("./operationalRepository", () => ({
  recordOperationalHealth: engine.health,
  recordOperationalPoll: vi.fn(),
  persistOperationalEvents: vi.fn(),
}));
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
const outage: EngineReadiness = {
  ...ready,
  ready: false,
  relay: { status: "unavailable", checkedAt: null },
};
const sig = () => new AbortController().signal;
beforeEach(() => {
  vi.clearAllMocks();
  engine.env.NEWSLETTER_DELIVERY_ENABLED = true;
  engine.configured.mockReturnValue(true);
  engine.drain.mockResolvedValue(undefined);
  engine.read.mockResolvedValue(ready);
  engine.health.mockResolvedValue({ changed: false, level: "info" });
});
it("retries a failed asynchronous outage write before reading and persisting recovery", async () => {
  const read = vi.fn().mockResolvedValueOnce(outage).mockResolvedValueOnce(ready);
  const report = vi
    .fn()
    .mockRejectedValueOnce(new Error("DB unavailable"))
    .mockResolvedValue(undefined);
  const monitor = createNewsletterReadinessMonitor(read, report);
  await expect(monitor(sig())).rejects.toThrow("DB unavailable");
  expect(read).toHaveBeenCalledTimes(1);
  await monitor(sig());
  expect(report.mock.calls.map(([state]) => state)).toEqual([
    "ready/ready/unavailable/ready/disabled",
    "ready/ready/unavailable/ready/disabled",
    "ready",
  ]);
});
it("serializes concurrent probes and emits one transition", async () => {
  const read = vi.fn().mockResolvedValue(outage);
  const report = vi.fn().mockResolvedValue(undefined);
  const monitor = createNewsletterReadinessMonitor(read, report);
  await Promise.all([monitor(sig()), monitor(sig()), monitor(sig())]);
  expect(read).toHaveBeenCalledTimes(3);
  expect(report).toHaveBeenCalledTimes(1);
});
it("submits initial readiness to durable storage after restart, with fresh signals", async () => {
  const read = vi.fn().mockResolvedValue(ready);
  const report = vi.fn();
  const monitor = createNewsletterReadinessMonitor(read, report, {
    reportInitial: true,
    reportUnchanged: true,
  });
  const first = sig();
  const next = sig();
  await monitor(first);
  await monitor(next);
  expect(report.mock.calls).toEqual([
    ["ready", "info", first],
    ["ready", "info", next],
  ]);
});
it("polls late operational facts while intentionally paused without probing sender readiness", async () => {
  engine.env.NEWSLETTER_DELIVERY_ENABLED = false;
  await checkNewsletterDelivery({} as Db, sig());
  expect(engine.drain).toHaveBeenCalledTimes(1);
  expect(engine.read).not.toHaveBeenCalled();
  expect(engine.health).toHaveBeenCalledWith(
    expect.anything(),
    { fingerprint: "paused", reason: null },
    expect.anything(),
  );
});
it("does not access an unconfigured engine", async () => {
  engine.configured.mockReturnValue(false);
  await checkNewsletterDelivery({} as Db, sig());
  expect(engine.createClient).not.toHaveBeenCalled();
  expect(engine.health).not.toHaveBeenCalled();
});
it("persists a fixed safe diagnostic when the native event feed fails", async () => {
  engine.drain.mockRejectedValue(new Error("private provider response"));
  await checkNewsletterDelivery({} as Db, sig());
  expect(engine.health).toHaveBeenCalledWith(
    expect.anything(),
    { fingerprint: "events_unavailable", reason: "events_unavailable" },
    expect.anything(),
  );
  expect(engine.read).not.toHaveBeenCalled();
});
