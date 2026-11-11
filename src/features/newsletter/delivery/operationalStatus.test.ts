import { expect, it } from "vitest";
import { operationalSyncSnapshot } from "./operationalStatus";

it("distinguishes absent, fresh and stopped or failed worker sync without writes", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  expect(operationalSyncSnapshot(undefined, now)).toEqual({
    status: "unchecked",
    checkedAt: null,
    lastPolledAt: null,
  });
  expect(operationalSyncSnapshot({ checkedAt: now, lastPolledAt: now }, now).status).toBe(
    "current",
  );
  const old = new Date("2026-11-11T11:54:59Z");
  expect(operationalSyncSnapshot({ checkedAt: old, lastPolledAt: now }, now).status).toBe("stale");
  expect(operationalSyncSnapshot({ checkedAt: now, lastPolledAt: old }, now).status).toBe("stale");
  expect(operationalSyncSnapshot({ checkedAt: now, lastPolledAt: null }, now).status).toBe("stale");
});
