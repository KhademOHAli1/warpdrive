import { describe, expect, test } from "vitest";
import { createPrivacyDeadline, extendPrivacyDeadline, type PrivacyDeadline } from "./deadlines";

const policy = {
  id: "synthetic-eu-profile",
  version: 1,
  activated: true,
  jurisdiction: "synthetic-reviewed-profile",
  timeZone: "Europe/Berlin",
  calendar: "gregory",
  responseMonths: 1,
  maxExtensionMonths: 2,
  disambiguation: "reject",
};

function initial(): PrivacyDeadline {
  const result = createPrivacyDeadline("2026-01-31T15:00:00Z", policy);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new TypeError("deadline fixture rejected");
  return result.value;
}

describe("P05A explicit policy calendar-month deadlines", () => {
  test.each([
    ["2026-01-31T15:00:00Z", "2026-02-28T15:00:00.000Z"],
    ["2024-01-31T15:00:00Z", "2024-02-29T15:00:00.000Z"],
    ["2026-03-15T12:00:00Z", "2026-04-15T11:00:00.000Z"],
    ["2026-10-15T12:00:00Z", "2026-11-15T13:00:00.000Z"],
  ])("calculates %s as %s without fixed day arithmetic", (receivedAt, dueAt) => {
    expect(createPrivacyDeadline(receivedAt, policy)).toMatchObject({
      ok: true,
      value: { receivedAt: new Date(receivedAt).toISOString(), originalDueAt: dueAt, dueAt },
    });
  });

  test("uses the explicit policy zone, with no display locale or calendar input", () => {
    const receivedAt = "2026-03-31T08:00:00Z";
    const result = createPrivacyDeadline(receivedAt, { ...policy, timeZone: "Asia/Tehran" });
    expect(result).toMatchObject({
      ok: true,
      value: { dueAt: "2026-04-30T08:00:00.000Z", policy: { calendar: "gregory" } },
    });
    expect(createPrivacyDeadline(receivedAt, { ...policy, calendar: "persian" }).ok).toBe(false);
  });

  test("preserves submillisecond receipt precision instead of shifting the recorded receipt", () => {
    expect(createPrivacyDeadline("2026-01-31T15:00:00.123456Z", policy)).toMatchObject({
      ok: true,
      value: {
        receivedAt: "2026-01-31T15:00:00.123456Z",
        dueAt: "2026-02-28T15:00:00.123456Z",
      },
    });
  });

  test.each([
    ["2024-01-31T01:30:00Z", 2],
    ["2024-09-27T00:30:00Z", 1],
  ])("requires an explicit resolution of DST gaps/folds at %s", (receivedAt, responseMonths) => {
    expect(createPrivacyDeadline(receivedAt, { ...policy, responseMonths })).toEqual({
      ok: false,
      error: "deadline_unresolvable",
    });
  });

  test.each([
    ["2024-01-31T01:30:00Z", 2, "earlier", "2024-03-31T00:30:00.000Z"],
    ["2024-01-31T01:30:00Z", 2, "later", "2024-03-31T01:30:00.000Z"],
    ["2024-09-27T00:30:00Z", 1, "earlier", "2024-10-27T00:30:00.000Z"],
    ["2024-09-27T00:30:00Z", 1, "later", "2024-10-27T01:30:00.000Z"],
  ])(
    "records configured DST resolution %s / %s / %s",
    (receivedAt, responseMonths, disambiguation, dueAt) => {
      expect(
        createPrivacyDeadline(receivedAt, { ...policy, responseMonths, disambiguation }),
      ).toMatchObject({
        ok: true,
        value: { dueAt, policy: { disambiguation } },
      });
    },
  );
});

describe("P05B reviewed extensions preserve the original receipt", () => {
  const extension = {
    additionalMonths: 1,
    reason: "Synthetic documented complexity assessment",
    noticeReference: "synthetic-notice-1",
    noticeRecordedAt: "2026-02-20T10:00:00Z",
  };

  test("extends from receipt without month-end drift or mutating the original record", () => {
    const deadline = initial();
    const before = structuredClone(deadline);
    const result = extendPrivacyDeadline(deadline, extension);
    expect(deadline).toEqual(before);
    expect(result).toMatchObject({
      ok: true,
      value: {
        receivedAt: "2026-01-31T15:00:00.000Z",
        originalDueAt: "2026-02-28T15:00:00.000Z",
        dueAt: "2026-03-31T14:00:00.000Z",
        extensionMonths: 1,
        extensions: [{ ...extension, noticeRecordedAt: "2026-02-20T10:00:00.000Z" }],
      },
    });
  });

  test.each([
    { reason: " " },
    { noticeReference: " " },
    { noticeRecordedAt: "not-an-instant" },
    { noticeRecordedAt: "2026-01-01T10:00:00Z" },
    { noticeRecordedAt: "2026-02-28T15:00:00.001Z" },
    { additionalMonths: 0 },
    { additionalMonths: 3 },
  ])("rejects missing, late or excessive extension evidence: %j", (override) => {
    const deadline = initial();
    const before = structuredClone(deadline);
    expect(extendPrivacyDeadline(deadline, { ...extension, ...override }).ok).toBe(false);
    expect(deadline).toEqual(before);
  });

  test("bounds cumulative extensions and makes the same notice replay idempotent", () => {
    const first = extendPrivacyDeadline(initial(), extension);
    if (!first.ok) throw new TypeError("extension fixture rejected");
    expect(extendPrivacyDeadline(first.value, extension)).toEqual(first);
    expect(
      extendPrivacyDeadline(first.value, { ...extension, reason: "Changed reasoning" }).ok,
    ).toBe(false);
    const second = extendPrivacyDeadline(first.value, {
      ...extension,
      noticeReference: "synthetic-notice-2",
    });
    expect(second).toMatchObject({
      ok: true,
      value: { dueAt: "2026-04-30T14:00:00.000Z", extensionMonths: 2 },
    });
    if (!second.ok) return;
    expect(
      extendPrivacyDeadline(second.value, { ...extension, noticeReference: "synthetic-notice-3" })
        .ok,
    ).toBe(false);
  });
});

describe("unconfigured deployment choices fail closed", () => {
  test.each([
    null,
    { ...policy, activated: false },
    { ...policy, jurisdiction: "" },
    { ...policy, timeZone: "not/a-zone" },
    { ...policy, responseMonths: -1 },
    { ...policy, maxExtensionMonths: -1 },
  ])("does not invent an enabled policy from %j", (candidate) => {
    expect(createPrivacyDeadline("2026-01-31T15:00:00Z", candidate).ok).toBe(false);
  });

  test("rejects invalid receipt instants rather than setting a new receipt", () => {
    expect(createPrivacyDeadline("2026-02-30T12:00:00Z", policy)).toEqual({
      ok: false,
      error: "receipt_invalid",
    });
  });
});
