import { expect, it, vi } from "vitest";
import type { ListmonkClient } from "../listmonkClient";
import {
  type OperationalEvent,
  operationalEventSchema,
  operationalNoticeSchema,
} from "./operationalContracts";
import { drainOperationalEvents } from "./operationalSync";

const event: OperationalEvent = {
  id: "6e539cb9-6c8c-4ce6-912f-b78bdaae11bf",
  kind: "delivery.uncertain",
  reason: "submission_unknown",
  count: 1,
  occurred_at: "2026-11-11T12:00:00.123456Z",
};
function fixture() {
  const json = vi
    .fn()
    .mockResolvedValueOnce({ events: [event], pending: false })
    .mockResolvedValue({ acknowledged: 1 });
  const hasOperationalContract = vi.fn().mockResolvedValue(true);
  return {
    json,
    hasOperationalContract,
    client: { json, hasOperationalContract } as unknown as Pick<
      ListmonkClient,
      "json" | "hasOperationalContract"
    >,
  };
}
const sig = () => new AbortController().signal;
it("requires the exact new capability before reading or consuming", async () => {
  const f = fixture();
  f.hasOperationalContract.mockResolvedValue(false);
  const consume = vi.fn();
  await expect(drainOperationalEvents(f.client, consume, sig())).rejects.toThrow(
    "contract unavailable",
  );
  expect(f.json).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
});
it("ACKs opaque IDs only after the durable consumer commits", async () => {
  const f = fixture();
  let release!: () => void;
  const committed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const consume = vi.fn(() => committed);
  const running = drainOperationalEvents(f.client, consume, sig());
  await vi.waitFor(() => expect(consume).toHaveBeenCalled());
  expect(f.json).toHaveBeenCalledTimes(1);
  release();
  await running;
  expect(f.json.mock.calls[1]).toEqual([
    "POST",
    "/api/warpdrive/operational-events/ack",
    { body: { event_ids: [event.id] } },
  ]);
});
it("does not ACK when persistence fails", async () => {
  const f = fixture();
  await expect(
    drainOperationalEvents(f.client, () => Promise.reject(new Error("rollback")), sig()),
  ).rejects.toThrow("rollback");
  expect(f.json).toHaveBeenCalledTimes(1);
});
it("replays unchanged native identity after a lost ACK", async () => {
  const f = fixture();
  f.json
    .mockReset()
    .mockResolvedValueOnce({ events: [event], pending: false })
    .mockRejectedValueOnce(new Error("ACK lost"))
    .mockResolvedValueOnce({ events: [event], pending: false })
    .mockResolvedValueOnce({ acknowledged: 1 });
  const consume = vi.fn().mockResolvedValue(undefined);
  await expect(drainOperationalEvents(f.client, consume, sig())).rejects.toThrow("ACK lost");
  await drainOperationalEvents(f.client, consume, sig());
  expect(consume.mock.calls).toEqual([[[event]], [[event]]]);
});
it.each([
  { ...event, email: "private@example.test" },
  { ...event, kind: "feedback.bounce" },
  { ...event, count: 2 },
  { ...event, id: event.id.toUpperCase() },
  { ...event, reason: "raw-provider-error" },
])("rejects unsafe or inconsistent native envelopes", async (invalid) => {
  const f = fixture();
  f.json.mockReset().mockResolvedValue({ events: [invalid], pending: false });
  const consume = vi.fn();
  await expect(drainOperationalEvents(f.client, consume, sig())).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled();
  expect(f.json).toHaveBeenCalledTimes(1);
});
it("rejects duplicate UUIDs and partial ACKs", async () => {
  const f = fixture();
  f.json.mockReset().mockResolvedValueOnce({ events: [event, event], pending: false });
  await expect(drainOperationalEvents(f.client, vi.fn(), sig())).rejects.toThrow();
  const g = fixture();
  g.json
    .mockReset()
    .mockResolvedValueOnce({ events: [event], pending: false })
    .mockResolvedValueOnce({ acknowledged: 0 });
  await expect(drainOperationalEvents(g.client, vi.fn(), sig())).rejects.toThrow("acknowledgement");
});
it("bounds each poll to three batches and accepts terminal rejection resolution", async () => {
  const f = fixture();
  f.json
    .mockReset()
    .mockImplementation((method) =>
      Promise.resolve(method === "GET" ? { events: [event], pending: true } : { acknowledged: 1 }),
    );
  const consume = vi.fn();
  await drainOperationalEvents(f.client, consume, sig());
  expect(consume).toHaveBeenCalledTimes(3);
  expect(
    operationalEventSchema.safeParse({
      ...event,
      kind: "delivery.resolved",
      reason: "delivery_rejected",
    }).success,
  ).toBe(true);
  expect(
    operationalNoticeSchema.safeParse({ category: "readiness", reason: "hard_bounce", count: 1 })
      .success,
  ).toBe(false);
});
