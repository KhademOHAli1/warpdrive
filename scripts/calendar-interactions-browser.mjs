import assert from "node:assert/strict";

const date = "2030-06-17";
const nextDate = "2030-06-18";
const subject = "CI calendar pointer event";
export const calendarOverlapFixture = {
  date: "2031-02-07", // Friday leaves room to scroll a focused event behind the time gutter.
  startUtc: "2031-02-07T09:00:00.000Z",
  endUtc: "2031-02-07T10:00:00.000Z",
  titlePrefix: "CI overlap event ",
  count: 21,
};

function surface(page, kind, iso) {
  return page.locator(`[data-calendar-surface="${kind}"][data-calendar-date="${iso}"]`);
}

async function bounds(locator, description) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert.ok(box !== null && box.width > 0 && box.height > 0, description);
  return box;
}

async function painted(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

// Set up stable scroll geometry only. The gestures below use Chromium's actual mouse events;
// they do not dispatch DOM events, call application handlers, or replace network responses.
async function parkTimedRange(page, firstMinute, lastMinute, iso = date) {
  const column = surface(page, "time", iso);
  await column.waitFor();
  await page.locator("[data-agenda-scroll]").scrollIntoViewIfNeeded();
  await column.evaluate(
    (node, minutes) => {
      const host = node.closest("[data-agenda-scroll]");
      if (!(host instanceof HTMLElement)) throw new Error("Missing agenda scroll host");
      const clip = host.getBoundingClientRect();
      const pinned = host.querySelector(".sticky")?.getBoundingClientRect().height ?? 0;
      const top = Math.max(clip.top, 0) + pinned + 24;
      const bottom = Math.min(clip.bottom, window.innerHeight) - 24;
      const box = node.getBoundingClientRect();
      host.scrollTop += box.top + (box.height * minutes) / 1440 - (top + bottom) / 2;
    },
    (firstMinute + lastMinute) / 2,
  );
  await painted(page);
  return column;
}

function timePoint(box, minute) {
  return { x: box.x + box.width * 0.65, y: box.y + (box.height * minute) / 1440 };
}

async function drag(page, from, to, beforeRelease) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (beforeRelease !== undefined) await beforeRelease();
  } finally {
    await page.mouse.up();
  }
}

function dateLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

async function assertSchedule(dialog, calendar, iso, start, end) {
  await dialog.getByRole("textbox", { name: calendar.editor.startTime, exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: calendar.editor.startTime, exact: true })
      .inputValue(),
    start,
    "Persisted event start time",
  );
  assert.equal(
    await dialog.getByRole("textbox", { name: calendar.editor.endTime, exact: true }).inputValue(),
    end,
    "Persisted event end time (duration is retained)",
  );
  for (const label of [calendar.editor.startDate, calendar.editor.endDate]) {
    assert.equal(
      (await dialog.getByRole("button", { name: label, exact: true }).textContent())?.trim(),
      dateLabel(iso),
      "The editor retains the expected civil date",
    );
  }
  assert.equal(
    await dialog.getByRole("checkbox", { name: calendar.allDay, exact: true }).isChecked(),
    false,
  );
}

async function checkPersistedEvent(page, calendar, id, iso, start, end, touch = false) {
  await page.reload();
  const chip = page.locator(`[data-calendar-event-id="${id}"]`);
  await chip.waitFor();
  if (touch) await chip.tap();
  else await chip.click();
  const dialog = page.getByRole("dialog");
  await assertSchedule(dialog, calendar, iso, start, end);
  assert.equal(
    await dialog
      .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
      .inputValue(),
    subject,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

async function shiftDayEvent(page, id, minutes, edge) {
  await parkTimedRange(page, 600, 825);
  const chip = page.locator(`[data-calendar-event-id="${id}"]`);
  const handle = edge === undefined ? chip : chip.locator(`[data-calendar-resize-edge="${edge}"]`);
  const box = await bounds(handle, "Event chip or resize grip");
  const column = await bounds(surface(page, "time", date), "Day surface");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(page, from, { x: from.x, y: from.y + (column.height * minutes) / 1440 });
}

async function assertTouchMove(page, calendar) {
  await page.goto(`/activities/calendar?view=day&d=${nextDate}`);
  const chip = page.locator("[data-calendar-event-id]").filter({ hasText: subject });
  await chip.waitFor();
  const id = await chip.getAttribute("data-calendar-event-id");
  assert.ok(id, "The event moved on desktop is available on touch");
  await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30", true);

  const session = await page.context().newCDPSession(page);
  const touch = (type, point) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point === undefined ? [] : [{ ...point, id: 1 }],
    });
  try {
    await parkTimedRange(page, 735, 885, nextDate);
    const box = await bounds(chip, "Event chip before quick swipe");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scroll = page.locator("[data-agenda-scroll]");
    const before = await scroll.evaluate((node) => node.scrollTop);
    await touch("touchStart", start);
    await touch("touchMove", { x: start.x, y: start.y - 18 });
    await touch("touchMove", { x: start.x, y: start.y - 75 });
    await touch("touchEnd");
    await page.waitForFunction(
      (previous) => (document.querySelector("[data-agenda-scroll]")?.scrollTop ?? 0) > previous + 5,
      before,
    );
    assert.equal(await page.getByRole("dialog").count(), 0, "A swipe still scrolls the agenda");
    await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30", true);

    const column = await parkTimedRange(page, 735, 885, nextDate);
    const day = await bounds(column, "Touch day surface");
    const event = await bounds(chip, "Event chip before long press");
    const from = { x: event.x + event.width / 2, y: event.y + event.height / 2 };
    await touch("touchStart", from);
    try {
      await chip.and(page.locator('[data-calendar-dragging="true"]')).waitFor();
      await touch("touchMove", { x: from.x, y: from.y + (day.height * 60) / 1440 });
      await painted(page);
    } finally {
      await touch("touchEnd");
    }
    await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "A touch drop does not open the editor",
    );
    await checkPersistedEvent(page, calendar, id, nextDate, "13:15", "14:30", true);
  } finally {
    await session.detach();
  }
}

async function assertInternalHorizontalScroll(page, host) {
  const before = await host.evaluate((element) => {
    element.scrollLeft = 0;
    return {
      extent: element.scrollWidth - element.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.ok(before.extent > 0, "A narrow agenda has its own horizontal scroll range");
  assert.ok(before.pageOverflow <= 1, "The agenda does not add page-level horizontal overflow");
  await host.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await painted(page);
  assert.ok(
    await host.evaluate((element) => element.scrollLeft > 0 && window.scrollX === 0),
    "The agenda scrolls without panning the page",
  );
}

async function assertDisjointCards(chips, more, minTrackWidth) {
  const boxes = await chips.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, width: box.width, y: box.y, height: box.height };
    }),
  );
  assert.ok(
    boxes.every((box) => box.width >= minTrackWidth - 4 && box.height > 0),
    "Every visible event keeps its usable track width",
  );
  boxes.push(await bounds(more, "Visible counted overflow trigger"));
  boxes.sort((a, b) => a.x - b.x);
  for (const [index, box] of boxes.entries()) {
    const previous = boxes[index - 1];
    assert.ok(
      previous === undefined || box.x >= previous.x + previous.width - 1,
      "Simultaneous events and the overflow trigger have disjoint horizontal boxes",
    );
  }
}

async function assertKeyboardReveal(page, host, chips) {
  const target = chips.nth(1);
  for (const direction of ["ltr", "rtl"]) {
    await host.evaluate((element, value) => {
      element.style.direction = value;
    }, direction);
    for (const [neighbor, key] of [
      [0, "Tab"],
      [2, "Shift+Tab"],
    ]) {
      await chips.nth(neighbor).evaluate((chip) => chip.focus({ preventScroll: true }));
      const covered = await target.evaluate((chip, rtl) => {
        const scroll = chip.closest("[data-agenda-scroll]");
        const gutter = scroll.querySelector("[data-agenda-gutter]");
        const edge = gutter.getBoundingClientRect();
        const item = chip.getBoundingClientRect();
        scroll.scrollLeft += rtl ? item.right - edge.left - 15 : item.left - edge.right + 15;
        const parked = chip.getBoundingClientRect();
        return rtl ? parked.right > edge.left + 5 : parked.left < edge.right - 5;
      }, direction === "rtl");
      assert.ok(covered, `${direction}: keyboard target starts behind the sticky gutter`);
      await page.keyboard.press(key);
      await painted(page);
      assert.ok(
        await target.evaluate((chip, rtl) => {
          const edge = chip
            .closest("[data-agenda-scroll]")
            .querySelector("[data-agenda-gutter]")
            .getBoundingClientRect();
          const item = chip.getBoundingClientRect();
          return (
            chip === document.activeElement &&
            (rtl ? item.right <= edge.left + 1 : item.left >= edge.right - 1)
          );
        }, direction === "rtl"),
        `${direction}: ${key} reveals the focused event past the sticky gutter`,
      );
    }
  }
}

async function assertOverlapAgenda(page, calendar, view, visible, minTrackWidth) {
  const fixture = calendarOverlapFixture;
  const hidden = fixture.count - visible;
  await page.goto(`/activities/calendar?view=${view}&d=${fixture.date}`);
  const column = await parkTimedRange(page, 600, 660, fixture.date);
  const host = page.locator("[data-agenda-scroll]");
  const chips = column.locator("[data-calendar-event-id]");
  assert.equal(await chips.count(), visible, `${view} displays ${visible} actual event cards`);
  const more = column.getByRole("button", {
    name: hidden === 1 ? "Show one more activity" : `Show ${hidden} more activities`,
    exact: true,
  });
  assert.equal((await more.textContent())?.trim(), `+${hidden} more`);
  await assertInternalHorizontalScroll(page, host);
  await assertDisjointCards(chips, more, minTrackWidth);
  const [timedTrack, allDayTrack] = await Promise.all([
    bounds(column, "Timed date track"),
    bounds(surface(page, "date", fixture.date), "Pinned all-day date track"),
  ]);
  assert.ok(
    Math.abs(timedTrack.x - allDayTrack.x) <= 1 &&
      Math.abs(timedTrack.width - allDayTrack.width) <= 1,
    "Pinned all-day dates stay aligned with the scrolled time grid",
  );
  const clip = await bounds(host, "Agenda scroll viewport");
  const moreBox = await bounds(more, "Overflow trigger reached by horizontal scrolling");
  assert.ok(
    moreBox.x >= clip.x - 1 && moreBox.x + moreBox.width <= clip.x + clip.width + 1,
    "Horizontal scrolling brings the entire overflow action into view",
  );
  assert.ok(
    await more.evaluate((button) => button.scrollWidth <= button.clientWidth + 1),
    "The overflow count stays readable",
  );

  await more.click();
  const overflowChips = page.locator(
    "[data-radix-popper-content-wrapper] [data-calendar-event-id]",
  );
  await overflowChips.first().waitFor();
  assert.equal(await overflowChips.count(), hidden, "Overflow lists every hidden event");
  const visibleIds = await chips.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.calendarEventId),
  );
  const hiddenIds = await overflowChips.evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.calendarEventId),
  );
  const eventIds = new Set([...visibleIds, ...hiddenIds]);
  assert.equal(eventIds.size, fixture.count, "Each seeded event appears exactly once");
  const firstHidden = overflowChips.first();
  const title = (await firstHidden.textContent())?.trim();
  assert.ok(title?.startsWith(fixture.titlePrefix));
  await firstHidden.click();
  const editor = page.getByRole("dialog", { name: calendar.editor.edit, exact: true });
  await assertSchedule(editor, calendar, fixture.date, "10:00", "11:00");
  assert.equal(
    await editor
      .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
      .inputValue(),
    title,
  );
  await page.keyboard.press("Escape");
  await editor.waitFor({ state: "hidden" });
  if (view === "week") await assertKeyboardReveal(page, host, chips);
  return eventIds;
}

async function assertMobileAgenda(page, calendar, eventIds) {
  const { date: iso, count } = calendarOverlapFixture;
  const selectedDay = (view) => (url) =>
    url.pathname === "/activities/calendar" &&
    url.searchParams.get("view") === view &&
    url.searchParams.get("d") === iso;
  await page.getByRole("link", { name: "Agenda", exact: true }).click();
  await page.waitForURL(selectedDay("agenda"));
  const agenda = page.locator("[data-calendar-agenda]");
  const rows = agenda.locator("[data-calendar-event-id]");
  await rows.last().waitFor();
  assert.equal(await rows.count(), count, "Agenda renders every event in the selected day");
  assert.deepEqual(
    new Set(await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.calendarEventId))),
    eventIds,
    "Agenda includes the same events as Day, including the overflow item",
  );
  assert.ok(
    await agenda.evaluate((list) => {
      const pageWidth = document.documentElement.clientWidth;
      return (
        list.scrollWidth <= list.clientWidth + 1 &&
        document.documentElement.scrollWidth <= pageWidth + 1
      );
    }),
    "Agenda fits the narrow viewport without horizontal scrolling",
  );
  const boxes = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    }),
  );
  assert.ok(
    boxes.every(
      (box, index) => box.height > 0 && (index === 0 || box.top >= boxes[index - 1].bottom - 1),
    ),
    "Agenda renders one vertical list without overlapping event rows",
  );

  const last = rows.last();
  const title = (await last.textContent())?.match(/CI overlap event \d+\b/)?.[0];
  assert.ok(title, "Agenda shows the selected event title");
  await last.click();
  const editor = page.getByRole("dialog", { name: calendar.editor.edit, exact: true });
  await assertSchedule(editor, calendar, iso, "10:00", "11:00");
  assert.equal(
    await editor
      .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
      .inputValue(),
    title,
    "Agenda opens the selected event in the calendar editor",
  );
  await page.keyboard.press("Escape");
  await editor.waitFor({ state: "hidden" });

  await page.getByRole("link", { name: calendar.day, exact: true }).click();
  await page.waitForURL(selectedDay("day"));
  await surface(page, "time", iso).waitFor();
  assert.equal(await agenda.count(), 0, "Day restores the time grid for the same date");
}

export async function runCalendarInteractionsBrowserSmoke({ journey, login, catalog }) {
  const calendar = catalog("src/features/activities/messages/calendar.en.json");
  await journey(
    "calendar-interactions",
    "en",
    async (page) => {
      await login(page);
      await page.goto(`/activities/calendar?view=day&d=${date}`);
      await surface(page, "time", date).waitFor();
      assert.equal(
        await page.locator("[data-calendar-event-id]").count(),
        0,
        "Future fixture day is empty",
      );

      const column = await parkTimedRange(page, 600, 660);
      const box = await bounds(column, "Full 24-hour day surface");
      // Include the 10:45 quarter-hour slot, ending before the 11:00 slot starts.
      await drag(page, timePoint(box, 601), timePoint(box, 659));
      const dialog = page.getByRole("dialog");
      await assertSchedule(dialog, calendar, date, "10:00", "11:00");
      await dialog
        .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
        .fill(subject);
      await dialog.locator('button[type="submit"]').click();
      await dialog.waitFor({ state: "hidden" });
      const created = page.locator("[data-calendar-event-id]").filter({ hasText: subject });
      await created.waitFor();
      const id = await created.getAttribute("data-calendar-event-id");
      assert.ok(id, "The drawn event receives a persisted ID");
      await checkPersistedEvent(page, calendar, id, date, "10:00", "11:00");

      await shiftDayEvent(page, id, 120);
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        "Trailing drag click does not open the editor",
      );
      await page.getByRole("button", { name: calendar.interaction.undo, exact: true }).click();
      await page.getByText(calendar.interaction.undoSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "10:00", "11:00");

      await shiftDayEvent(page, id, 120);
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:00", "13:00");

      await shiftDayEvent(page, id, 15, "start");
      await page.getByText(calendar.interaction.resizeSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:00");
      await shiftDayEvent(page, id, 30, "end");
      await page.getByText(calendar.interaction.resizeSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:30");

      // A cancelled active drag must neither invoke a server action nor change stored time.
      await parkTimedRange(page, 720, 900);
      let actionRequests = 0;
      const recordAction = (request) => {
        if (request.method() === "POST" && request.headers()["next-action"] !== undefined)
          actionRequests++;
      };
      page.on("request", recordAction);
      try {
        const before = actionRequests;
        const current = await bounds(
          page.locator(`[data-calendar-event-id="${id}"]`),
          "Chip for cancellation",
        );
        const day = await bounds(surface(page, "time", date), "Day for cancellation");
        const origin = { x: current.x + current.width * 0.65, y: current.y + current.height / 2 };
        await drag(
          page,
          origin,
          { x: origin.x, y: origin.y + (day.height * 120) / 1440 },
          async () => {
            await page
              .locator(`[data-calendar-event-id="${id}"][data-calendar-dragging="true"]`)
              .waitFor();
            await page.keyboard.press("Escape");
          },
        );
        await painted(page);
        assert.equal(actionRequests, before, "Escape sends no mutation action");
        assert.equal(
          await page.getByRole("dialog").count(),
          0,
          "Cancelled drag suppresses its click",
        );
      } finally {
        page.off("request", recordAction);
      }
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:30");

      await page.goto(`/activities/calendar?view=month&d=${date}`);
      const nextCell = surface(page, "date", nextDate);
      await nextCell.scrollIntoViewIfNeeded();
      const monthChip = await bounds(
        page.locator(`[data-calendar-event-id="${id}"]`),
        "Month event chip",
      );
      const destination = await bounds(nextCell, "Next date cell");
      await drag(
        page,
        { x: monthChip.x + monthChip.width / 2, y: monthChip.y + monthChip.height / 2 },
        { x: destination.x + destination.width / 2, y: destination.y + destination.height - 12 },
      );
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30");
      assert.equal(
        await surface(page, "date", date).locator(`[data-calendar-event-id="${id}"]`).count(),
        0,
      );
      assert.equal(
        await surface(page, "date", nextDate).locator(`[data-calendar-event-id="${id}"]`).count(),
        1,
      );

      const firstDate = "2030-06-20";
      const lastDate = "2030-06-22";
      const first = await bounds(surface(page, "date", firstDate), "All-day range start");
      const last = await bounds(surface(page, "date", lastDate), "All-day range end");
      await drag(
        page,
        { x: first.x + first.width / 2, y: first.y + first.height - 12 },
        { x: last.x + last.width / 2, y: last.y + last.height - 12 },
      );
      await dialog.waitFor();
      assert.equal(
        await dialog.getByRole("checkbox", { name: calendar.allDay, exact: true }).isChecked(),
        true,
      );
      assert.equal(
        await dialog.locator("[data-time-picker]").count(),
        0,
        "Date drawing opens an all-day draft",
      );
      assert.equal(
        (
          await dialog
            .getByRole("button", { name: calendar.editor.startDate, exact: true })
            .textContent()
        )?.trim(),
        dateLabel(firstDate),
      );
      assert.equal(
        (
          await dialog
            .getByRole("button", { name: calendar.editor.endDate, exact: true })
            .textContent()
        )?.trim(),
        dateLabel(lastDate),
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page.locator(`[data-calendar-event-id="${id}"]`).waitFor();
      assert.equal(
        await page.locator("[data-calendar-event-id]").count(),
        1,
        "Cancelling the range draft creates nothing",
      );
    },
    { width: 1440, height: 1100 },
  );
  await journey(
    "calendar-touch-interactions",
    "en",
    async (page) => {
      await login(page);
      await assertTouchMove(page, calendar);
    },
    { width: 390, height: 844 },
    true,
  );
  await journey(
    "calendar-overlap-lanes",
    "en",
    async (page) => {
      await login(page);
      await assertOverlapAgenda(page, calendar, "week", 3, 36);
      const eventIds = await assertOverlapAgenda(page, calendar, "day", 20, 96);
      await assertMobileAgenda(page, calendar, eventIds);
    },
    { width: 390, height: 844 },
  );
}
