import { describe, expect, it } from "vitest";
import { newsletterObservations } from "./newsletterSampler";

const now = new Date("2026-11-13T12:00:00Z");
const poll = new Date(now.getTime() - 2_000);
const checked = new Date(now.getTime() - 1_000);
const row = { fingerprint: "ready", checkedAt: checked, lastPolledAt: poll, now };

describe("newsletter operations evidence", () => {
  it("keeps seed and missing rows from granting provider health", () => {
    expect(newsletterObservations(undefined).map(({ state }) => state)).toEqual([
      "unknown",
      "unknown",
    ]);
    expect(newsletterObservations({ ...row, checkedAt: poll })).toMatchObject([
      { state: "healthy", sampledAtMs: poll.getTime() },
      { state: "unknown" },
    ]);
  });

  it("uses each underlying observation timestamp", () => {
    expect(newsletterObservations(row)).toMatchObject([
      { feature: "newsletter_event_sync", state: "healthy", sampledAtMs: poll.getTime() },
      { provider: "newsletter_delivery", state: "healthy", sampledAtMs: checked.getTime() },
    ]);
    expect(
      newsletterObservations({ ...row, now: new Date(now.getTime() + 180_000) }).map(
        ({ state }) => state,
      ),
    ).toEqual(["unknown", "unknown"]);
  });

  it("distinguishes a paused sender, explicit relay failure and a failed event poll", () => {
    expect(newsletterObservations({ ...row, fingerprint: "paused" })[1]).toMatchObject({
      state: "unchecked",
      reason: "not_checked",
    });
    expect(
      newsletterObservations({ ...row, fingerprint: "ready/ready/unavailable/ready/confirmed" })[1],
    ).toMatchObject({ state: "failed", reason: "unavailable" });
    expect(newsletterObservations({ ...row, fingerprint: "events_unavailable" })).toMatchObject([
      { state: "failed", reason: "check_failed" },
      { state: "unknown" },
    ]);
    expect(
      newsletterObservations({
        ...row,
        fingerprint: "unavailable/starting/unavailable/unchecked/disabled",
      })[1],
    ).toMatchObject({ state: "unknown" });
  });
});
