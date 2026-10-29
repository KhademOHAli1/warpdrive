import { expect, it } from "vitest";
import { dealListQueryKey } from "./dealListQueryKey";

const date = {
  conditions: [{ field: "expectedCloseDate" as const, op: "eq" as const, value: "this_month" }],
};
const initial = { calendar: "gregory" as const, locale: "en" as const, timeZone: "UTC" };
it("isolates date-filter results by calendar, week language and timezone", () => {
  const key = dealListQueryKey("p", "list", date, initial);
  for (const context of [
    { ...initial, calendar: "persian" as const },
    { ...initial, locale: "fa" as const },
    { ...initial, timeZone: "Asia/Tehran" },
  ]) {
    expect(dealListQueryKey("p", "list", date, context)).not.toEqual(key);
  }
});
it("preserves non-date query keys and prefix invalidation", () => {
  expect(
    dealListQueryKey("p", "list", undefined, {
      calendar: "persian",
      locale: "fa",
      timeZone: "Asia/Tehran",
    }),
  ).toEqual(["deal-list", "p", "list", "none"]);
  expect(dealListQueryKey("p", "list", date, initial).slice(0, 2)).toEqual(["deal-list", "p"]);
});
