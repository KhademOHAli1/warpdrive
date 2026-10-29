import { describe, expect, it } from "vitest";
import { futureScheduledSendTime, scheduledSendTime } from "./scheduledSendTime";

const tehran = { date: "2027-03-21", time: "09:00", timeZone: "Asia/Tehran" };

describe("scheduled send wall time", () => {
  it("resolves an account wall time independently of the browser zone", () => {
    expect(scheduledSendTime(tehran)).toEqual({
      ok: true,
      value: { at: new Date("2027-03-21T05:30:00Z"), offset: "+03:30", ambiguous: false },
    });
  });

  it.each([
    { date: "", time: "09:00" },
    { date: "2027-03-21", time: "" },
  ])("requires both date and time: $date $time", (partial) => {
    expect(scheduledSendTime({ ...tehran, ...partial })).toEqual({
      ok: false,
      error: "incomplete",
    });
  });

  it.each([
    { date: "2027-02-29" },
    { date: "2027-13-01" },
    { date: "2027-3-21" },
    { time: "24:00" },
    { time: "09:60" },
    { time: "09:00:30" },
    { timeZone: "Invalid/Zone" },
  ])("rejects malformed scheduling values: %j", (invalid) => {
    expect(scheduledSendTime({ ...tehran, ...invalid })).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a skipped wall time instead of moving the email an hour later", () => {
    expect(
      scheduledSendTime({ date: "2027-03-14", time: "02:30", timeZone: "America/New_York" }),
    ).toEqual({ ok: false, error: "nonexistent" });
  });

  it("uses the earlier occurrence of a repeated wall time and exposes its offset", () => {
    expect(
      scheduledSendTime({ date: "2027-11-07", time: "01:30", timeZone: "America/New_York" }),
    ).toEqual({
      ok: true,
      value: { at: new Date("2027-11-07T05:30:00Z"), offset: "-04:00", ambiguous: true },
    });
  });

  it("can resolve a Tehran midnight to the previous UTC date", () => {
    const result = scheduledSendTime({ ...tehran, time: "00:00" });
    expect(result.ok && result.value.at.toISOString()).toBe("2027-03-20T20:30:00.000Z");
  });

  it.each([0, 1, 60_000])("rejects an instant that is now or %i ms in the past", (after) => {
    expect(futureScheduledSendTime(tehran, Date.parse("2027-03-21T05:30:00Z") + after)).toEqual({
      ok: false,
      error: "past",
    });
  });

  it("accepts even the first strictly future millisecond without rounding the boundary", () => {
    const result = futureScheduledSendTime(tehran, Date.parse("2027-03-21T05:30:00Z") - 1);
    expect(result.ok && result.value.at.toISOString()).toBe("2027-03-21T05:30:00.000Z");
  });
});
