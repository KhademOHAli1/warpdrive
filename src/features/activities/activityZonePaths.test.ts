import { describe, expect, it } from "vitest";
import {
  type ActivityDraft,
  buildActivityUpdateInput,
} from "@/features/deal-workspace/composer/composerHelpers";
import { buildActivityPatch, type EditableActivity } from "./activityEditPatch";
import { composeDueAt } from "./activityTime";
import type { CalendarActivity } from "./calendar";
import { selectWindow } from "./calendarView";
import { fmtDue } from "./dueLabel";
import { isActivityOverdue } from "./overdue";
import { groupByLocalDay, placeBlock } from "./weekAgenda";
import { groupByDay } from "./weekGrid";

const source: EditableActivity = {
  id: "id",
  subject: "Call",
  typeId: "type",
  priority: null,
  dueAtIso: "2026-10-25T01:30:24.123Z",
  allDay: false,
  durationMinutes: 37,
  location: null,
  done: false,
};
const state = {
  subject: "Changed",
  typeId: "type",
  priority: "",
  date: "2026-10-25",
  time: "02:30",
  location: "",
};
describe("account-zone activity paths", () => {
  it("keeps Esfand 30,1403 as a canonical civil date across timezone and calendar display", () => {
    const saved = composeDueAt("2025-03-20", "", "Asia/Tehran");
    expect(saved.dueDate).toBe("2025-03-20");
    const label = fmtDue(
      saved.iso,
      true,
      { locale: "fa", calendar: "persian", timeZone: "America/Los_Angeles" },
      saved.dueDate,
    );
    expect(label).toContain("اسفند");
    expect(label).toContain("۳۰");
  });
  it("preserves the later repeated hour and seconds on unrelated standalone edits", () => {
    expect(buildActivityPatch(source, state, "Europe/Berlin")).toEqual({
      id: "id",
      subject: "Changed",
    });
  });
  it("preserves inline composer instants/duration when minute inputs are untouched", () => {
    const draft = {
      ...state,
      startDate: state.date,
      startTime: state.time,
      endDate: "",
      endTime: "",
      links: { deal: null, person: null, org: null },
      leadId: null,
      note: "",
      videoCallUrl: "",
      ownerId: "",
      participants: [],
      done: false,
    } as ActivityDraft;
    const patch = buildActivityUpdateInput(
      "id",
      draft,
      {
        dealId: null,
        personId: null,
        orgId: null,
        dueAt: source.dueAtIso,
        allDay: false,
        endAt: null,
      },
      "Europe/Berlin",
    );
    expect(patch).not.toHaveProperty("dueAt");
    expect(patch).not.toHaveProperty("durationMinutes");
  });
  it("writes an all-day date at Tehran midnight and keeps deliberate midnight timed", () => {
    expect(composeDueAt("2026-03-21", "", "Asia/Tehran")).toEqual({
      iso: "2026-03-20T20:30:00.000Z",
      allDay: true,
      dueDate: "2026-03-21",
    });
    expect(composeDueAt("2026-03-21", "00:00", "Asia/Tehran")).toEqual({
      iso: "2026-03-20T20:30:00.000Z",
      allDay: false,
      dueDate: null,
    });
  });
  it("uses identical month/week day buckets and account-zone hour placement at Nowruz", () => {
    const a = {
      id: "a",
      dueAt: new Date("2026-03-20T21:00Z"),
      allDay: false,
      overdue: false,
    } as CalendarActivity;
    const days = ["2026-03-20", "2026-03-21"];
    expect(
      groupByDay(
        [a],
        days.map((d) => new Date(d)),
        true,
        "Asia/Tehran",
      ).get(days[1]!),
    ).toEqual([a]);
    expect(groupByLocalDay([a], days, true, "Asia/Tehran").get(days[1]!)).toEqual([a]);
    expect(placeBlock(a.dueAt, null, "Asia/Tehran").topPx).toBe(24);
  });
  it("returns exact half-open account-zone calendar bounds without arbitrary day padding", () => {
    const { range } = selectWindow("week", "2026-03-21", {
      calendar: "persian",
      locale: "fa",
      timeZone: "Asia/Tehran",
    });
    expect(range.from.toISOString()).toBe("2026-03-20T20:30:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-27T20:30:00.000Z");
  });
  it("keeps all-day end dates current until account midnight and renders the canonical Persian date", () => {
    const due = new Date("2026-03-20T20:30Z");
    expect(
      isActivityOverdue(
        due,
        true,
        false,
        Date.parse("2026-03-22T20:29:59Z"),
        "Asia/Tehran",
        "2026-03-21",
        "2026-03-22",
      ),
    ).toBe(false);
    expect(
      isActivityOverdue(
        due,
        true,
        false,
        Date.parse("2026-03-22T20:30Z"),
        "Asia/Tehran",
        "2026-03-21",
        "2026-03-22",
      ),
    ).toBe(true);
    expect(
      fmtDue(
        due.toISOString(),
        true,
        { locale: "fa", calendar: "persian", timeZone: "Pacific/Honolulu" },
        "2026-03-21",
      ),
    ).toContain("فروردین");
  });
});
