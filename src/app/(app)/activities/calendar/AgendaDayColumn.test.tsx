// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutTimed } from "@/features/activities/agendaLayout";
import type { CalendarActivity } from "@/features/activities/calendar";
import { HOUR_HEIGHT_PX } from "@/features/activities/weekAgenda";
import { AgendaDayColumn } from "./AgendaDayColumn";

afterEach(() => {
  cleanup();
});

function mk(id: string, dueAt: Date, durationMinutes: number | null): CalendarActivity {
  return {
    id,
    subject: `Activity ${id}`,
    dueAt,
    allDay: false,
    durationMinutes,
    typeKey: "call",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
  };
}

function renderColumn(items: CalendarActivity[], onOpenActivity = vi.fn(), onOpenSlot = vi.fn()) {
  render(
    <AgendaDayColumn
      iso="2026-07-15"
      dayLabel="Wednesday 15 July 2026"
      layout={layoutTimed(items, "UTC", "2026-07-15")}
      onOpenActivity={onOpenActivity}
      onOpenSlot={onOpenSlot}
    />,
  );
  return { onOpenActivity, onOpenSlot };
}

function fiveAtNine(): CalendarActivity[] {
  return ["a", "b", "c", "d", "e"].map((id) => mk(id, new Date("2026-07-15T09:00:00Z"), 60));
}

describe("AgendaDayColumn", () => {
  it("names the day it belongs to, so its activities are not an unlabelled run of buttons", () => {
    renderColumn([]);
    expect(screen.getByRole("group", { name: "Wednesday 15 July 2026" })).toBeInTheDocument();
  });

  it("clamps a late block's height to the remaining hours instead of overflowing past midnight", () => {
    // 23:00 + 120min naturally spans 2 hour-lanes, but only 1 hour remains before midnight.
    renderColumn([mk("late", new Date("2026-07-15T23:00:00Z"), 120)]);
    const chip = screen.getByRole("button", { name: "Activity late" });
    expect(chip.parentElement?.style.height).toBe(`${HOUR_HEIGHT_PX}px`);
  });

  it("leaves a block that fits within the day unclamped", () => {
    renderColumn([mk("normal", new Date("2026-07-15T09:00:00Z"), 60)]);
    const chip = screen.getByRole("button", { name: "Activity normal" });
    expect(chip.parentElement?.style.height).toBe(`${HOUR_HEIGHT_PX}px`);
  });

  it("puts resize grips on the actual start and end of a multiday event", () => {
    const event = {
      ...mk("multi", new Date("2026-07-15T23:00:00Z"), 1560),
      endAt: new Date("2026-07-17T01:00:00Z"),
    };
    const dates = ["2026-07-15", "2026-07-16", "2026-07-17"];
    const onOpenActivity = vi.fn();
    const onOpenSlot = vi.fn();
    render(
      dates.map((iso) => (
        <AgendaDayColumn
          key={iso}
          iso={iso}
          dayLabel={iso}
          layout={layoutTimed([event], "UTC", iso)}
          onOpenActivity={onOpenActivity}
          onOpenSlot={onOpenSlot}
        />
      )),
    );
    const chips = screen.getAllByRole("button", { name: "Activity multi" });
    expect(chips.map((chip) => chip.parentElement?.style.height)).toEqual([
      "48px",
      "1152px",
      "48px",
    ]);
    expect(chips.map((chip) => chip.parentElement?.style.top)).toEqual(["1104px", "0px", "0px"]);
    expect(
      chips.map((chip) =>
        Array.from(chip.querySelectorAll("[data-calendar-resize-edge]"), (grip) =>
          grip.getAttribute("data-calendar-resize-edge"),
        ),
      ),
    ).toEqual([["start"], [], ["end"]]);
  });

  it("leaves a point event clickable and exposes only its end grip", () => {
    const event = mk("point", new Date("2026-07-15T09:00:00Z"), null);
    const { onOpenActivity } = renderColumn([event]);
    const chip = screen.getByRole("button", { name: "Activity point" });
    expect(chip.querySelector('[data-calendar-resize-edge="start"]')).toBeNull();
    expect(chip.querySelector('[data-calendar-resize-edge="end"]')).toBeInTheDocument();
    fireEvent.click(chip);
    expect(onOpenActivity).toHaveBeenCalledWith(event);
  });

  it("lays two overlapping activities side by side instead of one covering the other", () => {
    renderColumn([
      mk("first", new Date("2026-07-15T09:00:00Z"), 60),
      mk("second", new Date("2026-07-15T09:30:00Z"), 60),
    ]);
    const first = screen.getByRole("button", { name: "Activity first" }).parentElement;
    const second = screen.getByRole("button", { name: "Activity second" }).parentElement;
    expect([first?.style.insetInlineStart, first?.style.width]).toEqual(["0%", "50%"]);
    expect([second?.style.insetInlineStart, second?.style.width]).toEqual(["50%", "50%"]);
  });

  it("makes the whole timed block clickable, not just its first line of text", () => {
    renderColumn([mk("normal", new Date("2026-07-15T09:00:00Z"), 120)]);
    expect(screen.getByRole("button", { name: "Activity normal" })).toHaveClass("h-full");
  });

  it("collapses the activities past the lane cap into a counted more-chip", () => {
    renderColumn(fiveAtNine());
    expect(screen.getAllByRole("button", { name: /^Activity / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Show 2 more activities" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activity e" })).toBeNull();
  });

  it("lists what the more-chip stands for, so nothing is unreachable from the calendar", () => {
    const items = fiveAtNine();
    const { onOpenActivity } = renderColumn(items);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more activities" }));
    fireEvent.click(screen.getByRole("button", { name: /Activity e/ }));
    expect(onOpenActivity).toHaveBeenCalledWith(items[4]);
  });

  it("lets a click land on the hour underneath the tall part of an overflow block", () => {
    renderColumn([
      mk("a", new Date("2026-07-15T09:00:00Z"), 240),
      mk("b", new Date("2026-07-15T09:00:00Z"), 240),
      mk("c", new Date("2026-07-15T09:00:00Z"), 240),
      mk("d", new Date("2026-07-15T09:00:00Z"), 60),
      mk("e", new Date("2026-07-15T09:30:00Z"), 60),
    ]);
    const trigger = screen.getByRole("button", { name: "Show 2 more activities" });
    expect(trigger.parentElement?.style.pointerEvents).toBe("none");
    expect(trigger.style.pointerEvents).toBe("auto");
  });

  it("puts the activities ahead of the empty hour lanes in the tab order", () => {
    // The lanes are an affordance; the activities are the content. Rendered lanes-first, a keyboard
    // user walked 24 empty hours before reaching anything real.
    renderColumn([mk("real", new Date("2026-07-15T14:00:00Z"), 60)]);
    const chip = screen.getByRole("button", { name: "Activity real" });
    const firstSlot = screen.getByRole("button", { name: "Add activity on 2026-07-15 at 00:00" });
    expect(chip.compareDocumentPosition(firstSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts one hour lane in the tab order, not all twenty-four", () => {
    renderColumn([]);
    const tabbable = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("tabindex") !== "-1");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Add activity on 2026-07-15 at 08:00");
  });

  it("walks the hours with the arrow keys once a lane has focus", () => {
    renderColumn([]);
    const start = screen.getByRole("button", { name: "Add activity on 2026-07-15 at 08:00" });
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowDown" });
    expect(
      screen.getByRole("button", { name: "Add activity on 2026-07-15 at 09:00" }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(start).toHaveFocus();
  });

  it("stops at the ends of the day rather than wrapping around midnight", () => {
    renderColumn([]);
    const first = screen.getByRole("button", { name: "Add activity on 2026-07-15 at 00:00" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(first).toHaveFocus();
  });
});
