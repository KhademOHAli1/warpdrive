import type { QueueResult } from "pg-boss";
import { describe, expect, it } from "vitest";
import {
  isManifestQueue,
  QUEUE_NAMES,
  QUEUE_OPTIONS,
  queueMatchesManifest,
  queueOptionsMatchManifest,
} from "./queueManifest";

const existing = (name: string) =>
  ({
    name,
    ...QUEUE_OPTIONS,
    table: "job_common",
    retryDelayMax: null,
    heartbeatSeconds: null,
    deadLetter: null,
  }) as unknown as QueueResult;

describe("finite queue manifest", () => {
  it("contains the 22 shared application queues and the vendor scheduler queue exactly once", () => {
    expect(QUEUE_NAMES).toHaveLength(23);
    expect(new Set(QUEUE_NAMES).size).toBe(23);
    for (const name of QUEUE_NAMES) expect(queueMatchesManifest(existing(name))).toBe(true);
    expect(QUEUE_NAMES).toContain("release.check");
    expect(QUEUE_NAMES).toContain("__pgboss__send-it");
    expect(isManifestQueue("workspace-123.email.sync")).toBe(false);
  });

  it.each([
    ["policy", "singleton"],
    ["partition", true],
    ["table", "custom_partition"],
    ["retryLimit", 3],
    ["retryDelay", 1],
    ["retryBackoff", true],
    ["retryDelayMax", 100],
    ["expireInSeconds", 60],
    ["retentionSeconds", 60],
    ["deleteAfterSeconds", 60],
    ["warningQueueSize", 1],
    ["deadLetter", "unexpected"],
    ["heartbeatSeconds", 10],
    ["notify", true],
  ])("rejects persisted drift in %s rather than silently reconciling it", (field, value) => {
    expect(queueMatchesManifest({ ...existing("email.sync"), [field]: value })).toBe(false);
  });

  it("accepts only default-equivalent runtime declarations", () => {
    expect(queueOptionsMatchManifest()).toBe(true);
    expect(queueOptionsMatchManifest(QUEUE_OPTIONS)).toBe(true);
    expect(queueOptionsMatchManifest({ retryLimit: 8 })).toBe(false);
    expect(queueOptionsMatchManifest({ partition: true })).toBe(false);
    expect(queueMatchesManifest(null)).toBe(false);
    expect(queueMatchesManifest(existing("undeclared"))).toBe(false);
  });
});
