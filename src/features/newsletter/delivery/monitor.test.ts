import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkNewsletterDelivery } from "./monitor";
import type { EngineReadiness } from "./readiness";

const engine = vi.hoisted(() => ({
  env: { NEWSLETTER_DELIVERY_ENABLED: true },
  configured: vi.fn(() => true),
  createClient: vi.fn(() => ({})),
  read: vi.fn<() => Promise<EngineReadiness>>(),
}));

vi.mock("@/config/env", () => ({ env: engine.env }));
vi.mock("../listmonkClient", () => ({
  createListmonkClient: engine.createClient,
  newsletterConfigured: engine.configured,
}));
vi.mock("./readiness", () => ({ readEngineReadiness: engine.read }));

beforeEach(() => {
  engine.env.NEWSLETTER_DELIVERY_ENABLED = true;
  engine.configured.mockReturnValue(true);
  engine.createClient.mockClear();
  engine.read.mockReset();
});
afterEach(() => vi.restoreAllMocks());

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

it("emits collector-readable JSON lines once per outage and recovery transition", async () => {
  const outage: EngineReadiness = {
    ...ready,
    ready: false,
    relay: { ...ready.relay, status: "unavailable" },
  };
  engine.read
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce(outage)
    .mockResolvedValueOnce(outage)
    .mockRejectedValueOnce(new Error("Synthetic engine outage"))
    .mockResolvedValueOnce(ready);
  const warnings = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const recovery = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const signal = AbortSignal.timeout(5_000);
  for (let index = 0; index < 5; index += 1) await checkNewsletterDelivery(signal);
  const warningChunks = warnings.mock.calls.map(([chunk]) => String(chunk));
  const recoveryChunks = recovery.mock.calls.map(([chunk]) => String(chunk));
  for (const chunk of [...warningChunks, ...recoveryChunks]) {
    expect(chunk.endsWith("\n")).toBe(true);
    expect(chunk.split("\n")).toHaveLength(2);
  }
  expect(warningChunks.map((chunk) => JSON.parse(chunk))).toEqual([
    {
      event: "newsletter.delivery.readiness",
      level: "warn",
      readiness: "ready/ready/unavailable/ready/disabled",
    },
    { event: "newsletter.delivery.readiness", level: "warn", readiness: "unreachable" },
  ]);
  expect(recoveryChunks.map((chunk) => JSON.parse(chunk))).toEqual([
    { event: "newsletter.delivery.readiness", level: "info", readiness: "ready" },
  ]);
});

it.each([
  { deliveryEnabled: false, configured: true },
  { deliveryEnabled: true, configured: false },
])(
  "skips engine access and logs when delivery or configuration is absent ($deliveryEnabled, $configured)",
  async ({ deliveryEnabled, configured }) => {
    engine.env.NEWSLETTER_DELIVERY_ENABLED = deliveryEnabled;
    engine.configured.mockReturnValue(configured);
    const warnings = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const recovery = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await checkNewsletterDelivery(AbortSignal.timeout(5_000));
    expect(engine.createClient).not.toHaveBeenCalled();
    expect(engine.read).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
  },
);
