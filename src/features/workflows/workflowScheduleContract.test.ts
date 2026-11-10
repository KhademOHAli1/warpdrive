import { assert, expect, it } from "vitest";
import {
  readWorkflowScheduleLaunch,
  type WorkflowScheduleConfig,
  workflowScheduleConfig,
  workflowScheduleExpression,
  workflowScheduleMatches,
  workflowScheduleMinute,
} from "./workflowScheduleContract";

it.each<{
  config: WorkflowScheduleConfig;
  expression: string;
  due: string[];
  missed: string;
}>([
  {
    config: { interval: "minutes", minutes: 7 },
    expression: "*/7 * * * *",
    due: ["2026-11-01T10:56:00.000Z", "2026-11-01T11:00:00.000Z"],
    missed: "2026-11-01T11:03:00.000Z",
  },
  {
    config: { interval: "hours", hours: 5, minute: 14 },
    expression: "14 */5 * * *",
    due: ["2026-11-01T20:14:00.000Z", "2026-11-02T00:14:00.000Z"],
    missed: "2026-11-02T01:14:00.000Z",
  },
  {
    config: { interval: "days", days: 4, hour: 9, minute: 8 },
    expression: "8 9 */4 * *",
    due: ["2026-10-29T09:08:00.000Z", "2026-11-01T09:08:00.000Z"],
    missed: "2026-11-02T09:08:00.000Z",
  },
  {
    config: { interval: "minutes", minutes: 60 },
    expression: "*/60 * * * *",
    due: ["2026-11-01T10:00:00.000Z"],
    missed: "2026-11-01T10:59:00.000Z",
  },
])("uses UTC cron field boundaries for $expression", ({ config, expression, due, missed }) => {
  const parsed = workflowScheduleConfig.safeParse(config);
  assert(parsed.success);
  expect(workflowScheduleExpression(parsed.data)).toBe(expression);
  for (const minute of due) expect(workflowScheduleMatches(parsed.data, minute)).toBe(true);
  expect(workflowScheduleMatches(parsed.data, missed)).toBe(false);
});

it("evaluates the bounded custom cron grammar in UTC", () => {
  const config = workflowScheduleConfig.parse({
    interval: "custom",
    expression: " 5-25/10,45 7,19 * 11 1-5 ",
  });
  expect(workflowScheduleMatches(config, "2026-11-02T07:15:00.000Z")).toBe(true);
  expect(workflowScheduleMatches(config, "2026-11-02T19:45:00.000Z")).toBe(true);
  expect(workflowScheduleMatches(config, "2026-11-01T07:15:00.000Z")).toBe(false);
  expect(workflowScheduleMatches(config, "2026-11-02T07:10:00.000Z")).toBe(false);
});

it("matches either restricted date field and supports Sunday as seven", () => {
  const config = workflowScheduleConfig.parse({ interval: "custom", expression: "0 9 2 * 7" });
  expect(workflowScheduleMatches(config, "2026-11-01T09:00:00.000Z")).toBe(true);
  expect(workflowScheduleMatches(config, "2026-11-02T09:00:00.000Z")).toBe(true);
  expect(workflowScheduleMatches(config, "2026-11-03T09:00:00.000Z")).toBe(false);
});

it.each([
  "0 0 * *",
  "0 0 0 * * *",
  "0 9 * * MON",
  "0 0 * * 8",
  "0 24 * * *",
  "*/0 * * * *",
  "0 0 0 * *",
  "0 0 20-10 * *",
  "0 0 31 2 *",
  "0 0 * * 1#2",
  "0,,1 0 * * *",
  "0 0 * * 1\n2",
  `0 0 ${"1,".repeat(60)}1 * *`,
])("rejects invalid or unsupported custom cron %j", (expression) => {
  expect(workflowScheduleConfig.safeParse({ interval: "custom", expression }).success).toBe(false);
});

it("rejects unbounded intervals and untrusted extra settings", () => {
  for (const value of [
    { interval: "minutes", minutes: 61 },
    { interval: "hours", hours: 1.5, minute: 10 },
    { interval: "days", days: 32, hour: 0, minute: 0 },
    { interval: "minutes", minutes: 15, actorId: "synthetic" },
    { interval: "days", days: 1, hour: 0, minute: 0, timeZone: "Europe/Berlin" },
  ]) {
    expect(workflowScheduleConfig.safeParse(value).success).toBe(false);
  }
});

it("reads only the single pinned trigger and exact UTC minute receipt", () => {
  const schedule = {
    id: "start",
    version: 1,
    type: "trigger.schedule",
    config: { interval: "minutes", minutes: 5 },
  };
  const definition = { nodes: [schedule] };
  const raw = { scope: "schedule", scheduledAt: "2026-11-01T09:05:00.000Z" };
  expect(readWorkflowScheduleLaunch(definition, raw)).toEqual(raw);
  expect(readWorkflowScheduleLaunch(definition, { ...raw, recordId: "synthetic" })).toBeNull();
  expect(
    readWorkflowScheduleLaunch(definition, { ...raw, scheduledAt: "2026-11-01T09:06:00.000Z" }),
  ).toBeNull();
  expect(
    readWorkflowScheduleLaunch(definition, { ...raw, scheduledAt: "2026-11-01T09:05:00.001Z" }),
  ).toBeNull();
  expect(
    readWorkflowScheduleLaunch(definition, {
      ...raw,
      scheduledAt: "2026-11-01T10:05:00.000+01:00",
    }),
  ).toBeNull();
  expect(
    readWorkflowScheduleLaunch({ nodes: [schedule, { ...schedule, type: "trigger.manual" }] }, raw),
  ).toBeNull();
  expect(workflowScheduleMinute(Date.parse("2026-11-01T09:05:59.999Z"))).toBe(raw.scheduledAt);
  expect(workflowScheduleMinute(Number.NaN)).toBeNull();
});
